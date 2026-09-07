import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { configureSourceIcons } from './bundledIcons.js';
import {
  APP_ID,
  APP_NAME,
  APP_VERSION,
  PROJECT_URL,
  WORKSPACE_EXTENSION,
  WORKSPACE_MIME_TYPE,
} from './config.js';
import { presentImageEditor } from './editor/window.js';
import { SUPPORTED_VIDEO_MIME_TYPES } from './model/media-file.js';
import { captureScreenshot } from './services/screenshot-capture.js';
import { readWorkspace } from './services/workspace-file.js';
import { presentVideoEditor } from './video/window.js';
import { BolasWindow } from './window.js';

function isCancellation(error) {
  return Boolean(
    error?.matches?.(Gtk.dialog_error_quark(), Gtk.DialogError.DISMISSED) ||
      error?.matches?.(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED),
  );
}

const IMAGE_MIME_TYPES = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/tiff',
  'image/bmp',
]);

function addMimeTypes(filter, mimeTypes) {
  for (const mimeType of mimeTypes) filter.add_mime_type(mimeType);
}

function mediaFilters() {
  const mediaFilter = new Gtk.FileFilter();
  mediaFilter.set_name('Images, Videos, and Bolas Workspaces');
  addMimeTypes(mediaFilter, IMAGE_MIME_TYPES);
  addMimeTypes(mediaFilter, SUPPORTED_VIDEO_MIME_TYPES);
  mediaFilter.add_mime_type(WORKSPACE_MIME_TYPE);
  mediaFilter.add_pattern(`*${WORKSPACE_EXTENSION}`);

  const imageFilter = new Gtk.FileFilter();
  imageFilter.set_name('Images');
  addMimeTypes(imageFilter, IMAGE_MIME_TYPES);

  const videoFilter = new Gtk.FileFilter();
  videoFilter.set_name('Videos');
  addMimeTypes(videoFilter, SUPPORTED_VIDEO_MIME_TYPES);

  const workspaceFilter = new Gtk.FileFilter();
  workspaceFilter.set_name('Bolas Workspaces');
  workspaceFilter.add_mime_type(WORKSPACE_MIME_TYPE);
  workspaceFilter.add_pattern(`*${WORKSPACE_EXTENSION}`);

  const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
  filters.append(mediaFilter);
  filters.append(imageFilter);
  filters.append(videoFilter);
  filters.append(workspaceFilter);
  return { filters, mediaFilter };
}

export const BolasApplication = GObject.registerClass(
  class BolasApplication extends Adw.Application {
    constructor() {
      super({ application_id: APP_ID, flags: Gio.ApplicationFlags.HANDLES_OPEN });
      this._captureCancellable = null;
      this._mainWindow = null;
      this._styleProvider = null;
      this._workspaceOpenCancellable = null;
    }

    vfunc_startup() {
      super.vfunc_startup();
      const display = Gdk.Display.get_default();
      if (display) configureSourceIcons(Gtk.IconTheme.get_for_display(display));
      this._loadStyles();
      this._installActions();
    }

    vfunc_activate() {
      this._ensureMainWindow().present();
    }

    vfunc_open(files, _numberOfFiles, _hint) {
      const window = this._ensureMainWindow();
      const file = files?.[0] ?? null;

      try {
        if (file) window.openFile(file);
      } catch (error) {
        window.toast(error.message);
      }
      if ((files?.length ?? 0) > 1) window.toast('Opened the first file.');
      window.present();
    }

    _ensureMainWindow() {
      if (this._mainWindow) return this._mainWindow;

      this._mainWindow = new BolasWindow(this, {
        onCapture: () => this._takeScreenshot(),
        onEdit: (mediaPath, kind) => this._openEditor(mediaPath, kind),
        onMediaChange: () => this._cancelWorkspaceOpen(),
        onOpen: () => this._chooseMedia(),
      });
      this._mainWindow.connect('destroy', () => {
        this._captureCancellable?.cancel();
        this._captureCancellable = null;
        this._workspaceOpenCancellable?.cancel();
        this._workspaceOpenCancellable = null;
        this._mainWindow = null;
      });
      return this._mainWindow;
    }

    _installActions() {
      for (const [name, callback] of [
        ['open', () => this._chooseMedia()],
        ['screenshot', () => this._takeScreenshot()],
        ['about', () => this._showAbout()],
        ['quit', () => this.quit()],
      ]) {
        const action = new Gio.SimpleAction({ name });
        action.connect('activate', callback);
        this.add_action(action);
      }

      this.set_accels_for_action('app.open', ['<Primary>o']);
      this.set_accels_for_action('app.screenshot', ['<Primary><Shift>s']);
      this.set_accels_for_action('app.quit', ['<Primary>q']);
    }

    _loadStyles() {
      const display = Gdk.Display.get_default();
      if (!display) return;

      const stylesheet = Gio.File.new_for_uri(import.meta.url)
        .get_parent()
        .get_child('style.css');
      this._styleProvider = new Gtk.CssProvider();
      this._styleProvider.load_from_file(stylesheet);
      Gtk.StyleContext.add_provider_for_display(
        display,
        this._styleProvider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
      );
    }

    _chooseMedia() {
      const window = this._ensureMainWindow();
      const { filters, mediaFilter } = mediaFilters();
      const dialog = new Gtk.FileDialog({ title: 'Open Image, Video, or Workspace' });
      dialog.set_filters(filters);
      dialog.set_default_filter(mediaFilter);
      dialog.open(window, null, (_dialog, result) => {
        try {
          window.openFile(dialog.open_finish(result));
        } catch (error) {
          if (!isCancellation(error)) window.toast(error.message);
        }
      });
    }

    async _takeScreenshot() {
      if (this._captureCancellable) return;

      const window = this._ensureMainWindow();
      const cancellable = new Gio.Cancellable();
      this._captureCancellable = cancellable;
      window.setCaptureBusy(true);
      try {
        const path = await captureScreenshot({ cancellable });
        if (path) window.showMedia(path);
      } catch (error) {
        if (!isCancellation(error)) window.toast(error.message);
      } finally {
        if (this._captureCancellable === cancellable) this._captureCancellable = null;
        if (this._mainWindow === window) window.setCaptureBusy(false);
      }
    }

    _openEditor(mediaPath, kind = 'image') {
      this._cancelWorkspaceOpen();
      if (kind === 'video') {
        presentVideoEditor({ parent: this._ensureMainWindow(), videoPath: mediaPath });
        return;
      }
      if (kind === 'workspace') {
        this._openWorkspace(mediaPath);
        return;
      }
      presentImageEditor({
        backgroundEnabled: true,
        image: { path: mediaPath, sourceKind: 'local-image' },
        parent: this._ensureMainWindow(),
      });
    }

    async _openWorkspace(workspacePath) {
      const window = this._ensureMainWindow();
      const cancellable = new Gio.Cancellable();
      this._workspaceOpenCancellable = cancellable;
      try {
        const loaded = await readWorkspace(workspacePath, { cancellable });
        if (this._workspaceOpenCancellable !== cancellable) return;
        if (loaded.workspace.kind === 'video') {
          presentVideoEditor({
            parent: window,
            workspaceLoad: loaded,
            workspacePath,
          });
        } else {
          presentImageEditor({
            parent: window,
            workspaceLoad: loaded,
            workspacePath,
          });
        }
      } catch (error) {
        if (!isCancellation(error)) window.toast(error.message);
      } finally {
        if (this._workspaceOpenCancellable === cancellable) this._workspaceOpenCancellable = null;
      }
    }

    _cancelWorkspaceOpen() {
      this._workspaceOpenCancellable?.cancel();
      this._workspaceOpenCancellable = null;
    }

    _showAbout() {
      const about = new Adw.AboutDialog({
        application_icon: APP_ID,
        application_name: APP_NAME,
        developer_name: 'Stonega',
        version: APP_VERSION,
        website: PROJECT_URL,
      });
      about.add_css_class('bolas-about');
      about.present(this._ensureMainWindow());
    }
  },
);

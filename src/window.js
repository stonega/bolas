import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango?version=1.0';

import {
  APP_NAME,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MEDIA_FOLDER_SIDEBAR_MAX_WIDTH,
  MEDIA_FOLDER_SIDEBAR_MIN_WIDTH,
  MEDIA_FOLDER_SIDEBAR_WIDTH_FRACTION,
  MEDIA_FOLDER_THUMBNAIL_ASPECT_RATIO,
} from './config.js';
import { EXPORT_FORMATS, exportPathForFormat } from './model/export.js';
import { inspectMediaFile, inspectMediaPath } from './model/media-file.js';
import {
  isSupportedImageName,
  isSupportedVideoName,
  screencastFolderPath,
  screenshotFolderPath,
} from './model/screenshot-folder.js';
import { isVideoThumbnailCancellation, VideoThumbnailQueue } from './services/video-thumbnail.js';
import {
  ensureManagedWorkspaceDirectory,
  isWorkspaceLibraryName,
  workspaceLibraryTitle,
  workspacePreviewPath,
} from './services/workspace-library.js';

const MEDIA_FOLDER_THUMBNAIL_MIN_WIDTH = 156;

const MediaFolderAspectFrame = GObject.registerClass(
  class MediaFolderAspectFrame extends Gtk.AspectFrame {
    vfunc_get_request_mode() {
      return Gtk.SizeRequestMode.HEIGHT_FOR_WIDTH;
    }

    vfunc_measure(orientation, forSize) {
      if (orientation === Gtk.Orientation.HORIZONTAL) {
        const [minimum, natural] = super.vfunc_measure(orientation, forSize);
        return [
          Math.max(MEDIA_FOLDER_THUMBNAIL_MIN_WIDTH, minimum),
          Math.max(MEDIA_FOLDER_THUMBNAIL_MIN_WIDTH, natural),
          -1,
          -1,
        ];
      }

      const width = forSize > 0 ? forSize : MEDIA_FOLDER_THUMBNAIL_MIN_WIDTH;
      const height = Math.ceil(width / MEDIA_FOLDER_THUMBNAIL_ASPECT_RATIO);
      return [height, height, -1, -1];
    }
  },
);

function actionButton(iconName, label, callback, suggested = false) {
  const content = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 7 });
  content.append(new Gtk.Image({ icon_name: iconName }));
  content.append(new Gtk.Label({ label }));
  const button = new Gtk.Button({ child: content });
  button.add_css_class('pill');
  if (suggested) button.add_css_class('suggested-action');
  button.connect('clicked', callback);
  return button;
}

function isCancellation(error) {
  return Boolean(
    error?.cancelled ||
      error?.matches?.(Gtk.dialog_error_quark(), Gtk.DialogError.DISMISSED) ||
      error?.matches?.(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED),
  );
}

export function presentExportDialog({ parent, kind, stem, runExport, onClosed = null }) {
  const formats = EXPORT_FORMATS[kind];
  if (!formats) throw new Error('Choose an image or video to export.');
  const dialog = new Adw.Dialog({
    title: kind === 'video' ? 'Export Video' : 'Export Image',
    content_width: 420,
  });
  const toolbar = new Adw.ToolbarView();
  toolbar.add_top_bar(new Adw.HeaderBar());
  const content = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 18,
    margin_start: 24,
    margin_end: 24,
    margin_top: 12,
    margin_bottom: 24,
  });
  const group = new Adw.PreferencesGroup({ description: formats[0].description });
  const formatRow = new Adw.ComboRow({
    title: '_File Type',
    use_underline: true,
    model: Gtk.StringList.new(formats.map((format) => format.label)),
  });
  formatRow.connect('notify::selected', () =>
    group.set_description(formats[formatRow.selected].description),
  );
  group.add(formatRow);
  content.append(group);
  const status = new Gtk.Label({
    css_classes: ['caption', 'dim-label'],
    xalign: 0,
    wrap: true,
    wrap_mode: Pango.WrapMode.WORD_CHAR,
    visible: false,
  });
  const progress = new Gtk.ProgressBar({ show_text: true, visible: false });
  progress.update_property([Gtk.AccessibleProperty.LABEL], ['Export progress']);
  content.append(progress);
  content.append(status);
  const actions = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    height_request: 44,
    spacing: 12,
    homogeneous: true,
  });
  const cancel = new Gtk.Button({ label: 'Cancel' });
  const submit = new Gtk.Button({ label: 'Export', css_classes: ['suggested-action'] });
  actions.append(cancel);
  actions.append(submit);
  content.append(actions);
  toolbar.set_content(content);
  dialog.set_child(toolbar);
  dialog.set_default_widget(submit);
  dialog.set_focus(formatRow);

  let active = null;
  let closed = false;
  let complete = false;
  let closeAfterCancel = false;
  let pulseId = 0;
  const stopPulse = () => {
    if (pulseId) GLib.source_remove(pulseId);
    pulseId = 0;
  };
  const report = ({ fraction, message }) => {
    if (closed || active?.is_cancelled()) return;
    status.set_label(message);
    status.set_visible(true);
    progress.set_visible(true);
    if (fraction === null) {
      progress.set_text('');
      if (!pulseId)
        pulseId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
          progress.pulse();
          return GLib.SOURCE_CONTINUE;
        });
    } else {
      stopPulse();
      progress.set_fraction(fraction);
      progress.set_text(`${Math.floor(fraction * 100)}%`);
    }
  };
  const cancelExport = () => {
    if (!active) {
      dialog.close();
      return;
    }
    closeAfterCancel = true;
    active.cancel();
    stopPulse();
    status.set_label('Cancelling export…');
    status.set_visible(true);
    cancel.set_sensitive(false);
  };
  cancel.connect('clicked', cancelExport);
  dialog.connect('close-attempt', cancelExport);
  dialog.connect('closed', () => {
    closed = true;
    active?.cancel();
    stopPulse();
    onClosed?.();
  });
  submit.connect('clicked', async () => {
    if (complete) {
      dialog.close();
      return;
    }
    if (active) return;
    const format = formats[formatRow.selected];
    active = new Gio.Cancellable();
    dialog.set_can_close(false);
    formatRow.set_sensitive(false);
    submit.set_sensitive(false);
    status.remove_css_class('error');
    status.set_label('Choose where to save the export.');
    status.set_visible(true);
    progress.set_visible(false);
    progress.set_fraction(0);
    const filter = new Gtk.FileFilter({
      name: `${format.label} ${kind === 'image' ? 'Images' : 'Videos'}`,
    });
    filter.add_mime_type(format.mimeType);
    filter.add_pattern(`*.${format.extension}`);
    if (format.id === 'jpeg') filter.add_pattern('*.jpeg');
    const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
    filters.append(filter);
    const chooser = new Gtk.FileDialog({
      title: dialog.title,
      initial_name: `${stem}.${format.extension}`,
      filters,
      default_filter: filter,
      modal: true,
    });
    try {
      const file = await new Promise((resolve, reject) => {
        chooser.save(parent, active, (source, result) => {
          try {
            resolve(source.save_finish(result));
          } catch (error) {
            reject(error);
          }
        });
      });
      if (active.is_cancelled()) return;
      const selectedPath = file.get_path();
      if (!selectedPath) throw new Error('Choose a local folder for the export.');
      const targetPath = exportPathForFormat(selectedPath, format);
      report({ fraction: null, message: 'Preparing export…' });
      await runExport({ targetPath, format: format.id, cancellable: active, onProgress: report });
      if (closed) return;
      report({ fraction: 1, message: `Exported ${GLib.path_get_basename(targetPath)}` });
      complete = true;
      cancel.set_visible(false);
      submit.set_label('Done');
    } catch (error) {
      if (closed) return;
      progress.set_visible(false);
      if (isCancellation(error) || active.is_cancelled()) status.set_label('Export cancelled.');
      else {
        status.set_label(error.message || 'Export failed. Try again.');
        status.add_css_class('error');
      }
    } finally {
      stopPulse();
      active = null;
      if (!closed) {
        dialog.set_can_close(true);
        formatRow.set_sensitive(!complete);
        submit.set_sensitive(true);
        cancel.set_sensitive(true);
        if (closeAfterCancel) dialog.close();
        else submit.grab_focus();
      }
    }
  });
  dialog.present(parent);
  return {
    present: () => dialog.present(parent),
    dispose: () => {
      active?.cancel();
      stopPulse();
      closed = true;
      dialog.force_close();
    },
  };
}

function recentWorkspaceDateLabel(modifiedSeconds) {
  const modified = GLib.DateTime.new_from_unix_local(Number(modifiedSeconds ?? 0));
  if (!modified) return 'Saved workspace';
  const today = GLib.DateTime.new_now_local();
  const sameDay = (left, right) =>
    left.get_year() === right.get_year() &&
    left.get_month() === right.get_month() &&
    left.get_day_of_month() === right.get_day_of_month();
  const time = modified.format('%H:%M');
  if (sameDay(modified, today)) return `Edited today at ${time}`;
  const yesterday = today.add_days(-1);
  if (sameDay(modified, yesterday)) return `Edited yesterday at ${time}`;
  return `Edited ${modified.format('%b %d, %Y')}`;
}

function clearRecentWorkspacePreview(card) {
  card?._bolasPreviewBinding?.cancellable.cancel();
  if (card) card._bolasPreviewBinding = null;
  const preview = card?._bolasPreview;
  preview?.get_child_by_name?.('preview')?.set_paintable(null);
  preview?.set_visible_child_name?.('fallback');
}

function bindRecentWorkspacePreview(card, workspacePath, workspaceModifiedSeconds) {
  clearRecentWorkspacePreview(card);
  const preview = card._bolasPreview;
  const picture = preview.get_child_by_name('preview');
  const file = Gio.File.new_for_path(workspacePreviewPath(workspacePath));
  const binding = { cancellable: new Gio.Cancellable() };
  card._bolasPreviewBinding = binding;

  file.query_info_async(
    [Gio.FILE_ATTRIBUTE_STANDARD_TYPE, Gio.FILE_ATTRIBUTE_TIME_MODIFIED].join(','),
    Gio.FileQueryInfoFlags.NONE,
    GLib.PRIORITY_DEFAULT,
    binding.cancellable,
    (source, result) => {
      try {
        const info = source.query_info_finish(result);
        if (card._bolasPreviewBinding !== binding) return;
        const previewModified = Number(info.get_attribute_uint64(Gio.FILE_ATTRIBUTE_TIME_MODIFIED));
        if (
          info.get_file_type() !== Gio.FileType.REGULAR ||
          previewModified < Number(workspaceModifiedSeconds ?? 0)
        )
          return;
        picture.set_paintable(Gdk.Texture.new_from_file(source));
        preview.set_visible_child_name('preview');
      } catch (error) {
        const missing = error?.matches?.(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND);
        if (!isCancellation(error) && !missing)
          logError(error, 'Failed to load Bolas workspace preview');
      }
    },
  );
}

function clearMediaFolderPreview(thumbnail) {
  const picture = thumbnail.get_child_by_name('preview');
  const videoPreview = thumbnail._bolasVideoPreview;

  if (videoPreview) {
    for (const signalId of videoPreview.signalIds) thumbnail.disconnect(signalId);
    videoPreview.cancellable?.cancel();
    thumbnail._bolasVideoPreview = null;
  }

  picture.set_file(null);
  thumbnail.set_visible_child_name('fallback');
}

function bindMediaFolderVideoPreview(thumbnail, file, info, thumbnailQueue) {
  clearMediaFolderPreview(thumbnail);

  const picture = thumbnail.get_child_by_name('preview');
  const preview = { cancellable: null, signalIds: [] };
  thumbnail._bolasVideoPreview = preview;

  const stopPreview = () => {
    if (thumbnail._bolasVideoPreview !== preview) return;
    preview.cancellable?.cancel();
    preview.cancellable = null;
    picture.set_file(null);
    thumbnail.set_visible_child_name('fallback');
  };
  const startPreview = () => {
    if (thumbnail._bolasVideoPreview !== preview) return;
    if (preview.cancellable) return;

    const cancellable = new Gio.Cancellable();
    preview.cancellable = cancellable;
    thumbnailQueue
      .request({
        cancellable,
        fileSize: Number(info.get_size()),
        modifiedTime: Number(info.get_attribute_uint64(Gio.FILE_ATTRIBUTE_TIME_MODIFIED)),
        sourcePath: file.get_path(),
      })
      .then((thumbnailPath) => {
        if (
          thumbnail._bolasVideoPreview !== preview ||
          preview.cancellable !== cancellable ||
          !thumbnail.get_mapped()
        )
          return;
        picture.set_file(Gio.File.new_for_path(thumbnailPath));
        thumbnail.set_visible_child_name('preview');
      })
      .catch((error) => {
        if (
          thumbnail._bolasVideoPreview !== preview ||
          preview.cancellable !== cancellable ||
          isVideoThumbnailCancellation(error)
        )
          return;
        thumbnail.set_visible_child_name('fallback');
      })
      .finally(() => {
        if (thumbnail._bolasVideoPreview === preview && preview.cancellable === cancellable)
          preview.cancellable = null;
      });
  };
  preview.signalIds = [
    thumbnail.connect('map', startPreview),
    thumbnail.connect('unmap', stopPreview),
  ];
  if (thumbnail.get_mapped()) startPreview();
}

export const BolasWindow = GObject.registerClass(
  class BolasWindow extends Adw.ApplicationWindow {
    constructor(application, { onCapture, onEdit, onMediaChange, onOpen }) {
      super({
        application,
        default_height: DEFAULT_WINDOW_HEIGHT,
        default_width: DEFAULT_WINDOW_WIDTH,
        title: APP_NAME,
      });

      this._onCapture = onCapture;
      this._onEdit = onEdit;
      this._onMediaChange = onMediaChange;
      this._onOpen = onOpen;
      this._videoThumbnailQueue = new VideoThumbnailQueue();
      this._workspaceChild = null;
      this._workspaceController = null;
      this._workspacePage = null;
      this._retiringWorkspace = null;
      this._allowWorkspaceClose = false;
      this.set_content(this._buildView());
      this.connect('close-request', () => this._onCloseRequest());
      this.connect('destroy', () => this._clearWorkspace());
    }

    showHome({ animate = true } = {}) {
      this._stack.set_visible_child_name('home');
      this._title.set_title(APP_NAME);
      this._title.set_subtitle('');
      this._leaveWorkspace({ animate });
      this._refreshRecentWorkspacePreviews();
    }

    showWorkspace(child, controller = null) {
      if (!child) return false;

      this._folderSplitView.set_show_sidebar(false);
      if (this._workspacePage || this._retiringWorkspace) {
        this._navigationView.replace([this._basePage]);
        this._clearWorkspace();
      }
      this._workspaceChild = child;
      this._workspaceController = controller;
      this._workspacePage = new Adw.NavigationPage({
        can_pop: false,
        child,
        title: 'Workspace',
      });
      this._navigationView.push(this._workspacePage);
      return true;
    }

    closeAfterWorkspaceConfirmation() {
      this._allowWorkspaceClose = true;
      this.close();
    }

    openFile(file) {
      this._requestMediaChange(inspectMediaFile(file));
    }

    showMedia(mediaPath) {
      this._requestMediaChange(inspectMediaPath(mediaPath));
    }

    toast(message) {
      this._toastOverlay.add_toast(new Adw.Toast({ title: String(message ?? '') }));
    }

    setCaptureBusy(busy) {
      this._captureButton?.set_sensitive(!busy);
      this._emptyCaptureButton?.set_sensitive(!busy);
    }

    _requestMediaChange(media) {
      this._onMediaChange?.();
      if (
        this._workspaceController?.requestWorkspaceReplacement?.(() =>
          this._showInspectedMedia(media),
        )
      )
        return;
      this._showInspectedMedia(media);
    }

    _showInspectedMedia(media) {
      this.present();
      this._onEdit?.(media.path, media.kind);
    }

    _buildView() {
      const toolbarView = new Adw.ToolbarView();
      toolbarView.add_top_bar(this._buildHeaderBar());

      this._stack = new Gtk.Stack({
        transition_type: Gtk.StackTransitionType.CROSSFADE,
        vexpand: true,
      });
      this._stack.add_named(this._buildHomeView(), 'home');
      toolbarView.set_content(this._stack);

      this._folderSplitView = new Adw.OverlaySplitView({
        content: toolbarView,
        enable_hide_gesture: true,
        enable_show_gesture: true,
        pin_sidebar: false,
        show_sidebar: false,
        sidebar: this._buildScreenshotFolderPanel(),
        sidebar_position: Gtk.PackType.END,
      });
      this._folderSplitView.set_min_sidebar_width(MEDIA_FOLDER_SIDEBAR_MIN_WIDTH);
      this._folderSplitView.set_max_sidebar_width(MEDIA_FOLDER_SIDEBAR_MAX_WIDTH);
      this._folderSplitView.set_sidebar_width_fraction(MEDIA_FOLDER_SIDEBAR_WIDTH_FRACTION);
      this._folderSplitView.connect('notify::show-sidebar', () => {
        const visible = this._folderSplitView.get_show_sidebar();
        if (this._folderButton.get_active() !== visible) this._folderButton.set_active(visible);
        this._folderButton.set_tooltip_text(
          visible ? 'Collapse Media Folders' : 'Show Media Folders',
        );
      });

      this._toastOverlay = new Adw.ToastOverlay({ child: this._folderSplitView });
      this._navigationView = new Adw.NavigationView({
        animate_transitions: true,
        pop_on_escape: false,
      });
      this._basePage = new Adw.NavigationPage({
        can_pop: false,
        child: this._toastOverlay,
        tag: 'main',
        title: APP_NAME,
      });
      this._navigationView.add(this._basePage);
      this.showHome();
      return this._navigationView;
    }

    _buildHeaderBar() {
      const headerBar = new Adw.HeaderBar();
      this._mainHeader = headerBar;
      this._title = new Adw.WindowTitle({ title: APP_NAME });
      headerBar.set_title_widget(this._title);

      const home = new Gtk.Button({
        css_classes: ['flat'],
        icon_name: 'go-home-symbolic',
        tooltip_text: 'Home',
      });
      home.connect('clicked', () => this.showHome());
      headerBar.pack_start(home);

      this._folderButton = new Gtk.ToggleButton({
        icon_name: 'sidebar-show-right-symbolic',
        tooltip_text: 'Show Media Folders',
      });
      this._folderButton.connect('toggled', () => {
        const show = this._folderButton.get_active();
        if (this._folderSplitView && this._folderSplitView.get_show_sidebar() !== show)
          this._folderSplitView.set_show_sidebar(show);
      });
      headerBar.pack_end(this._folderButton);

      const menu = new Gio.Menu();
      menu.append('Take Screenshot', 'app.screenshot');
      menu.append('Open Image, Video, or Workspace…', 'app.open');
      menu.append('About Bolas', 'app.about');
      menu.append('Quit', 'app.quit');
      headerBar.pack_end(
        new Gtk.MenuButton({
          icon_name: 'open-menu-symbolic',
          menu_model: menu,
          tooltip_text: 'Main Menu',
        }),
      );
      return headerBar;
    }

    _buildHomeView() {
      const content = new Gtk.Box({
        hexpand: true,
        margin_bottom: 16,
        margin_end: 12,
        margin_start: 12,
        margin_top: 16,
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 14,
        vexpand: true,
      });

      const pageHeader = new Gtk.Box({
        hexpand: true,
        margin_end: 2,
        margin_start: 2,
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 16,
        visible: false,
      });
      this._recentPageHeader = pageHeader;
      pageHeader.append(
        new Gtk.Label({
          css_classes: ['title-2'],
          hexpand: true,
          label: 'Recents',
          xalign: 0,
        }),
      );
      const headerActions = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 10,
        valign: Gtk.Align.CENTER,
      });
      this._captureButton = new Gtk.Button({
        css_classes: ['circular'],
        height_request: 36,
        icon_name: 'camera-photo-symbolic',
        tooltip_text: 'Take Screenshot',
        valign: Gtk.Align.CENTER,
        width_request: 36,
      });
      this._captureButton.update_property([Gtk.AccessibleProperty.LABEL], ['Take Screenshot']);
      this._captureButton.connect('clicked', () => this._onCapture?.());
      headerActions.append(this._captureButton);
      const openButton = actionButton(
        'document-open-symbolic',
        'Open File',
        () => this._onOpen?.(),
        true,
      );
      openButton.remove_css_class('pill');
      openButton.set_size_request(-1, 36);
      headerActions.append(openButton);
      pageHeader.append(headerActions);
      content.append(pageHeader);

      this._homeContentStack = new Gtk.Stack({
        transition_type: Gtk.StackTransitionType.CROSSFADE,
        vexpand: true,
      });
      this._homeContentStack.add_named(this._buildEmptyHomeState(), 'empty');
      this._homeContentStack.add_named(this._buildRecentWorkspaceView(), 'recents');
      content.append(this._homeContentStack);
      this._updateRecentWorkspacesState();
      return content;
    }

    _buildEmptyHomeState() {
      const content = new Gtk.Box({
        halign: Gtk.Align.CENTER,
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 20,
        valign: Gtk.Align.CENTER,
        vexpand: true,
      });

      const frame = new Gtk.Overlay({
        css_classes: ['image-frame'],
        halign: Gtk.Align.CENTER,
        height_request: 230,
        width_request: 380,
      });
      frame.set_child(
        new Gtk.Image({
          css_classes: ['image-glyph'],
          icon_name: 'image-x-generic-symbolic',
          pixel_size: 64,
        }),
      );
      for (const [horizontal, vertical, cornerClass] of [
        [Gtk.Align.START, Gtk.Align.START, 'top-left'],
        [Gtk.Align.END, Gtk.Align.START, 'top-right'],
        [Gtk.Align.START, Gtk.Align.END, 'bottom-left'],
        [Gtk.Align.END, Gtk.Align.END, 'bottom-right'],
      ]) {
        frame.add_overlay(
          new Gtk.Box({
            css_classes: ['frame-corner', cornerClass],
            halign: horizontal,
            height_request: 38,
            valign: vertical,
            width_request: 38,
          }),
        );
      }
      content.append(frame);
      content.append(
        new Gtk.Label({
          css_classes: ['title-2'],
          label: 'Create your first workspace',
        }),
      );
      content.append(
        new Gtk.Label({
          css_classes: ['dim-label', 'welcome-copy'],
          justify: Gtk.Justification.CENTER,
          label: 'Take a screenshot or open media to begin. Saved projects appear here.',
          max_width_chars: 52,
          wrap: true,
        }),
      );
      const actions = new Gtk.Box({
        halign: Gtk.Align.CENTER,
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 10,
      });
      this._emptyCaptureButton = actionButton(
        'camera-photo-symbolic',
        'Take Screenshot',
        () => this._onCapture?.(),
        true,
      );
      actions.append(this._emptyCaptureButton);
      const open = actionButton('document-open-symbolic', 'Open File', () => this._onOpen?.());
      actions.append(open);
      actions.append(
        actionButton('folder-pictures-symbolic', 'Screenshot Folder', () => {
          this._folderSplitView.set_show_sidebar(true);
        }),
      );
      content.append(actions);
      return content;
    }

    _buildRecentWorkspaceView() {
      const view = new Gtk.Stack({
        transition_type: Gtk.StackTransitionType.CROSSFADE,
        vexpand: true,
      });
      this._recentWorkspaceStatus = new Adw.StatusPage({
        icon_name: 'content-loading-symbolic',
        title: 'Loading Recents…',
      });
      view.add_named(this._recentWorkspaceStatus, 'status');

      let folderPath;
      try {
        folderPath = ensureManagedWorkspaceDirectory();
      } catch (error) {
        this._recentWorkspaceSetupError = error;
        this._recentWorkspaceStatus.set_icon_name('dialog-error-symbolic');
        this._recentWorkspaceStatus.set_title('Recents Are Unavailable');
        this._recentWorkspaceStatus.set_description(error.message);
        view.set_visible_child_name('status');
        return view;
      }

      const folder = Gio.File.new_for_path(folderPath);
      const directory = new Gtk.DirectoryList({
        attributes: [
          Gio.FILE_ATTRIBUTE_STANDARD_NAME,
          Gio.FILE_ATTRIBUTE_STANDARD_TYPE,
          Gio.FILE_ATTRIBUTE_TIME_MODIFIED,
        ].join(','),
        file: folder,
        monitored: true,
      });
      const workspaceFilter = Gtk.CustomFilter.new(
        (info) =>
          info?.get_file_type?.() === Gio.FileType.REGULAR &&
          isWorkspaceLibraryName(info.get_name()),
      );
      const workspaces = new Gtk.FilterListModel({ filter: workspaceFilter, model: directory });
      const newestFirst = Gtk.CustomSorter.new((left, right) => {
        const leftTime = Number(
          left?.get_attribute_uint64?.(Gio.FILE_ATTRIBUTE_TIME_MODIFIED) ?? 0,
        );
        const rightTime = Number(
          right?.get_attribute_uint64?.(Gio.FILE_ATTRIBUTE_TIME_MODIFIED) ?? 0,
        );
        if (leftTime === rightTime) return Gtk.Ordering.EQUAL;
        return leftTime > rightTime ? Gtk.Ordering.SMALLER : Gtk.Ordering.LARGER;
      });
      const sortedWorkspaces = new Gtk.SortListModel({ model: workspaces, sorter: newestFirst });
      const gridModel = new Gtk.NoSelection({ model: sortedWorkspaces });
      const factory = new Gtk.SignalListItemFactory();
      this._recentWorkspaceCards = new Set();
      factory.connect('setup', (_factory, listItem) => {
        const card = new Gtk.Box({
          css_classes: ['recent-workspace-card'],
          height_request: 220,
          orientation: Gtk.Orientation.VERTICAL,
          spacing: 10,
          width_request: 280,
        });
        const labels = new Gtk.Box({
          orientation: Gtk.Orientation.VERTICAL,
          spacing: 3,
        });
        labels.append(new Gtk.Label({ css_classes: ['heading'], ellipsize: 3, xalign: 0 }));
        labels.append(
          new Gtk.Label({ css_classes: ['caption', 'dim-label'], ellipsize: 3, xalign: 0 }),
        );
        const preview = new Gtk.Stack({
          css_classes: ['recent-workspace-preview'],
          halign: Gtk.Align.FILL,
          hexpand: true,
          overflow: Gtk.Overflow.HIDDEN,
          valign: Gtk.Align.FILL,
          vexpand: true,
        });
        preview.add_named(
          new Gtk.Picture({
            can_shrink: true,
            content_fit: Gtk.ContentFit.CONTAIN,
            keep_aspect_ratio: true,
          }),
          'preview',
        );
        preview.add_named(
          new Gtk.Image({
            css_classes: ['dim-label'],
            halign: Gtk.Align.CENTER,
            icon_name: 'document-save-symbolic',
            pixel_size: 48,
            valign: Gtk.Align.CENTER,
          }),
          'fallback',
        );
        preview.set_visible_child_name('fallback');
        card._bolasLabels = labels;
        card._bolasPreview = preview;
        this._recentWorkspaceCards.add(card);
        card.append(preview);
        card.append(labels);
        listItem.set_child(card);
      });
      factory.connect('bind', (_factory, listItem) => {
        const info = listItem.get_item();
        const card = listItem.get_child();
        const labels = card._bolasLabels;
        const title = labels.get_first_child();
        const details = title.get_next_sibling();
        const name = info.get_name();
        const displayName = workspaceLibraryTitle(name);
        const modified = recentWorkspaceDateLabel(
          info.get_attribute_uint64(Gio.FILE_ATTRIBUTE_TIME_MODIFIED),
        );
        card._bolasWorkspacePath = folder.get_child(name).get_path();
        card._bolasWorkspaceModified = info.get_attribute_uint64(Gio.FILE_ATTRIBUTE_TIME_MODIFIED);
        title.set_label(displayName);
        details.set_label(modified);
        card.set_tooltip_text(displayName);
        bindRecentWorkspacePreview(card, card._bolasWorkspacePath, card._bolasWorkspaceModified);
        card.update_property(
          [Gtk.AccessibleProperty.LABEL, Gtk.AccessibleProperty.DESCRIPTION],
          [displayName, modified],
        );
      });
      factory.connect('unbind', (_factory, listItem) => {
        const card = listItem.get_child();
        clearRecentWorkspacePreview(card);
        card._bolasWorkspacePath = null;
        card._bolasWorkspaceModified = 0;
      });
      factory.connect('teardown', (_factory, listItem) => {
        this._recentWorkspaceCards.delete(listItem.get_child());
      });

      const grid = new Gtk.GridView({
        enable_rubberband: false,
        factory,
        max_columns: 4,
        min_columns: 1,
        model: gridModel,
        single_click_activate: true,
      });
      grid.add_css_class('recent-workspace-grid');
      grid.connect('activate', (_grid, position) => {
        const info = gridModel.get_item(position);
        if (!info) return;
        try {
          this.showMedia(folder.get_child(info.get_name()).get_path());
        } catch (error) {
          this.toast(error.message);
        }
      });
      view.add_named(
        new Gtk.ScrolledWindow({
          child: grid,
          hscrollbar_policy: Gtk.PolicyType.NEVER,
          vexpand: true,
        }),
        'list',
      );

      this._recentWorkspaceSource = { directory, view, workspaces };
      const updateState = () => this._updateRecentWorkspacesState();
      directory.connect('notify::loading', updateState);
      directory.connect('notify::error', updateState);
      workspaces.connect('items-changed', updateState);
      return view;
    }

    _refreshRecentWorkspacePreviews() {
      for (const card of this._recentWorkspaceCards ?? []) {
        if (!card._bolasWorkspacePath) continue;
        bindRecentWorkspacePreview(card, card._bolasWorkspacePath, card._bolasWorkspaceModified);
      }
    }

    _updateRecentWorkspacesState() {
      if (!this._homeContentStack) return;
      if (this._recentWorkspaceSetupError) {
        this._recentPageHeader?.set_visible(true);
        this._homeContentStack.set_visible_child_name('recents');
        return;
      }

      const source = this._recentWorkspaceSource;
      if (!source) {
        this._recentPageHeader?.set_visible(false);
        this._homeContentStack.set_visible_child_name('empty');
        return;
      }
      const error = source.directory.error;
      const count = source.workspaces.get_n_items();
      if (error) {
        this._recentPageHeader?.set_visible(true);
        this._recentWorkspaceStatus.set_icon_name('dialog-error-symbolic');
        this._recentWorkspaceStatus.set_title('Recents Could Not Be Loaded');
        this._recentWorkspaceStatus.set_description(error.message);
        source.view.set_visible_child_name('status');
        this._homeContentStack.set_visible_child_name('recents');
      } else if (source.directory.loading && count === 0) {
        this._recentPageHeader?.set_visible(false);
        this._recentWorkspaceStatus.set_icon_name('content-loading-symbolic');
        this._recentWorkspaceStatus.set_title('Loading Recents…');
        this._recentWorkspaceStatus.set_description('');
        source.view.set_visible_child_name('status');
        this._homeContentStack.set_visible_child_name('recents');
      } else if (count > 0) {
        this._recentPageHeader?.set_visible(true);
        source.view.set_visible_child_name('list');
        this._homeContentStack.set_visible_child_name('recents');
      } else {
        this._recentPageHeader?.set_visible(false);
        this._homeContentStack.set_visible_child_name('empty');
      }
    }

    _buildScreenshotFolderPanel() {
      this._folderSources = [];
      const pages = new Adw.ViewStack({ vexpand: true });
      const screenshots = this._buildMediaFolderPage({
        acceptsName: isSupportedImageName,
        emptyTitle: 'No Screenshots Yet',
        folderPath: screenshotFolderPath(),
        iconName: 'folder-pictures-symbolic',
        loadingTitle: 'Loading Screenshots…',
        missingTitle: 'Screenshot Folder Not Found',
        noun: 'Screenshots',
        previewKind: 'image',
      });
      const screencasts = this._buildMediaFolderPage({
        acceptsName: isSupportedVideoName,
        emptyTitle: 'No Screencasts Yet',
        folderPath: screencastFolderPath(),
        iconName: 'video-x-generic-symbolic',
        loadingTitle: 'Loading Screencasts…',
        missingTitle: 'Screencast Folder Not Found',
        noun: 'Screencasts',
        previewKind: 'video',
      });
      pages.add_titled_with_icon(
        screenshots.view,
        'screenshots',
        'Screenshots',
        'folder-pictures-symbolic',
      );
      pages.add_titled_with_icon(
        screencasts.view,
        'screencasts',
        'Screencasts',
        'video-x-generic-symbolic',
      );

      const toolbar = new Adw.ToolbarView();
      const header = new Adw.HeaderBar({
        show_end_title_buttons: false,
        show_start_title_buttons: false,
        title_widget: new Adw.ViewSwitcher({
          policy: Adw.ViewSwitcherPolicy.WIDE,
          stack: pages,
        }),
      });
      const close = new Gtk.Button({
        icon_name: 'window-close-symbolic',
        tooltip_text: 'Close Media Folders',
      });
      close.connect('clicked', () => this._folderSplitView.set_show_sidebar(false));
      header.pack_end(close);
      toolbar.add_top_bar(header);
      toolbar.set_content(pages);
      toolbar.add_css_class('screenshot-folder-panel');
      return toolbar;
    }

    _buildMediaFolderPage({
      acceptsName,
      emptyTitle,
      folderPath,
      iconName,
      loadingTitle,
      missingTitle,
      noun,
      previewKind,
    }) {
      const folder = Gio.File.new_for_path(folderPath);
      const directory = new Gtk.DirectoryList({
        attributes: [
          Gio.FILE_ATTRIBUTE_STANDARD_NAME,
          Gio.FILE_ATTRIBUTE_STANDARD_SIZE,
          Gio.FILE_ATTRIBUTE_STANDARD_TYPE,
          Gio.FILE_ATTRIBUTE_TIME_MODIFIED,
        ].join(','),
        file: folder,
        monitored: true,
      });

      const mediaFilter = Gtk.CustomFilter.new(
        (info) => info?.get_file_type?.() === Gio.FileType.REGULAR && acceptsName(info.get_name()),
      );
      const media = new Gtk.FilterListModel({
        filter: mediaFilter,
        model: directory,
      });
      const newestFirst = Gtk.CustomSorter.new((left, right) => {
        const leftTime = Number(
          left?.get_attribute_uint64?.(Gio.FILE_ATTRIBUTE_TIME_MODIFIED) ?? 0,
        );
        const rightTime = Number(
          right?.get_attribute_uint64?.(Gio.FILE_ATTRIBUTE_TIME_MODIFIED) ?? 0,
        );
        if (leftTime === rightTime) return Gtk.Ordering.EQUAL;
        return leftTime > rightTime ? Gtk.Ordering.SMALLER : Gtk.Ordering.LARGER;
      });
      const sortedMedia = new Gtk.SortListModel({
        model: media,
        sorter: newestFirst,
      });
      const selection = new Gtk.SingleSelection({
        autoselect: false,
        can_unselect: true,
        model: sortedMedia,
      });

      const factory = new Gtk.SignalListItemFactory();
      factory.connect('setup', (_factory, listItem) => {
        const cell = new Gtk.Box({
          css_classes: ['screenshot-folder-cell'],
          orientation: Gtk.Orientation.VERTICAL,
          spacing: 6,
        });
        const thumbnail = new Gtk.Stack({
          css_classes: ['screenshot-folder-thumbnail'],
        });
        thumbnail.add_named(
          new Gtk.Picture({
            can_shrink: true,
            content_fit: Gtk.ContentFit.COVER,
            keep_aspect_ratio: true,
          }),
          'preview',
        );
        thumbnail.add_named(
          new Gtk.Image({
            css_classes: ['dim-label'],
            icon_name: 'video-x-generic-symbolic',
            pixel_size: 44,
          }),
          'fallback',
        );
        const thumbnailFrame = new MediaFolderAspectFrame({
          child: thumbnail,
          obey_child: false,
          ratio: MEDIA_FOLDER_THUMBNAIL_ASPECT_RATIO,
        });
        cell.append(thumbnailFrame);
        cell.append(
          new Gtk.Label({
            css_classes: ['caption'],
            ellipsize: 3,
            max_width_chars: 22,
            xalign: 0,
          }),
        );
        listItem.set_child(cell);
      });
      factory.connect('bind', (_factory, listItem) => {
        const info = listItem.get_item();
        const cell = listItem.get_child();
        const thumbnailFrame = cell.get_first_child();
        const thumbnail = thumbnailFrame.get_child();
        const picture = thumbnail.get_child_by_name('preview');
        const label = thumbnailFrame.get_next_sibling();
        const name = info.get_name();
        if (previewKind === 'image') {
          clearMediaFolderPreview(thumbnail);
          picture.set_file(folder.get_child(name));
          thumbnail.set_visible_child_name('preview');
        } else {
          bindMediaFolderVideoPreview(
            thumbnail,
            folder.get_child(name),
            info,
            this._videoThumbnailQueue,
          );
        }
        label.set_label(name);
        cell.set_tooltip_text(name);
      });
      factory.connect('unbind', (_factory, listItem) => {
        const cell = listItem.get_child();
        const thumbnail = cell?.get_first_child()?.get_child();
        if (thumbnail) clearMediaFolderPreview(thumbnail);
      });
      const grid = new Gtk.GridView({
        enable_rubberband: false,
        factory,
        max_columns: 2,
        min_columns: 1,
        model: selection,
        single_click_activate: true,
      });
      grid.add_css_class('screenshot-folder-grid');
      grid.connect('activate', (_grid, position) => {
        const info = selection.get_item(position);
        if (!info) return;
        try {
          this.showMedia(folder.get_child(info.get_name()).get_path());
          this._folderSplitView.set_show_sidebar(false);
        } catch (error) {
          this.toast(error.message);
        }
      });

      const scroller = new Gtk.ScrolledWindow({
        child: grid,
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        vexpand: true,
      });
      const stack = new Gtk.Stack({
        transition_type: Gtk.StackTransitionType.CROSSFADE,
        vexpand: true,
      });
      stack.add_named(scroller, 'grid');
      const status = new Adw.StatusPage({
        icon_name: iconName,
        title: emptyTitle,
      });
      stack.add_named(status, 'status');

      const source = {
        directory,
        emptyTitle,
        folder,
        folderPath,
        iconName,
        loadingTitle,
        media,
        missingTitle,
        noun,
        selection,
        stack,
        status,
        view: stack,
      };
      this._folderSources.push(source);
      const updateState = () => this._updateMediaFolderState(source);
      directory.connect('notify::loading', updateState);
      directory.connect('notify::error', updateState);
      media.connect('items-changed', updateState);
      this._updateMediaFolderState(source);
      return source;
    }

    _updateMediaFolderState(source) {
      const count = source.media.get_n_items();
      const error = source.directory.error;
      if (count > 0) {
        source.stack.set_visible_child_name('grid');
        return;
      }

      source.stack.set_visible_child_name('status');
      if (source.directory.loading) {
        source.status.set_icon_name('content-loading-symbolic');
        source.status.set_title(source.loadingTitle);
        source.status.set_description('');
      } else if (error) {
        source.status.set_icon_name(source.iconName);
        source.status.set_title(source.missingTitle);
        source.status.set_description(
          `Bolas looks for ${source.noun.toLowerCase()} in ${source.folderPath}`,
        );
      } else {
        source.status.set_icon_name(source.iconName);
        source.status.set_title(source.emptyTitle);
        source.status.set_description(
          `${source.noun} saved in ${source.folderPath} will appear here.`,
        );
      }
    }

    _leaveWorkspace({ animate = true } = {}) {
      if (!this._workspacePage) return;

      const record = {
        child: this._workspaceChild,
        controller: this._workspaceController,
        hiddenSignalId: 0,
        page: this._workspacePage,
      };
      this._workspaceChild = null;
      this._workspaceController = null;
      this._workspacePage = null;
      this._retiringWorkspace = record;

      record.page.set_can_pop(true);
      record.hiddenSignalId = record.page.connect('hidden', () =>
        this._disposeWorkspaceRecord(record),
      );
      const previousAnimationPreference = this._navigationView.get_animate_transitions();
      let popped = false;
      try {
        if (!animate) this._navigationView.set_animate_transitions(false);
        popped = this._navigationView.pop_to_page(this._basePage);
      } finally {
        if (!animate) {
          this._navigationView.set_animate_transitions(previousAnimationPreference);
        }
      }

      if (!popped) {
        this._navigationView.replace([this._basePage]);
        this._disposeWorkspaceRecord(record);
      }
    }

    _clearWorkspace() {
      const records = [];
      if (this._workspacePage || this._workspaceChild || this._workspaceController)
        records.push({
          child: this._workspaceChild,
          controller: this._workspaceController,
          hiddenSignalId: 0,
          page: this._workspacePage,
        });
      if (this._retiringWorkspace) records.push(this._retiringWorkspace);

      this._workspaceChild = null;
      this._workspaceController = null;
      this._workspacePage = null;
      this._retiringWorkspace = null;
      for (const record of records) this._disposeWorkspaceRecord(record);
    }

    _disposeWorkspaceRecord(record) {
      if (!record || record.disposed) return;
      record.disposed = true;
      if (record.hiddenSignalId) {
        record.page?.disconnect(record.hiddenSignalId);
        record.hiddenSignalId = 0;
      }
      if (record.page?.get_child?.() === record.child) record.page.set_child(null);
      record.controller?.disposeEmbedded?.();
      if (this._retiringWorkspace === record) this._retiringWorkspace = null;
    }

    _onCloseRequest() {
      const controller = this._workspaceController ?? this._retiringWorkspace?.controller;
      if (this._allowWorkspaceClose || !controller) return false;
      return Boolean(controller.requestHostClose?.());
    }
  },
);

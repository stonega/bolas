import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango';
import Cairo from 'cairo';

import { createBundledIcon } from '../bundledIcons.js';
import { WORKSPACE_MIME_TYPE } from '../config.js';
import { getUserPreferences, sharePreferencesForSource } from '../preferences.js';
import { shareImage } from '../services/image-share.js';
import { readImageWorkspace, writeImageWorkspace } from '../services/workspace-file.js';
import { isManagedWorkspacePath, managedWorkspaceSavePath } from '../services/workspace-library.js';
import { removeWorkspacePreview, writeWorkspacePreview } from '../services/workspace-preview.js';
import { createShareSettingsControls } from '../share/controls.js';
import {
  createManagedSharePath,
  pixbufHasTransparency,
  shareCanvasSize,
} from '../share/renderer.js';
import * as DocumentModel from './document.js';
import * as ImageRenderer from './renderer.js';
import { createImageWorkspace, workspaceSourceBytes } from './workspace.js';

const { ImageDocument } = DocumentModel;

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 12;
const CANVAS_PADDING = 24;
const HANDLE_SIZE = 9;
const CURVE_HANDLE_SIZE = 14;
const CROP_MIN_SIZE = 0.01;
const NARROW_WIDTH = 760;
const MAX_PREVIEW_DIMENSION = 1600;
const FULLSCREEN_REQUEST_TIMEOUT_MS = 2000;
const POINTER_CLICK_THRESHOLD = 6;

const TOOL_LABELS = [
  ['select', 'Select'],
  ['pencil', 'Pencil'],
  ['line', 'Line'],
  ['arrow', 'Arrow'],
  ['rectangle', 'Rectangle'],
  ['ellipse', 'Ellipse'],
  ['text', 'Text'],
];

const TOOL_ICONS = {
  select: { file: 'tool-select-symbolic.svg', fallback: 'input-mouse-symbolic' },
  pencil: { file: 'tool-pencil-symbolic.svg', fallback: 'document-edit-symbolic' },
  line: { file: 'tool-line-symbolic.svg', fallback: 'list-remove-symbolic' },
  arrow: { file: 'tool-arrow-symbolic.svg', fallback: 'go-next-symbolic' },
  rectangle: { file: 'tool-rectangle-symbolic.svg', fallback: 'view-grid-symbolic' },
  ellipse: { file: 'tool-ellipse-symbolic.svg', fallback: 'media-record-symbolic' },
  text: { file: 'tool-text-symbolic.svg', fallback: 'insert-text-symbolic' },
};

const THICKNESSES = [
  ['Thin', 0.0025],
  ['Medium', 0.006],
  ['Thick', 0.012],
  ['Extra Thick', 0.022],
];

const TEXT_SIZES = [
  ['S', 0.03],
  ['M', 0.045],
  ['L', 0.06],
  ['XL', 0.09],
];

const PRESET_COLORS = [
  ['Black', '#1c1c1c'],
  ['Gray', '#9aa6b2'],
  ['Lavender', '#d56ef2'],
  ['Purple', '#b635c8'],
  ['Blue', '#3b5bdb'],
  ['Sky Blue', '#4a9ee8'],
  ['Amber', '#f4ab49'],
  ['Orange', '#e45a17'],
  ['Teal', '#07996f'],
  ['Green', '#49b568'],
  ['Coral', '#f47476'],
  ['Red', '#e52f36'],
];

const CROP_RATIOS = [
  ['Free', null, 'free'],
  ['Original', 'original', 'original'],
  ['Square', 1, 'square'],
  ['5:4', 5 / 4, '5:4'],
  ['4:3', 4 / 3, '4:3'],
  ['3:2', 3 / 2, '3:2'],
  ['16:9', 16 / 9, '16:9'],
];

function cropRatioFromId(id) {
  return CROP_RATIOS.find(([, , candidateId]) => candidateId === id)?.[1] ?? null;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function closestValueIndex(items, value) {
  const requested = Number(value);
  let bestIndex = 0;

  for (let index = 1; index < items.length; index++) {
    if (Math.abs(items[index][1] - requested) < Math.abs(items[bestIndex][1] - requested)) {
      bestIndex = index;
    }
  }

  return bestIndex;
}

function normalizedRect(start, end) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);

  return {
    x,
    y,
    width: Math.max(0.001, Math.abs(end.x - start.x)),
    height: Math.max(0.001, Math.abs(end.y - start.y)),
  };
}

function rgbaFromString(value, fallback = '#e01b24') {
  const rgba = new Gdk.RGBA();

  if (!rgba.parse(String(value ?? ''))) rgba.parse(fallback);

  return rgba;
}

function inlineTextAttributes(annotation, fontSize) {
  const rgba = rgbaFromString(annotation?.color ?? annotation?.strokeColor);
  const opacity = clamp(annotation?.opacity ?? 1, 0, 1);
  const requestedWeight = Number(annotation?.fontWeight);
  const weight = Number.isFinite(requestedWeight)
    ? clamp(Math.round(requestedWeight), Pango.Weight.THIN, Pango.Weight.ULTRAHEAVY)
    : Pango.Weight.NORMAL;
  const attributes = new Pango.AttrList();

  attributes.insert(
    Pango.attr_family_new(
      String(annotation?.fontFamily ?? DocumentModel.DEFAULT_ANNOTATION_STYLE.fontFamily),
    ),
  );
  attributes.insert(Pango.attr_weight_new(weight));
  attributes.insert(Pango.attr_size_new_absolute(Math.max(1, Math.round(fontSize * Pango.SCALE))));
  attributes.insert(
    Pango.attr_foreground_new(
      Math.round(clamp(rgba.red, 0, 1) * 65535),
      Math.round(clamp(rgba.green, 0, 1) * 65535),
      Math.round(clamp(rgba.blue, 0, 1) * 65535),
    ),
  );
  attributes.insert(
    Pango.attr_foreground_alpha_new(Math.round(clamp(rgba.alpha * opacity, 0, 1) * 65535)),
  );
  return attributes;
}

function colorComponents(value, fallback = [0.88, 0.11, 0.14, 1]) {
  const rgba = rgbaFromString(value);

  if (!rgba) return fallback;

  return [rgba.red, rgba.green, rgba.blue, rgba.alpha];
}

function closestPresetColorIndex(value) {
  const [red, green, blue] = colorComponents(value);
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  PRESET_COLORS.forEach(([, candidate], index) => {
    const [candidateRed, candidateGreen, candidateBlue] = colorComponents(candidate);
    const distance =
      (red - candidateRed) ** 2 + (green - candidateGreen) ** 2 + (blue - candidateBlue) ** 2;

    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function createColorSwatch(color) {
  const swatch = new Gtk.DrawingArea({
    content_width: 22,
    content_height: 22,
    accessible_role: Gtk.AccessibleRole.PRESENTATION,
  });
  const [red, green, blue, alpha] = colorComponents(color);

  swatch.set_draw_func((_area, cr, width, height) => {
    const radius = Math.max(1, Math.min(width, height) / 2 - 2);

    cr.setSourceRGBA(red, green, blue, alpha);
    cr.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
    cr.fill();
  });
  return swatch;
}

function basenameWithoutExtension(path) {
  const basename = GLib.path_get_basename(String(path ?? 'image'));
  const dot = basename.lastIndexOf('.');

  return dot > 0 ? basename.slice(0, dot) : basename;
}

function ensurePngExtension(path) {
  const normalized = String(path ?? '').trim();

  return normalized.toLowerCase().endsWith('.png') ? normalized : `${normalized}.png`;
}

function isEditableFocus(widget) {
  for (let current = widget; current; current = current.get_parent?.()) {
    if (
      current instanceof Gtk.Entry ||
      current instanceof Gtk.Text ||
      current instanceof Gtk.SpinButton ||
      current instanceof Gtk.TextView
    ) {
      return true;
    }
  }

  return false;
}

function isCancellation(error) {
  return Boolean(
    error?.matches?.(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED) ||
      error?.matches?.(Gtk.dialog_error_quark(), Gtk.DialogError.DISMISSED) ||
      error?.matches?.(Gtk.dialog_error_quark(), Gtk.DialogError.CANCELLED),
  );
}

function currentTimeValue() {
  const value = new GLib.TimeVal();
  GLib.get_current_time(value);
  return value;
}

function button(options = {}) {
  const widget = new Gtk.Button(options);

  widget.add_css_class('flat');
  return widget;
}

function sectionLabel(text) {
  const label = new Gtk.Label({
    label: text,
    xalign: 0,
    margin_top: 8,
  });
  label.add_css_class('heading');
  return label;
}

function annotationBounds(annotation) {
  if (!annotation || !DocumentModel.ANNOTATION_TYPES?.includes(annotation.type)) return null;

  if (DocumentModel.getAnnotationBounds)
    return DocumentModel.getAnnotationBounds(annotation, { includeStroke: true });

  if (annotation?.rect) return { ...annotation.rect };

  if (annotation?.start && annotation?.end) return normalizedRect(annotation.start, annotation.end);

  const points = annotation?.points ?? [];

  if (points.length > 0) {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);

    return {
      x,
      y,
      width: Math.max(0.001, Math.max(...xs) - x),
      height: Math.max(0.001, Math.max(...ys) - y),
    };
  }

  return null;
}

function resizeHandles(bounds) {
  if (DocumentModel.getResizeHandles) return DocumentModel.getResizeHandles(bounds);

  const { x, y, width, height } = bounds;

  return [
    { handle: 'nw', point: { x, y } },
    { handle: 'n', point: { x: x + width / 2, y } },
    { handle: 'ne', point: { x: x + width, y } },
    { handle: 'e', point: { x: x + width, y: y + height / 2 } },
    { handle: 'se', point: { x: x + width, y: y + height } },
    { handle: 's', point: { x: x + width / 2, y: y + height } },
    { handle: 'sw', point: { x, y: y + height } },
    { handle: 'w', point: { x, y: y + height / 2 } },
  ];
}

function hitAnnotations(annotations, point, tolerance) {
  if (DocumentModel.hitTestAnnotations)
    return DocumentModel.hitTestAnnotations(annotations, point, { tolerance });

  for (let index = annotations.length - 1; index >= 0; index--) {
    const annotation = annotations[index];
    const bounds = annotationBounds(annotation);

    if (
      bounds &&
      point.x >= bounds.x - tolerance &&
      point.x <= bounds.x + bounds.width + tolerance &&
      point.y >= bounds.y - tolerance &&
      point.y <= bounds.y + bounds.height + tolerance
    ) {
      return annotation;
    }
  }

  return null;
}

export const ImageViewerWindow = GObject.registerClass(
  {
    GTypeName: 'BolasImageEditorWindow',
  },
  class ImageViewerWindow extends Adw.Window {
    _init(options = {}) {
      const parent = options.parent ?? null;
      const image = options.image ?? {};
      const workspacePath = String(options.workspacePath ?? '');
      const initialPath = workspacePath || String(image.path ?? '');

      super._init({
        transient_for: parent,
        destroy_with_parent: true,
        modal: false,
        title: String(image.title ?? GLib.path_get_basename(initialPath) ?? 'Image'),
        default_width: 1040,
        default_height: 720,
      });

      this._parentWindow = parent;
      this._navigationHost = parent?.showWorkspace ? parent : null;
      this._embedded = Boolean(this._navigationHost);
      this._hostSignalIds = [];
      this._hostKeyController = null;
      this._disposed = false;
      this._image = {
        path: initialPath,
        title: String(image.title ?? GLib.path_get_basename(initialPath) ?? 'Image'),
        mimeType: String(image.mimeType ?? (workspacePath ? WORKSPACE_MIME_TYPE : '')),
        sourceKind: String(image.sourceKind ?? (workspacePath ? 'workspace' : 'image')),
      };
      this._workspacePath = workspacePath || null;
      this._workspaceLoad = options.workspaceLoad ?? null;
      this._workspaceEtag = null;
      this._workspaceSourceMetadata = null;
      this._workspaceSavePending = false;
      this._initialBackgroundEnabled = options.backgroundEnabled !== false;
      this._editedImageDirectory = options.editedImageDirectory ?? null;
      this._preferences = options.preferences ?? getUserPreferences();
      const remembered = this._preferences.getEditorPreferences();
      this._source = null;
      this._previewPixbuf = null;
      this._imageDocument = null;
      this._canvasDocument = null;
      this._document = null;
      this._activeLayer = 'image';
      this._backgroundEnabled = false;
      this._canvasRatioId = null;
      this._shareSettings = null;
      this._sourceHasTransparency = false;
      this._savedCompositionFingerprint = null;
      this._renderSurface = null;
      this._surfaceDirty = true;
      this._renderError = null;
      this._mode = 'view';
      this._tool = remembered.tool;
      this._strokeColor = remembered.strokeColor;
      this._fillColor = remembered.strokeColor;
      this._fillEnabled = remembered.fillEnabled;
      this._strokeWidth = remembered.strokeWidth;
      this._opacity = 1;
      this._text = 'Text';
      this._fontFamily = remembered.fontFamily;
      this._fontSize = remembered.fontSize;
      this._zoomFactor = 1;
      this._fit = true;
      this._panX = 0;
      this._panY = 0;
      this._dragState = null;
      this._dragOwner = null;
      this._inlineTextState = null;
      this._inlineTextFocusSourceId = 0;
      this._cropRect = { x: 0, y: 0, width: 1, height: 1 };
      this._cropRatio = cropRatioFromId(remembered.cropRatioId);
      this._cropPortrait = remembered.cropPortrait;
      this._conversionAccepted = false;
      this._busy = false;
      this._allowClose = false;
      this._narrowLayout = false;
      this._sidebarKind = null;
      this._syncingStyleControls = false;
      this._loadCancellable = new Gio.Cancellable();
      this._animationIter = null;
      this._animationSourceId = 0;
      this._fullscreenTransientParent = null;
      this._fullscreenRequestSourceId = 0;

      this._buildUi();
      this._installControllers();
      const host = this._hostWindow();
      this._hostSignalIds.push([
        host,
        host.connect('notify::width', () => {
          this._syncAdaptiveLayout();
          this._positionInlineTextEditor();
        }),
      ]);
      this._hostSignalIds.push([
        host,
        host.connect('notify::height', () => this._positionInlineTextEditor()),
      ]);
      this._hostSignalIds.push([
        host,
        host.connect('notify::fullscreened', () => this._syncFullscreenState()),
      ]);
      this.connect('close-request', () => this._onCloseRequest());
      this.connect('destroy', () => this._disposeResources());
      this._syncAdaptiveLayout();
      if (this._workspacePath) this._loadWorkspace();
      else this._load();
    }

    getEmbeddedContent() {
      return this._toastOverlay;
    }

    _shareSettingsValue() {
      const settings = this._shareSettings ?? {};
      return {
        cornerRadius: settings.cornerRadius,
        padding: settings.padding,
        presetId: settings.presetId,
        ratioId: settings.ratioId,
        shadow: settings.shadow,
        shadowStrength: settings.shadowStrength,
      };
    }

    _compositionFingerprint() {
      if (!this._imageDocument) return '';
      return JSON.stringify({
        backgroundEnabled: this._backgroundEnabled,
        canvas: this._backgroundEnabled ? (this._canvasDocument?.toJSON?.() ?? null) : null,
        image: this._imageDocument.toJSON(),
        settings: this._backgroundEnabled ? this._shareSettingsValue() : null,
      });
    }

    _markCompositionSaved() {
      this._imageDocument?.markSaved();
      this._canvasDocument?.markSaved();
      this._savedCompositionFingerprint = this._compositionFingerprint();
    }

    _isDirty() {
      return Boolean(
        this._imageDocument &&
          this._savedCompositionFingerprint !== null &&
          this._compositionFingerprint() !== this._savedCompositionFingerprint,
      );
    }

    _ensureCanvasDocument() {
      if (this._canvasDocument) return this._canvasDocument;
      const { width, height } = shareCanvasSize(this._shareSettings?.ratioId);
      this._canvasDocument = new ImageDocument({ height, historyLimit: 100, width });
      this._canvasRatioId = this._shareSettings.ratioId;
      return this._canvasDocument;
    }

    _syncCanvasForSettings() {
      const nextRatioId = this._shareSettings?.ratioId;
      if (!this._canvasDocument || this._canvasRatioId === nextRatioId) return;

      const previous = this._canvasDocument;
      const { width, height } = shareCanvasSize(nextRatioId);
      const selectedId = previous.selectionId;
      const hadTransforms = previous.transforms.length > 0;
      this._canvasDocument = new ImageDocument({
        annotations: previous.annotations,
        height,
        historyLimit: 100,
        width,
      });
      this._canvasDocument.select(selectedId);
      this._canvasRatioId = nextRatioId;
      if (this._activeLayer === 'canvas') this._document = this._canvasDocument;
      if (hadTransforms) this._toast('Canvas crop and rotation reset for the new aspect ratio.');
    }

    _syncActiveDocument() {
      this._document =
        this._backgroundEnabled && this._activeLayer === 'canvas'
          ? this._ensureCanvasDocument()
          : this._imageDocument;
    }

    _setBackgroundEnabled(enabled, { preservePanel = false, reveal = true } = {}) {
      const next = Boolean(enabled);
      if (next && (!this._source || !this._shareSettings)) return false;
      this._backgroundEnabled = next;
      if (next) this._ensureCanvasDocument();
      this._activeLayer = next ? 'canvas' : 'image';
      this._syncActiveDocument();
      this._surfaceDirty = true;
      this._fitImage();

      if (this._mode === 'view') {
        if (next || preservePanel) {
          this._sidebarKind = 'background';
          if (!preservePanel) this._sidebarScroller.set_child(this._createBackgroundSidebar());
          if (reveal) this._setSidebarVisible(true);
        } else {
          this._sidebarKind = null;
          if (this._sidebarVisible()) this._setSidebarVisible(false);
        }
      }
      this._syncActionSensitivity();
      return true;
    }

    _selectCompositionLayer(layer) {
      const next = this._backgroundEnabled && layer === 'canvas' ? 'canvas' : 'image';
      if (next === this._activeLayer) return false;
      this._finishInlineTextEdit({ restoreFocus: false });
      this._document?.select(null);
      this._activeLayer = next;
      this._syncActiveDocument();
      this._cropRect = { x: 0, y: 0, width: 1, height: 1 };
      this._syncSelectionControls();
      this._syncUndoRedo();
      this._drawingArea.queue_draw();
      return true;
    }

    requestBack() {
      if (this._isDirty()) {
        this._confirmDiscard(() => this._navigateBack());
        return true;
      }
      this._navigateBack();
      return true;
    }

    requestHostClose() {
      if (this._allowClose || !this._isDirty()) return false;
      this._confirmDiscard(() => {
        this._allowClose = true;
        this._navigationHost?.closeAfterWorkspaceConfirmation();
      });
      return true;
    }

    requestWorkspaceReplacement(onReplace) {
      if (!this._isDirty()) return false;
      this._confirmDiscard(onReplace);
      return true;
    }

    disposeEmbedded() {
      if (!this._embedded) return;
      this._disposeResources();
      this.destroy();
    }

    _hostWindow() {
      return this._navigationHost ?? this;
    }

    _navigateBack() {
      if (this._embedded) this._navigationHost.showHome();
      else {
        this._allowClose = true;
        this.close();
      }
    }

    _buildUi() {
      this._drawingArea = new Gtk.DrawingArea({
        hexpand: true,
        vexpand: true,
        focusable: true,
        accessible_role: Gtk.AccessibleRole.IMG,
      });
      this._drawingArea.set_tooltip_text(
        'Click the background for canvas settings or the imported image to crop, rotate, and flip.',
      );
      this._drawingArea.add_css_class('bolas-image-editor-canvas');
      this._drawingArea.set_content_width(640);
      this._drawingArea.set_content_height(420);
      this._drawingArea.set_draw_func((area, cr, width, height) =>
        this._drawCanvas(area, cr, width, height),
      );
      this._drawingArea.connect('notify::width', () => this._positionInlineTextEditor());
      this._drawingArea.connect('notify::height', () => this._positionInlineTextEditor());

      this._canvasOverlay = new Gtk.Overlay({ child: this._drawingArea });
      this._canvasOverlay.add_css_class('bolas-image-editor-surface');

      this._statusBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 12,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
      });
      this._spinner = new Adw.Spinner({ width_request: 32, height_request: 32 });
      this._statusLabel = new Gtk.Label({
        label: 'Loading image…',
        wrap: true,
        max_width_chars: 52,
        justify: Gtk.Justification.CENTER,
      });
      this._statusBox.append(this._spinner);
      this._statusBox.append(this._statusLabel);
      this._canvasOverlay.add_overlay(this._statusBox);

      this._zoomControls = this._createZoomControls();
      this._canvasOverlay.add_overlay(this._zoomControls);

      this._sidebarScroller = new Gtk.ScrolledWindow({
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
        min_content_width: 280,
        max_content_width: 360,
        max_content_height: 560,
        propagate_natural_height: true,
      });
      this._sidebarScroller.add_css_class('background');
      this._sidebarScroller.add_css_class('bolas-image-editor-sidebar');
      this._sidebarScroller.set_margin_top(52);

      this._splitView = new Adw.OverlaySplitView({
        content: this._canvasOverlay,
        sidebar: this._sidebarScroller,
        sidebar_position: Gtk.PackType.END,
        show_sidebar: false,
        pin_sidebar: true,
        enable_show_gesture: true,
        enable_hide_gesture: true,
      });
      this._splitView.set_min_sidebar_width(280);
      this._splitView.set_max_sidebar_width(380);
      this._splitView.set_sidebar_width_fraction(0.32);

      this._bottomSheet = Adw.BottomSheet
        ? new Adw.BottomSheet({
            content: this._splitView,
            can_open: true,
            can_close: true,
            full_width: true,
            modal: true,
            show_drag_handle: true,
          })
        : null;
      this._bottomSheet?.connect('notify::open', () => {
        if (!this._narrowLayout) return;
        const open = this._bottomSheet.get_open();
        if (!open && this._mode === 'draw' && this._sidebarKind === 'draw') {
          this._finishDrawPanel();
          return;
        }
        if (!open && this._mode === 'crop' && this._sidebarKind === 'crop') {
          this._finishCropPanel();
          return;
        }
      });

      this._toolbarView = new Adw.ToolbarView();
      this._toolbarView.set_extend_content_to_top_edge(true);
      this._toolbarView.set_top_bar_style(Adw.ToolbarStyle.FLAT);
      this._toolbarView.set_content(this._bottomSheet ?? this._splitView);
      this._viewHeader = this._createViewHeader();
      this._toolbarView.add_top_bar(this._viewHeader);
      this._currentHeader = this._viewHeader;

      this._toastOverlay = new Adw.ToastOverlay({ child: this._toolbarView });
      if (!this._embedded) this.set_content(this._toastOverlay);
    }

    _createViewHeader() {
      const header = new Adw.HeaderBar({
        show_start_title_buttons: false,
        show_end_title_buttons: true,
      });
      header.set_title_widget(new Gtk.Box());
      header.add_css_class('bolas-image-viewer-header');
      header.add_css_class('workspace-transparent-header');

      if (this._embedded) {
        const backButton = button({
          icon_name: 'go-previous-symbolic',
          tooltip_text: 'Back to Screenshot',
        });
        backButton.add_css_class('workspace-back-button');
        backButton.connect('clicked', () => this.requestBack());
        header.pack_start(backButton);
      }

      this._fullscreenButton = button({
        icon_name: 'view-fullscreen-symbolic',
        tooltip_text: 'Enter Fullscreen (F11)',
      });
      this._fullscreenButton.connect('clicked', () => this._toggleFullscreen());
      header.pack_start(this._fullscreenButton);

      this._exportOutputButton = new Gtk.Button({
        label: 'Export…',
        tooltip_text: 'Export the current edited image as PNG',
      });
      this._exportOutputButton.connect('clicked', () => this._saveCopy());
      this._saveOutputButton = new Gtk.Button({
        css_classes: ['suggested-action'],
        label: 'Save',
        tooltip_text: 'Save the editable workspace to Recents (Ctrl+S)',
      });
      this._saveOutputButton.connect('clicked', () => this._saveWorkspace());
      this._shareOutputButton = new Gtk.Button({
        icon_name: 'send-to-symbolic',
        tooltip_text: 'Share the current edited image with another app',
      });
      this._shareOutputButton.connect('clicked', () => this._saveAndShare());

      const endControls = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 4,
      });
      endControls.append(this._shareOutputButton);
      endControls.append(this._exportOutputButton);
      endControls.append(this._saveOutputButton);
      header.pack_end(endControls);
      return header;
    }

    _createZoomControls() {
      const box = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        halign: Gtk.Align.FILL,
        valign: Gtk.Align.END,
        margin_bottom: 16,
        margin_end: 16,
        margin_start: 16,
      });
      const zoomGroup = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 2,
      });
      const editGroup = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 2,
      });
      for (const group of [zoomGroup, editGroup]) {
        group.add_css_class('toolbar');
        group.add_css_class('osd');
        group.add_css_class('linked');
      }
      const zoomOut = button({ icon_name: 'zoom-out-symbolic', tooltip_text: 'Zoom Out' });
      zoomOut.connect('clicked', () => this._zoomBy(1 / 1.25));
      zoomGroup.append(zoomOut);
      this._zoomLabel = new Gtk.Button({ label: 'Fit', tooltip_text: 'Actual Size (100%)' });
      this._zoomLabel.add_css_class('flat');
      this._zoomLabel.connect('clicked', () => this._setActualSize());
      zoomGroup.append(this._zoomLabel);
      const zoomIn = button({ icon_name: 'zoom-in-symbolic', tooltip_text: 'Zoom In' });
      zoomIn.connect('clicked', () => this._zoomBy(1.25));
      zoomGroup.append(zoomIn);
      const fit = button({ icon_name: 'zoom-fit-best-symbolic', tooltip_text: 'Fit to Window' });
      fit.connect('clicked', () => this._fitImage());
      zoomGroup.append(fit);
      this._drawButton = button({
        icon_name: 'document-edit-symbolic',
        tooltip_text: 'Draw and Annotate',
      });
      this._drawButton.update_property([Gtk.AccessibleProperty.LABEL], ['Draw and Annotate']);
      this._drawButton.connect('clicked', () => {
        if (this._mode === 'draw' && this._sidebarKind === 'draw' && this._sidebarVisible()) {
          this._finishDrawPanel();
          return;
        }
        this._requestEditMode('draw');
      });
      editGroup.append(this._drawButton);
      this._cropButton = button({
        icon_name: 'preferences-desktop-wallpaper-symbolic',
        tooltip_text: 'Crop Image',
      });
      this._cropButton.update_property([Gtk.AccessibleProperty.LABEL], ['Crop Image']);
      this._cropButton.connect('clicked', () => {
        if (this._mode === 'crop' && this._sidebarKind === 'crop' && this._sidebarVisible()) {
          this._finishCropPanel();
          return;
        }
        this._requestEditMode('crop');
      });
      editGroup.append(this._cropButton);
      this._backgroundButton = button({
        icon_name: 'preferences-color-symbolic',
        tooltip_text: 'Edit Background',
      });
      this._backgroundButton.update_property([Gtk.AccessibleProperty.LABEL], ['Edit Background']);
      this._backgroundButton.connect('clicked', () => {
        if (this._mode === 'view' && this._sidebarKind === 'background' && this._sidebarVisible()) {
          this._sidebarKind = null;
          this._setSidebarVisible(false);
          return;
        }
        this._showBackgroundPanel();
      });
      editGroup.append(this._backgroundButton);
      box.append(zoomGroup);
      box.append(new Gtk.Box({ hexpand: true }));
      box.append(editGroup);
      return box;
    }

    _createBackgroundSidebar() {
      const content = this._sidebarContainer();
      content.append(
        createShareSettingsControls({
          allowNoBackground: true,
          backgroundEnabled: this._backgroundEnabled,
          marginBottom: 0,
          marginEnd: 0,
          marginStart: 0,
          marginTop: 0,
          onBackgroundEnabledChange: (enabled) => {
            this._setBackgroundEnabled(enabled, { preservePanel: true, reveal: false });
          },
          onChange: (name) => {
            if (name === 'ratioId') this._syncCanvasForSettings();
            this._surfaceDirty = true;
            this._fitImage();
          },
          outputKind: 'PNG',
          preferences: this._preferences,
          settings: this._shareSettings,
          sourceHasTransparency: this._sourceHasTransparency,
        }),
      );
      return content;
    }

    _createDrawSidebar() {
      const content = this._sidebarContainer();
      content.add_css_class('bolas-image-draw-controls');
      content.append(sectionLabel('Draw and Annotate'));
      const history = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 6,
        homogeneous: true,
      });
      this._drawUndoButton = new Gtk.Button({
        icon_name: 'edit-undo-symbolic',
        tooltip_text: 'Undo (Ctrl+Z)',
      });
      this._drawUndoButton.update_property([Gtk.AccessibleProperty.LABEL], ['Undo']);
      this._drawUndoButton.connect('clicked', () => this._undo());
      history.append(this._drawUndoButton);
      this._drawRedoButton = new Gtk.Button({
        icon_name: 'edit-redo-symbolic',
        tooltip_text: 'Redo (Ctrl+Shift+Z)',
      });
      this._drawRedoButton.update_property([Gtk.AccessibleProperty.LABEL], ['Redo']);
      this._drawRedoButton.connect('clicked', () => this._redo());
      history.append(this._drawRedoButton);
      content.append(history);
      const toolGrid = new Gtk.Grid({
        column_spacing: 6,
        row_spacing: 6,
        column_homogeneous: true,
      });
      this._toolButtons = new Map();
      let group = null;

      TOOL_LABELS.forEach(([tool, label], index) => {
        const icon = TOOL_ICONS[tool];
        const toggle = new Gtk.ToggleButton({
          ...(icon?.name ? { icon_name: icon.name } : {}),
          tooltip_text: label,
          active: this._tool === tool,
        });
        if (icon?.file) toggle.set_child(createBundledIcon(icon.file, icon.fallback));
        toggle.update_property([Gtk.AccessibleProperty.LABEL], [label]);
        toggle.add_css_class('flat');
        if (group) toggle.set_group(group);
        else group = toggle;
        toggle.connect('toggled', () => {
          if (!toggle.get_active()) return;
          this._activateTool(tool);
        });
        this._toolButtons.set(tool, toggle);
        toggle.add_css_class('bolas-image-tool-button');
        toolGrid.attach(toggle, index % 4, Math.floor(index / 4), 1, 1);
      });
      toolGrid.add_css_class('bolas-image-tool-grid');
      content.append(toolGrid);

      const colorGrid = new Gtk.Grid({
        column_spacing: 4,
        row_spacing: 4,
        column_homogeneous: true,
        margin_top: 8,
      });
      colorGrid.update_property([Gtk.AccessibleProperty.LABEL], ['Annotation color']);
      this._colorButtons = [];
      let colorGroup = null;

      PRESET_COLORS.forEach(([name, color], index) => {
        const colorButton = new Gtk.ToggleButton({
          child: createColorSwatch(color),
          tooltip_text: name,
          active: index === closestPresetColorIndex(this._strokeColor),
        });
        colorButton.add_css_class('flat');
        colorButton.add_css_class('bolas-image-color-swatch-button');
        colorButton.update_property([Gtk.AccessibleProperty.LABEL], [name]);
        if (colorGroup) colorButton.set_group(colorGroup);
        else colorGroup = colorButton;
        colorButton.connect('toggled', () => {
          if (!colorButton.get_active() || this._syncingStyleControls) return;
          this._strokeColor = color;
          this._fillColor = color;
          this._preferences.rememberEditorOption('strokeColor', color);
          this._updateSelectedStyle({
            strokeColor: color,
            ...(this._fillEnabled ? { fillColor: color } : {}),
          });
        });
        this._colorButtons.push(colorButton);
        colorGrid.attach(colorButton, index % 4, Math.floor(index / 4), 1, 1);
      });
      content.append(colorGrid);

      const sizeRow = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        homogeneous: true,
        margin_top: 8,
      });
      sizeRow.add_css_class('linked');
      sizeRow.update_property([Gtk.AccessibleProperty.LABEL], ['Annotation size']);
      this._sizeButtons = [];
      let sizeGroup = null;

      TEXT_SIZES.forEach(([label], index) => {
        const sizeButton = new Gtk.ToggleButton({ label });
        if (sizeGroup) sizeButton.set_group(sizeGroup);
        else sizeGroup = sizeButton;
        sizeButton.connect('toggled', () => {
          if (!sizeButton.get_active() || this._syncingStyleControls) return;

          if (this._activeDrawType() === 'text') {
            this._fontSize = TEXT_SIZES[index][1];
            this._preferences.rememberEditorOption('fontSize', this._fontSize);
            this._updateSelectedStyle({ fontSize: this._fontSize });
          } else {
            this._strokeWidth = THICKNESSES[index][1];
            this._preferences.rememberEditorOption('strokeWidth', this._strokeWidth);
            this._updateSelectedStyle({ strokeWidth: this._strokeWidth });
          }
        });
        this._sizeButtons.push(sizeButton);
        sizeRow.append(sizeButton);
      });
      content.append(sizeRow);

      this._fontControls = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 8,
        margin_top: 8,
      });
      const fontLabel = new Gtk.Label({ label: 'Font', xalign: 0, hexpand: true });
      this._fontButton = new Gtk.FontDialogButton({
        dialog: new Gtk.FontDialog({ modal: true, title: 'Choose Text Font' }),
        font_desc: Pango.FontDescription.from_string(this._fontFamily),
        hexpand: true,
        level: Gtk.FontLevel.FAMILY,
        tooltip_text: 'Choose Text Font',
        use_font: true,
        use_size: false,
      });
      this._fontButton.update_property([Gtk.AccessibleProperty.LABEL], ['Text Font']);
      this._fontButton.connect('notify::font-desc', () => {
        if (this._syncingStyleControls) return;

        const family = String(this._fontButton.get_font_desc()?.get_family() ?? '').trim();
        if (!family) return;

        this._fontFamily = family;
        this._preferences.rememberEditorOption('fontFamily', family);
        this._updateSelectedStyle({ fontFamily: family });
      });
      this._fontControls.append(fontLabel);
      this._fontControls.append(this._fontButton);
      content.append(this._fontControls);

      this._fillControls = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 });
      this._fillSwitch = new Gtk.Switch({ active: this._fillEnabled, valign: Gtk.Align.CENTER });
      const fillLabel = new Gtk.Label({ label: 'Fill', xalign: 0, hexpand: true });
      this._fillControls.append(fillLabel);
      this._fillControls.append(this._fillSwitch);
      this._fillSwitch.connect('notify::active', () => {
        if (this._syncingStyleControls) return;
        this._fillEnabled = this._fillSwitch.get_active();
        this._fillColor = this._strokeColor;
        this._preferences.rememberEditorOption('fillEnabled', this._fillEnabled);
        this._updateSelectedStyle({
          fillColor: this._fillEnabled ? this._fillColor : null,
        });
      });
      content.append(this._fillControls);

      this._objectActions = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 6,
        homogeneous: true,
        hexpand: true,
        margin_top: 8,
      });
      this._duplicateButton = button({
        label: 'Duplicate',
        hexpand: true,
        tooltip_text: 'Duplicate Selection',
      });
      this._duplicateButton.remove_css_class('flat');
      this._duplicateButton.add_css_class('suggested-action');
      this._duplicateButton.update_property(
        [Gtk.AccessibleProperty.LABEL],
        ['Duplicate Selection'],
      );
      this._duplicateButton.connect('clicked', () => {
        this._finishInlineTextEdit({ restoreFocus: false });
        this._document?.duplicateAnnotation();
        this._activateTool('select');
        this._afterDocumentChange();
      });
      this._objectActions.append(this._duplicateButton);
      this._deleteButton = button({
        label: 'Delete',
        hexpand: true,
        tooltip_text: 'Delete Selection',
      });
      this._deleteButton.update_property([Gtk.AccessibleProperty.LABEL], ['Delete Selection']);
      this._deleteButton.remove_css_class('flat');
      this._deleteButton.add_css_class('destructive-action');
      this._deleteButton.connect('clicked', () => this._deleteSelection());
      this._objectActions.append(this._deleteButton);
      content.append(this._objectActions);
      this._syncDrawControlVisibility();
      this._syncSelectionControls();
      this._syncUndoRedo();
      return content;
    }

    _createCropSidebar() {
      const content = this._sidebarContainer();
      content.append(sectionLabel('Crop Image'));
      const history = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 6,
        homogeneous: true,
      });
      this._cropUndoButton = new Gtk.Button({
        icon_name: 'edit-undo-symbolic',
        tooltip_text: 'Undo (Ctrl+Z)',
      });
      this._cropUndoButton.update_property([Gtk.AccessibleProperty.LABEL], ['Undo']);
      this._cropUndoButton.connect('clicked', () => this._undo());
      history.append(this._cropUndoButton);
      this._cropRedoButton = new Gtk.Button({
        icon_name: 'edit-redo-symbolic',
        tooltip_text: 'Redo (Ctrl+Shift+Z)',
      });
      this._cropRedoButton.update_property([Gtk.AccessibleProperty.LABEL], ['Redo']);
      this._cropRedoButton.connect('clicked', () => this._redo());
      history.append(this._cropRedoButton);
      content.append(history);
      content.append(sectionLabel('Aspect Ratio'));
      const grid = new Gtk.Grid({
        column_spacing: 6,
        row_spacing: 6,
        column_homogeneous: true,
      });
      this._cropRatioButtons = new Map();
      let group = null;

      CROP_RATIOS.forEach(([label, ratio, ratioId], index) => {
        const toggle = new Gtk.ToggleButton({
          label,
          active: ratio === this._cropRatio,
        });
        if (group) toggle.set_group(group);
        else group = toggle;
        toggle.connect('toggled', () => {
          if (!toggle.get_active()) return;
          this._cropRatio = ratio;
          this._preferences.rememberEditorOption('cropRatioId', ratioId);
          this._resetCropForRatio();
        });
        this._cropRatioButtons.set(label, toggle);
        grid.attach(toggle, index % 2, Math.floor(index / 2), 1, 1);
      });
      content.append(grid);

      const orientationBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 6,
        homogeneous: true,
        margin_top: 6,
      });
      const landscape = new Gtk.ToggleButton({
        label: 'Landscape',
        active: !this._cropPortrait,
      });
      const portrait = new Gtk.ToggleButton({
        label: 'Portrait',
        active: this._cropPortrait,
        group: landscape,
      });
      this._cropLandscapeButton = landscape;
      this._cropPortraitButton = portrait;
      landscape.connect('toggled', () => {
        if (landscape.get_active()) {
          this._cropPortrait = false;
          this._preferences.rememberEditorOption('cropPortrait', false);
          this._resetCropForRatio();
        }
      });
      portrait.connect('toggled', () => {
        if (portrait.get_active()) {
          this._cropPortrait = true;
          this._preferences.rememberEditorOption('cropPortrait', true);
          this._resetCropForRatio();
        }
      });
      orientationBox.append(landscape);
      orientationBox.append(portrait);
      content.append(orientationBox);

      content.append(sectionLabel('Rotate'));
      const rotate = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 6,
        homogeneous: true,
      });
      const rotateLeft = new Gtk.Button({
        icon_name: 'object-rotate-left-symbolic',
        tooltip_text: 'Rotate Left',
      });
      rotateLeft.connect('clicked', () => this._transformDocument(() => this._document.rotate(-1)));
      rotate.append(rotateLeft);
      const rotateRight = new Gtk.Button({
        icon_name: 'object-rotate-right-symbolic',
        tooltip_text: 'Rotate Right',
      });
      rotateRight.connect('clicked', () => this._transformDocument(() => this._document.rotate(1)));
      rotate.append(rotateRight);
      content.append(rotate);

      content.append(sectionLabel('Flip'));
      const flip = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 6,
        homogeneous: true,
      });
      const flipHorizontal = new Gtk.Button({ label: 'Horizontal' });
      flipHorizontal.connect('clicked', () =>
        this._transformDocument(() => this._document.flip('horizontal')),
      );
      flip.append(flipHorizontal);
      const flipVertical = new Gtk.Button({ label: 'Vertical' });
      flipVertical.connect('clicked', () =>
        this._transformDocument(() => this._document.flip('vertical')),
      );
      flip.append(flipVertical);
      content.append(flip);

      const apply = new Gtk.Button({
        label: 'Apply Crop',
        margin_top: 16,
      });
      apply.add_css_class('suggested-action');
      apply.add_css_class('pill');
      apply.connect('clicked', () => this._applyCrop());
      content.append(apply);
      this._syncUndoRedo();
      return content;
    }

    _sidebarContainer() {
      const content = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 10,
        margin_top: 18,
        margin_bottom: 18,
        margin_start: 18,
        margin_end: 18,
      });
      return content;
    }

    _installControllers() {
      const drag = new Gtk.GestureDrag({ button: Gdk.BUTTON_PRIMARY });
      drag.connect('drag-begin', (_gesture, x, y) => this._dragBegin(x, y, false, drag));
      drag.connect('drag-update', (_gesture, dx, dy) => this._dragUpdate(dx, dy, drag));
      drag.connect('drag-end', (_gesture, dx, dy) => this._dragEnd(dx, dy, drag));
      drag.connect('cancel', () => this._cancelDrag(drag));
      this._drawingArea.add_controller(drag);
      this._primaryDragGesture = drag;

      const panDrag = new Gtk.GestureDrag({ button: Gdk.BUTTON_MIDDLE });
      panDrag.connect('drag-begin', (_gesture, x, y) => this._dragBegin(x, y, true, panDrag));
      panDrag.connect('drag-update', (_gesture, dx, dy) => this._dragUpdate(dx, dy, panDrag));
      panDrag.connect('drag-end', (_gesture, dx, dy) => this._dragEnd(dx, dy, panDrag));
      panDrag.connect('cancel', () => this._cancelDrag(panDrag));
      this._drawingArea.add_controller(panDrag);
      this._panDragGesture = panDrag;

      const textEditClick = new Gtk.GestureClick({ button: Gdk.BUTTON_PRIMARY });
      textEditClick.connect('released', (_gesture, pressCount, x, y) => {
        if (pressCount !== 2 || this._mode !== 'draw' || this._tool !== 'select') return;

        const point = this._canvasPoint(x, y);
        if (!point) return;
        const geometry = this._viewGeometry();
        const layer = this._activeLayerPixelSize();
        const tolerance =
          8 / Math.max(layer.width * geometry.scale, layer.height * geometry.scale, 1);
        const annotation = hitAnnotations(this._document?.annotations, point, tolerance);

        if (annotation?.type !== 'text') return;
        this._document.select(annotation.id);
        this._afterSelectionChange();
        this._beginInlineTextEdit(annotation);
      });
      this._drawingArea.add_controller(textEditClick);
      this._textEditClickGesture = textEditClick;

      const scroll = new Gtk.EventControllerScroll({
        flags: Gtk.EventControllerScrollFlags.VERTICAL,
      });
      scroll.connect('scroll', (_controller, _dx, dy) => {
        this._zoomBy(dy < 0 ? 1.15 : 1 / 1.15);
        return true;
      });
      this._drawingArea.add_controller(scroll);

      if (Gtk.GestureZoom) {
        const zoom = new Gtk.GestureZoom();
        zoom.connect('begin', () => {
          this._pinchStartZoom = this._fit ? 1 : this._zoomFactor;
          this._fit = false;
        });
        zoom.connect('scale-changed', (_gesture, scale) => {
          this._zoomFactor = clamp(this._pinchStartZoom * scale, MIN_ZOOM, MAX_ZOOM);
          this._syncZoomLabel();
          this._drawingArea.queue_draw();
        });
        this._drawingArea.add_controller(zoom);
      }

      const keys = new Gtk.EventControllerKey();
      keys.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
      keys.connect('key-pressed', (_controller, keyval, _keycode, state) =>
        this._handleKey(keyval, state),
      );
      this._hostKeyController = keys;
      this._hostWindow().add_controller(keys);
    }

    _finishLoad(source) {
      this._source = source;
      this._workspaceSourceMetadata = {
        displayName: source.displayName || this._image.title,
        originalMimeType: source.mimeType || this._image.mimeType || 'image/png',
      };
      this._sourceHasTransparency = pixbufHasTransparency(this._source.pixbuf);
      this._shareSettings = sharePreferencesForSource(
        this._preferences.getSharePreferences(),
        this._sourceHasTransparency,
      );
      this._imageDocument = new ImageDocument({
        width: this._source.width,
        height: this._source.height,
        historyLimit: 100,
      });
      this._canvasDocument = null;
      this._document = this._imageDocument;
      this._updatePreviewPixbuf();
      this._setBackgroundEnabled(this._initialBackgroundEnabled);
      this._markCompositionSaved();
      this._startAnimation();
      this._setStatus('', false);
      this._surfaceDirty = true;
      this._drawingArea.queue_draw();
      this._syncActionSensitivity();
    }

    _finishWorkspaceLoad({ etag, path, workspace }) {
      const sourceBytes = workspaceSourceBytes(workspace);
      const source = ImageRenderer.loadImageSourceBytes(sourceBytes, {
        displayName: workspace.source.displayName,
        path,
      });
      if (source.width !== workspace.source.width || source.height !== workspace.source.height)
        throw new Error('The workspace source dimensions do not match its manifest.');

      const managedWorkspace = isManagedWorkspacePath(path);
      this._workspacePath = managedWorkspace ? path : null;
      this._workspaceEtag = managedWorkspace ? etag : null;
      this._workspaceSourceMetadata = {
        displayName: workspace.source.displayName,
        originalMimeType: workspace.source.originalMimeType,
      };
      this._image = {
        path,
        title: GLib.path_get_basename(path),
        mimeType: WORKSPACE_MIME_TYPE,
        sourceKind: 'workspace',
      };
      this._source = source;
      this._sourceHasTransparency = pixbufHasTransparency(source.pixbuf);
      this._shareSettings = sharePreferencesForSource(
        workspace.composition.settings,
        this._sourceHasTransparency,
      );
      this._imageDocument = ImageDocument.fromWorkspaceSnapshot(workspace.documents.image);
      this._canvasDocument = workspace.documents.canvas
        ? ImageDocument.fromWorkspaceSnapshot(workspace.documents.canvas)
        : null;
      this._backgroundEnabled = Boolean(workspace.composition.backgroundEnabled);
      if (this._backgroundEnabled && !this._canvasDocument)
        throw new Error('The workspace is missing its canvas document.');
      this._canvasRatioId = this._canvasDocument ? this._shareSettings.ratioId : null;

      const session = workspace.session;
      this._activeLayer =
        this._backgroundEnabled && session.activeLayer === 'canvas' ? 'canvas' : 'image';
      this._syncActiveDocument();
      this._cropRatio = cropRatioFromId(session.cropRatioId);
      this._cropPortrait = session.cropPortrait;
      this._cropRect = { ...session.cropRect };
      this._fillColor = session.fillColor;
      this._fillEnabled = session.fillEnabled;
      this._fit = session.fit;
      this._fontFamily = session.fontFamily;
      this._fontSize = session.fontSize;
      this._opacity = session.opacity;
      this._zoomFactor = session.zoomFactor;
      this._panX = session.panX;
      this._panY = session.panY;
      this._strokeColor = session.strokeColor;
      this._strokeWidth = session.strokeWidth;
      this._text = session.text;
      this._tool = session.tool;
      this._conversionAccepted = true;

      this._updatePreviewPixbuf();
      this._markCompositionSaved();
      this._setStatus('', false);
      this._surfaceDirty = true;
      this._renderError = null;
      this._hostWindow().set_title(this._image.title);
      this._syncZoomLabel();

      const selectedId = this._document?.selectionId ?? null;
      if (session.mode === 'draw') {
        this._enterEditMode('draw', { annotationId: selectedId, layer: this._activeLayer });
        this._selectCompositionLayer(this._activeLayer);
        if (selectedId) this._document?.select(selectedId);
        this._activateTool(session.tool, { remember: false });
      } else if (session.mode === 'crop') {
        this._enterEditMode('crop');
        this._cropRect = { ...session.cropRect };
      } else if (session.sidebarKind === 'background') {
        this._showBackgroundPanel();
      }

      this._drawingArea.queue_draw();
      this._syncUndoRedo();
      this._syncActionSensitivity();
    }

    _failLoad(error) {
      if (isCancellation(error)) return;

      this._renderError = error;
      logError(error, `Failed to load image: ${this._image.path}`);
      this._setStatus(error.message || 'The image could not be loaded.', false, true);
      this._syncActionSensitivity(false);
    }

    _load() {
      this._setStatus('Loading image…', true);

      if (ImageRenderer.loadImageSourceAsync) {
        let completed = false;
        const operation = ImageRenderer.loadImageSourceAsync(
          this._image.path,
          this._loadCancellable,
          (source, error) => {
            completed = true;

            if (error) this._failLoad(error);
            else this._finishLoad(source);
          },
        );

        return operation.catch((error) => {
          if (!completed) this._failLoad(error);
        });
      }

      try {
        this._finishLoad(ImageRenderer.loadImageSource(this._image.path));
        return Promise.resolve();
      } catch (error) {
        this._failLoad(error);
        return Promise.resolve();
      }
    }

    async _loadWorkspace() {
      this._setStatus('Opening workspace…', true);
      try {
        const loaded =
          this._workspaceLoad ??
          (await readImageWorkspace(this._workspacePath, {
            cancellable: this._loadCancellable,
          }));
        this._workspaceLoad = null;
        this._finishWorkspaceLoad(loaded);
      } catch (error) {
        this._workspaceLoad = null;
        this._failLoad(error);
      }
    }

    _setStatus(message, spinning = false, isError = false) {
      this._statusBox.set_visible(Boolean(message));
      this._spinner.set_visible(spinning);
      this._statusLabel.set_label(String(message ?? ''));
      if (isError) this._statusLabel.add_css_class('error');
      else this._statusLabel.remove_css_class('error');
    }

    _syncActionSensitivity(enabled = Boolean(this._source && this._document) && !this._busy) {
      this._drawButton?.set_sensitive(enabled);
      this._cropButton?.set_sensitive(enabled);
      this._backgroundButton?.set_sensitive(enabled);
      this._saveOutputButton?.set_sensitive(enabled);
      this._exportOutputButton?.set_sensitive(enabled);
      this._shareOutputButton?.set_sensitive(enabled);
    }

    _drawCanvas(_area, cr, width, height) {
      cr.setSourceRGB(0.055, 0.055, 0.06);
      cr.paint();

      if (!this._source || !this._document) return;

      const surface = this._getRenderSurface();

      if (!surface) return;

      const geometry = this._viewGeometry(width, height);
      this._drawCheckerboard(cr, geometry);
      cr.save();
      cr.translate(geometry.x, geometry.y);
      cr.scale(geometry.scale, geometry.scale);
      cr.setSourceSurface(surface, 0, 0);
      cr.paint();
      cr.restore();

      if (this._mode === 'draw') this._drawSelection(cr, geometry);
      else if (this._mode === 'crop') this._drawCropOverlay(cr, geometry);
    }

    _getRenderSurface() {
      if (!this._surfaceDirty) return this._renderSurface;

      this._disposeSurface();
      this._surfaceDirty = false;

      try {
        const editingAnnotationId = this._inlineTextState?.annotationId;
        const previewDocument = (document, active) =>
          editingAnnotationId && active
            ? {
                transforms: document.transforms,
                annotations: document.annotations.filter(
                  (annotation) => annotation.id !== editingAnnotationId,
                ),
              }
            : document;
        const imageDocument = previewDocument(this._imageDocument, this._activeLayer === 'image');
        if (this._backgroundEnabled) {
          const canvasDocument = previewDocument(
            this._canvasDocument,
            this._activeLayer === 'canvas',
          );
          this._renderSurface = ImageRenderer.renderCompositionToSurface(
            this._previewPixbuf ?? this._source.pixbuf,
            imageDocument,
            canvasDocument,
            {
              ...this._shareSettings,
              sourceHasTransparency: this._sourceHasTransparency,
            },
          );
        } else {
          this._renderSurface = ImageRenderer.renderDocumentToSurface(
            this._previewPixbuf ?? this._source.pixbuf,
            imageDocument,
          );
        }
        this._renderError = null;
      } catch (error) {
        this._renderError = error;
        logError(error, 'Failed to render edited image');
        this._setStatus(error.message || 'The image preview could not be rendered.', false, true);
      }

      return this._renderSurface;
    }

    _disposeSurface() {
      if (!this._renderSurface) return;

      try {
        this._renderSurface.finish();
      } catch (_error) {
        // The Cairo surface may already have been finalized by GJS.
      }
      this._renderSurface = null;
    }

    _disposeResources() {
      if (this._disposed) return;
      this._disposed = true;
      if (this._hostKeyController) {
        try {
          this._hostWindow().remove_controller(this._hostKeyController);
        } catch (_error) {
          // The host may already be finalizing its widget hierarchy.
        }
        this._hostKeyController = null;
      }
      for (const [object, signalId] of this._hostSignalIds) {
        try {
          object.disconnect(signalId);
        } catch (_error) {
          // The host may already have disconnected its signals.
        }
      }
      this._hostSignalIds = [];
      this._cancelFullscreenRequestTimeout();
      this._fullscreenTransientParent = null;
      this._finishInlineTextEdit({ cancel: true, restoreFocus: false });
      this._loadCancellable?.cancel();
      this._stopAnimation();
      this._disposeSurface();
      this._checkerboardPattern = null;
      this._checkerboardSurface?.finish();
      this._checkerboardSurface = null;
      this._previewPixbuf = null;
      this._source = null;
      this._imageDocument = null;
      this._canvasDocument = null;
      this._document = null;
      this._shareSettings = null;
      this._dragState = null;
      this._dragOwner = null;
    }

    _updatePreviewPixbuf() {
      const pixbuf = this._source?.pixbuf;

      if (!pixbuf) {
        this._previewPixbuf = null;
        return;
      }

      const width = pixbuf.get_width();
      const height = pixbuf.get_height();
      const largest = Math.max(width, height);

      if (largest <= MAX_PREVIEW_DIMENSION) {
        this._previewPixbuf = pixbuf;
        return;
      }

      const scale = MAX_PREVIEW_DIMENSION / largest;
      this._previewPixbuf = pixbuf.scale_simple(
        Math.max(1, Math.round(width * scale)),
        Math.max(1, Math.round(height * scale)),
        GdkPixbuf.InterpType.BILINEAR,
      );
    }

    _startAnimation() {
      this._stopAnimation();

      if (!this._source?.isAnimated || this._mode !== 'view') return;

      try {
        this._animationIter = this._source.animation.get_iter(currentTimeValue());
        const frame = this._animationIter.get_pixbuf();

        if (frame) {
          this._source.pixbuf = frame.apply_embedded_orientation?.() ?? frame;
          this._updatePreviewPixbuf();
        }
        this._scheduleAnimationFrame();
      } catch (error) {
        this._animationIter = null;
        logError(error, 'Failed to animate image preview');
      }
    }

    _scheduleAnimationFrame() {
      if (!this._animationIter || this._mode !== 'view') return;

      const delay = this._animationIter.get_delay_time();

      if (delay < 0) return;

      this._animationSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(20, delay), () => {
        this._animationSourceId = 0;

        if (!this._animationIter || this._mode !== 'view') return GLib.SOURCE_REMOVE;

        try {
          if (this._animationIter.advance(currentTimeValue())) {
            const frame = this._animationIter.get_pixbuf();
            this._source.pixbuf = frame.apply_embedded_orientation?.() ?? frame;
            this._updatePreviewPixbuf();
            this._surfaceDirty = true;
            this._drawingArea.queue_draw();
          }
          this._scheduleAnimationFrame();
        } catch (error) {
          this._animationIter = null;
          logError(error, 'Failed to advance animated image');
        }
        return GLib.SOURCE_REMOVE;
      });
    }

    _stopAnimation() {
      if (this._animationSourceId) {
        GLib.source_remove(this._animationSourceId);
        this._animationSourceId = 0;
      }
      this._animationIter = null;
    }

    _surfaceDimensions() {
      const surface = this._renderSurface;
      return ImageRenderer.editorSurfaceDimensions({
        backgroundEnabled: this._backgroundEnabled,
        canvasOptions: this._shareSettings,
        canvasTransforms: this._canvasDocument?.transforms,
        imageHeight: this._imageDocument?.height ?? this._source?.height,
        imageWidth: this._imageDocument?.width ?? this._source?.width,
        renderedHeight: surface?.getHeight?.() ?? surface?.get_height?.(),
        renderedWidth: surface?.getWidth?.() ?? surface?.get_width?.(),
      });
    }

    _imageLayerDimensions() {
      return {
        height: Math.max(1, this._imageDocument?.height ?? this._source?.height ?? 1),
        width: Math.max(1, this._imageDocument?.width ?? this._source?.width ?? 1),
      };
    }

    _activeLayerPointToCanvas(point) {
      if (!this._backgroundEnabled || this._activeLayer === 'canvas') return point;
      const image = this._imageLayerDimensions();
      return ImageRenderer.imagePointToComposition(
        point,
        image.width,
        image.height,
        this._shareSettings,
        this._canvasDocument?.transforms,
      );
    }

    _canvasPointToActiveLayer(point) {
      if (!this._backgroundEnabled || this._activeLayer === 'canvas') return point;
      const image = this._imageLayerDimensions();
      return ImageRenderer.compositionPointToImage(
        point,
        image.width,
        image.height,
        this._shareSettings,
        this._canvasDocument?.transforms,
      );
    }

    _activeLayerBounds() {
      if (!this._backgroundEnabled || this._activeLayer === 'canvas')
        return { height: 1, width: 1, x: 0, y: 0 };
      const image = this._imageLayerDimensions();
      return ImageRenderer.imageBoundsInComposition(
        image.width,
        image.height,
        this._shareSettings,
        this._canvasDocument?.transforms,
      );
    }

    _activeBoundsToCanvas(bounds) {
      if (!bounds) return null;
      if (!this._backgroundEnabled || this._activeLayer === 'canvas') return bounds;
      const points = [
        { x: bounds.x, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y },
        { x: bounds.x, y: bounds.y + bounds.height },
        { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      ].map((point) => this._activeLayerPointToCanvas(point));
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return {
        height: Math.max(...ys) - y,
        width: Math.max(...xs) - x,
        x,
        y,
      };
    }

    _activeLayerPixelSize() {
      const bounds = this._activeLayerBounds();
      const surface = this._surfaceDimensions();
      return {
        height: Math.max(1, bounds.height * surface.height),
        width: Math.max(1, bounds.width * surface.width),
      };
    }

    _layerHitTolerance(layer, geometry) {
      if (!this._backgroundEnabled || layer === 'canvas')
        return 8 / Math.max(geometry.width * geometry.scale, geometry.height * geometry.scale, 1);

      const bounds = ImageRenderer.imageBoundsInComposition(
        this._imageDocument.width,
        this._imageDocument.height,
        this._shareSettings,
        this._canvasDocument?.transforms,
      );
      return (
        8 /
        Math.max(
          bounds.width * geometry.width * geometry.scale,
          bounds.height * geometry.height * geometry.scale,
          1,
        )
      );
    }

    _pickObjectAt(surfacePoint, geometry) {
      if (!surfacePoint) return { point: null, target: null };

      if (this._backgroundEnabled) {
        const imagePoint = ImageRenderer.compositionPointToImage(
          surfacePoint,
          this._imageDocument.width,
          this._imageDocument.height,
          this._shareSettings,
          this._canvasDocument?.transforms,
        );
        const selection = DocumentModel.pickCompositionTarget({
          canvasAnnotations: this._canvasDocument.annotations,
          canvasOptions: { tolerance: this._layerHitTolerance('canvas', geometry) },
          imageAnnotations: this._imageDocument.annotations,
          imageOptions: { tolerance: this._layerHitTolerance('image', geometry) },
          imagePoint,
          surfacePoint,
        });
        return {
          imageSelected: selection.layer === 'image' && !selection.annotation,
          layer: selection.layer,
          point: selection.layer === 'image' ? imagePoint : surfacePoint,
          target: selection.annotation,
        };
      }

      const target = hitAnnotations(
        this._imageDocument.annotations,
        surfacePoint,
        this._layerHitTolerance('image', geometry),
      );
      return { layer: 'image', point: surfacePoint, target };
    }

    _selectObjectAt(surfacePoint, geometry) {
      const selection = this._pickObjectAt(surfacePoint, geometry);

      if (!selection.point) return selection;

      const document = selection.layer === 'canvas' ? this._canvasDocument : this._imageDocument;
      this._selectCompositionLayer(selection.layer);
      document?.select(selection.target?.id ?? null);
      return selection;
    }

    _showBackgroundPanel() {
      if (!this._source || this._busy) return false;
      if (this._mode === 'draw') this._finishDrawPanel({ hide: false });
      if (this._mode === 'crop') this._finishCropPanel({ hide: false });
      if (this._mode !== 'view') return false;

      if (this._backgroundEnabled) {
        this._selectCompositionLayer('canvas');
        this._canvasDocument?.select(null);
      }
      this._sidebarKind = 'background';
      this._sidebarScroller.set_child(this._createBackgroundSidebar());
      this._setSidebarVisible(true);
      this._drawingArea.queue_draw();
      return true;
    }

    _openContextAt(x, y) {
      if (!this._source || !this._document || this._busy) return null;

      const surfacePoint = this._canvasSurfacePoint(x, y);
      if (!surfacePoint) return null;

      const selection = this._pickObjectAt(surfacePoint, this._viewGeometry());
      const panel = DocumentModel.editPanelForCompositionTarget({
        annotation: selection.target,
        layer: selection.layer,
      });

      if (panel === 'draw') {
        if (this._mode !== 'draw' || this._sidebarKind !== 'draw') {
          this._requestEditMode('draw', {
            annotationId: selection.target.id,
            layer: selection.layer,
          });
        }
        return 'annotation';
      }

      if (panel === 'crop') {
        if (this._mode === 'crop' && this._sidebarKind === 'crop') return 'image';
        this._selectCompositionLayer('image');
        this._imageDocument.select(null);
        this._requestEditMode('crop');
        return 'image';
      }

      if (this._mode !== 'view' || this._sidebarKind !== 'background') this._showBackgroundPanel();
      return 'background';
    }

    _viewGeometry(
      canvasWidth = this._drawingArea.get_width(),
      canvasHeight = this._drawingArea.get_height(),
    ) {
      const { width, height } = this._surfaceDimensions();
      return ImageRenderer.fittedSurfaceGeometry(width, height, canvasWidth, canvasHeight, {
        inset: this._backgroundEnabled ? 0 : CANVAS_PADDING,
        panX: this._panX,
        panY: this._panY,
        zoom: this._fit ? 1 : this._zoomFactor,
      });
    }

    _drawCheckerboard(cr, geometry) {
      if (!this._checkerboardPattern) {
        const tileSize = 24;
        const squareSize = tileSize / 2;
        const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, tileSize, tileSize);
        const tile = new Cairo.Context(surface);

        tile.setSourceRGB(0.43, 0.43, 0.45);
        tile.paint();
        tile.setSourceRGB(0.32, 0.32, 0.34);
        tile.rectangle(squareSize, 0, squareSize, squareSize);
        tile.rectangle(0, squareSize, squareSize, squareSize);
        tile.fill();
        tile.$dispose();
        surface.flush();

        this._checkerboardSurface = surface;
        this._checkerboardPattern = new Cairo.SurfacePattern(surface);
        this._checkerboardPattern.setExtend(Cairo.Extend.REPEAT);
      }

      cr.save();
      cr.translate(geometry.x, geometry.y);
      cr.rectangle(0, 0, geometry.width * geometry.scale, geometry.height * geometry.scale);
      cr.clip();
      cr.setSource(this._checkerboardPattern);
      cr.paint();
      cr.restore();
    }

    _drawSelection(cr, geometry) {
      const selected = this._document.selectedAnnotation;
      const bounds =
        annotationBounds(selected) ??
        (this._activeLayer === 'image' ? { height: 1, width: 1, x: 0, y: 0 } : null);

      if (!bounds) return;

      const canvasBounds = this._activeBoundsToCanvas(bounds);

      cr.save();
      cr.translate(geometry.x, geometry.y);
      cr.scale(geometry.scale, geometry.scale);
      const x = canvasBounds.x * geometry.width;
      const y = canvasBounds.y * geometry.height;
      const width = canvasBounds.width * geometry.width;
      const height = canvasBounds.height * geometry.height;
      cr.setSourceRGBA(0.22, 0.6, 1, 1);
      cr.setLineWidth(2 / geometry.scale);
      cr.setDash([5 / geometry.scale, 4 / geometry.scale], 0);
      cr.rectangle(x, y, width, height);
      cr.stroke();
      cr.setDash([], 0);

      if (selected) {
        for (const { point } of resizeHandles(bounds)) {
          const mapped = this._activeLayerPointToCanvas(point);
          const px = mapped.x * geometry.width;
          const py = mapped.y * geometry.height;
          const size = HANDLE_SIZE / geometry.scale;
          cr.setSourceRGB(1, 1, 1);
          cr.rectangle(px - size / 2, py - size / 2, size, size);
          cr.fillPreserve();
          cr.setSourceRGBA(0.1, 0.42, 0.85, 1);
          cr.setLineWidth(1.5 / geometry.scale);
          cr.stroke();
        }
      }

      if (selected?.type === 'arrow') {
        const bend = this._activeLayerPointToCanvas(DocumentModel.getArrowBendPoint(selected));
        const px = bend.x * geometry.width;
        const py = bend.y * geometry.height;
        const radius = CURVE_HANDLE_SIZE / geometry.scale / 2;

        cr.setSourceRGBA(0.38, 0.43, 1, 0.24);
        cr.arc(px, py, radius, 0, Math.PI * 2);
        cr.fill();
        cr.setSourceRGB(1, 1, 1);
        cr.arc(px, py, radius * 0.58, 0, Math.PI * 2);
        cr.fillPreserve();
        cr.setSourceRGBA(0.28, 0.34, 0.95, 1);
        cr.setLineWidth(2 / geometry.scale);
        cr.stroke();
      }
      cr.restore();
    }

    _drawCropOverlay(cr, geometry) {
      const rect = this._activeBoundsToCanvas(this._cropRect);
      const target = this._activeLayerBounds();
      const targetX = geometry.x + target.x * geometry.width * geometry.scale;
      const targetY = geometry.y + target.y * geometry.height * geometry.scale;
      const targetWidth = target.width * geometry.width * geometry.scale;
      const targetHeight = target.height * geometry.height * geometry.scale;
      const x = geometry.x + rect.x * geometry.width * geometry.scale;
      const y = geometry.y + rect.y * geometry.height * geometry.scale;
      const width = rect.width * geometry.width * geometry.scale;
      const height = rect.height * geometry.height * geometry.scale;
      const imageRight = targetX + targetWidth;
      const imageBottom = targetY + targetHeight;

      cr.save();
      cr.setSourceRGBA(0, 0, 0, 0.58);
      cr.rectangle(targetX, targetY, targetWidth, Math.max(0, y - targetY));
      cr.rectangle(targetX, y + height, targetWidth, Math.max(0, imageBottom - y - height));
      cr.rectangle(targetX, y, Math.max(0, x - targetX), height);
      cr.rectangle(x + width, y, Math.max(0, imageRight - x - width), height);
      cr.fill();
      cr.setSourceRGB(1, 1, 1);
      cr.setLineWidth(2);
      cr.rectangle(x, y, width, height);
      cr.stroke();
      cr.setSourceRGBA(1, 1, 1, 0.65);
      cr.setLineWidth(1);
      cr.moveTo(x + width / 3, y);
      cr.lineTo(x + width / 3, y + height);
      cr.moveTo(x + (width * 2) / 3, y);
      cr.lineTo(x + (width * 2) / 3, y + height);
      cr.moveTo(x, y + height / 3);
      cr.lineTo(x + width, y + height / 3);
      cr.moveTo(x, y + (height * 2) / 3);
      cr.lineTo(x + width, y + (height * 2) / 3);
      cr.stroke();
      for (const { point } of resizeHandles(this._cropRect)) {
        const mapped = this._activeLayerPointToCanvas(point);
        const px = geometry.x + mapped.x * geometry.width * geometry.scale;
        const py = geometry.y + mapped.y * geometry.height * geometry.scale;
        cr.setSourceRGB(1, 1, 1);
        cr.rectangle(px - HANDLE_SIZE / 2, py - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        cr.fill();
      }
      cr.restore();
    }

    _canvasSurfacePoint(x, y, allowOutside = false) {
      const geometry = this._viewGeometry();
      const point = {
        x: (x - geometry.x) / (geometry.width * geometry.scale),
        y: (y - geometry.y) / (geometry.height * geometry.scale),
      };

      if (!allowOutside && (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) return null;

      return {
        x: clamp(point.x, 0, 1),
        y: clamp(point.y, 0, 1),
      };
    }

    _canvasPoint(x, y, allowOutside = false) {
      const canvasPoint = this._canvasSurfacePoint(x, y, allowOutside);
      if (!canvasPoint) return null;
      const point = this._canvasPointToActiveLayer(canvasPoint);

      if (!allowOutside && (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) return null;
      return {
        x: clamp(point.x, 0, 1),
        y: clamp(point.y, 0, 1),
      };
    }

    _handleAt(point, bounds) {
      if (!point || !bounds) return null;

      const geometry = this._viewGeometry();
      const layer = this._activeLayerPixelSize();
      const tolerance = Math.max(
        HANDLE_SIZE / Math.max(1, layer.width * geometry.scale),
        HANDLE_SIZE / Math.max(1, layer.height * geometry.scale),
      );

      return (
        resizeHandles(bounds).find(
          ({ point: handlePoint }) =>
            Math.hypot(point.x - handlePoint.x, point.y - handlePoint.y) <= tolerance,
        )?.handle ?? null
      );
    }

    _curveHandleAt(point, annotation) {
      if (!point || annotation?.type !== 'arrow') return false;

      const geometry = this._viewGeometry();
      const bend = this._activeLayerPointToCanvas(DocumentModel.getArrowBendPoint(annotation));
      const mappedPoint = this._activeLayerPointToCanvas(point);
      const distance = Math.hypot(
        (mappedPoint.x - bend.x) * geometry.width * geometry.scale,
        (mappedPoint.y - bend.y) * geometry.height * geometry.scale,
      );

      return distance <= CURVE_HANDLE_SIZE / 2 + 4;
    }

    _dragBegin(x, y, forcePan, owner = null) {
      if (this._inlineTextState) this._finishInlineTextEdit({ restoreFocus: false });

      this._drawingArea.grab_focus();

      if (this._dragState) this._cancelDrag(this._dragOwner);
      this._dragOwner = owner;

      if (!this._document) {
        this._dragOwner = null;
        return;
      }

      if (forcePan || this._mode === 'view') {
        this._dragState = {
          type: 'pan',
          panX: this._panX,
          panY: this._panY,
          routeClick: !forcePan && this._mode === 'view',
          viewStart: { x, y },
        };
        return;
      }

      const surfacePoint = this._canvasSurfacePoint(x, y);
      let point = this._canvasPoint(x, y, this._mode === 'crop');

      if (!point && !(this._mode === 'draw' && this._tool === 'select' && surfacePoint)) {
        this._dragOwner = null;
        return;
      }

      if (this._mode === 'crop') {
        const handle = this._handleAt(point, this._cropRect);
        const inside =
          point.x >= this._cropRect.x &&
          point.x <= this._cropRect.x + this._cropRect.width &&
          point.y >= this._cropRect.y &&
          point.y <= this._cropRect.y + this._cropRect.height;
        this._dragState = {
          type: handle ? 'crop-resize' : inside ? 'crop-move' : 'crop-new',
          handle,
          routeClick: true,
          start: point,
          originalRect: { ...this._cropRect },
          viewStart: { x, y },
        };
        if (!handle && !inside)
          this._cropRect = { x: point.x, y: point.y, width: CROP_MIN_SIZE, height: CROP_MIN_SIZE };
        return;
      }

      if (this._tool === 'select') {
        const selected = this._document.selectedAnnotation;
        const curveHandle = selected && point ? this._curveHandleAt(point, selected) : false;
        const handle =
          selected && point && !curveHandle
            ? this._handleAt(point, annotationBounds(selected))
            : null;
        let target = selected;

        if (!handle && !curveHandle) {
          const geometry = this._viewGeometry();
          const selection = this._selectObjectAt(surfacePoint, geometry);
          point = selection.point;
          target = selection.target;
        }

        if (!target) {
          this._dragState = {
            type: 'select-empty',
            routeClick: true,
            viewStart: { x, y },
          };
          this._afterSelectionChange();
          return;
        }

        const interactionType = curveHandle ? 'curve' : handle ? 'resize' : 'move';
        const transactionLabel = curveHandle
          ? 'Curve arrow'
          : handle
            ? 'Resize annotation'
            : 'Move annotation';
        this._document.beginTransaction(transactionLabel);
        this._dragState = {
          type: interactionType,
          id: target.id,
          handle,
          routeClick: true,
          start: point,
          last: point,
          viewStart: { x, y },
        };
        this._afterSelectionChange();
        return;
      }

      this._document.beginTransaction(`Add ${this._tool}`);
      const spec = this._annotationSpec(this._tool, point, point);
      const added = this._document.addAnnotation(spec);
      const id = typeof added === 'string' ? added : (added?.id ?? this._document.selectionId);
      this._document.select(id ?? null);
      this._dragState = {
        type: 'draw',
        tool: this._tool,
        id,
        start: point,
        last: point,
        viewStart: { x, y },
      };

      if (this._tool === 'text') {
        this._dragState = null;
        this._dragOwner = null;
        this._beginInlineTextEdit(this._document.selectedAnnotation, {
          isNew: true,
          transactionOpen: true,
        });
      }

      this._afterDocumentChange();
    }

    _dragUpdate(dx, dy, owner = null) {
      const state = this._dragState;

      if (!state || (owner && this._dragOwner !== owner)) return;

      if (state.type === 'select-empty') return;

      if (state.type === 'pan') {
        this._panX = state.panX + dx;
        this._panY = state.panY + dy;
        this._positionInlineTextEditor();
        this._drawingArea.queue_draw();
        return;
      }

      const mappedCurrent = state.viewStart
        ? this._canvasPoint(state.viewStart.x + dx, state.viewStart.y + dy, true)
        : null;
      const delta = mappedCurrent
        ? { x: mappedCurrent.x - state.start.x, y: mappedCurrent.y - state.start.y }
        : { x: 0, y: 0 };

      if (state.type.startsWith('crop')) {
        this._updateCropDrag(state, delta);
        this._drawingArea.queue_draw();
        return;
      }

      const current = mappedCurrent ?? state.last;
      const incremental = {
        x: current.x - state.last.x,
        y: current.y - state.last.y,
      };

      if (state.type === 'move') {
        this._document.moveAnnotation(state.id, incremental.x, incremental.y, { clamp: true });
      } else if (state.type === 'resize') {
        this._document.resizeAnnotation(state.id, state.handle, incremental.x, incremental.y, {
          minSize: 0.005,
          clamp: true,
          scaleStyle: false,
        });
      } else if (state.type === 'curve') {
        this._document.updateAnnotation(state.id, { bend: current });
      } else if (state.type === 'draw') {
        if (state.tool === 'pencil') {
          const annotation = this._document.annotations.find((item) => item.id === state.id);
          this._document.updateAnnotation(state.id, {
            points: [...(annotation?.points ?? []), current],
          });
        } else {
          this._document.updateAnnotation(
            state.id,
            this._annotationGeometry(state.tool, state.start, current),
          );
        }
      }

      state.last = current;
      this._afterDocumentChange();
    }

    _dragEnd(dx, dy, owner = null) {
      if (!this._dragState || (owner && this._dragOwner !== owner)) return;

      const state = this._dragState;
      const offsetX = Number(dx) || 0;
      const offsetY = Number(dy) || 0;
      const routeClick =
        state.routeClick && Math.hypot(offsetX, offsetY) <= POINTER_CLICK_THRESHOLD;

      if (routeClick) {
        if (state.type === 'pan') {
          this._panX = state.panX;
          this._panY = state.panY;
        } else if (state.type.startsWith('crop')) {
          this._cropRect = { ...state.originalRect };
        } else if (this._document?.inTransaction) {
          this._document.cancelTransaction();
        }

        this._dragState = null;
        this._dragOwner = null;
        this._openContextAt(state.viewStart.x + offsetX, state.viewStart.y + offsetY);
        this._drawingArea.queue_draw();
        return;
      }

      this._dragUpdate(dx, dy, owner);
      const type = this._dragState.type;
      this._dragState = null;
      this._dragOwner = null;

      if (['draw', 'move', 'resize', 'curve'].includes(type)) this._document.commitTransaction();

      if (type === 'draw') this._activateTool('select');

      this._afterDocumentChange();
    }

    _cancelDrag(owner = null) {
      const state = this._dragState;

      if (!state || (owner && this._dragOwner !== owner)) return;

      if (state.type === 'pan') {
        this._panX = state.panX;
        this._panY = state.panY;
      } else if (state.type.startsWith('crop')) {
        this._cropRect = { ...state.originalRect };
      } else if (
        ['draw', 'move', 'resize', 'curve'].includes(state.type) &&
        this._document?.inTransaction
      ) {
        this._document.cancelTransaction();
      }

      this._dragState = null;
      this._dragOwner = null;
      this._afterDocumentChange();
    }

    _beginInlineTextEdit(annotation, options = {}) {
      if (!this._document || annotation?.type !== 'text') return false;

      if (this._inlineTextState?.annotationId === annotation.id) {
        this._inlineTextState.entry.grab_focus();
        return true;
      }

      if (this._inlineTextState) this._finishInlineTextEdit();

      if (!options.transactionOpen) {
        if (this._document.inTransaction) this._document.commitTransaction();
        if (!this._document.beginTransaction('Edit text annotation')) return false;
      } else if (
        !this._document.inTransaction &&
        !this._document.beginTransaction('Add text annotation')
      ) {
        return false;
      }
      this._syncUndoRedo();

      const entry = new Gtk.Text({
        text: String(annotation.text ?? ''),
        placeholder_text: 'Type text',
        propagate_text_width: false,
        truncate_multiline: true,
        xalign: 0,
        halign: Gtk.Align.START,
        valign: Gtk.Align.START,
      });
      entry.add_css_class('bolas-image-inline-text-entry');
      entry.update_property([Gtk.AccessibleProperty.LABEL], ['Edit text on image']);

      const state = {
        annotationId: annotation.id,
        entry,
        isNew: Boolean(options.isNew),
        acceptFocusOut: false,
      };
      this._inlineTextState = state;
      this._canvasOverlay.add_overlay(entry);
      this._surfaceDirty = true;

      entry.connect('changed', () => {
        if (this._inlineTextState !== state) return;
        this._text = entry.get_text();
        this._document?.updateAnnotation(state.annotationId, { text: this._text });
        this._afterDocumentChange();
      });
      entry.connect('activate', () => this._finishInlineTextEdit());
      entry.connect('notify::has-focus', () => {
        if (
          this._inlineTextState !== state ||
          !state.acceptFocusOut ||
          entry.has_focus() ||
          this._inlineTextFocusSourceId
        ) {
          return;
        }

        this._inlineTextFocusSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
          this._inlineTextFocusSourceId = 0;
          if (this._inlineTextState === state && !entry.has_focus()) this._finishInlineTextEdit();
          return GLib.SOURCE_REMOVE;
        });
      });

      this._positionInlineTextEditor();
      this._inlineTextFocusSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        this._inlineTextFocusSourceId = 0;
        if (this._inlineTextState !== state) return GLib.SOURCE_REMOVE;
        state.acceptFocusOut = true;
        entry.grab_focus();
        entry.select_region(0, -1);
        this._positionInlineTextEditor();
        return GLib.SOURCE_REMOVE;
      });
      this._drawingArea.queue_draw();
      return true;
    }

    _finishInlineTextEdit({ cancel = false, restoreFocus = true } = {}) {
      const state = this._inlineTextState;

      if (!state) return false;

      this._inlineTextState = null;
      if (this._inlineTextFocusSourceId) {
        GLib.source_remove(this._inlineTextFocusSourceId);
        this._inlineTextFocusSourceId = 0;
      }

      const text = state.entry.get_text();
      this._canvasOverlay.remove_overlay(state.entry);

      if (cancel) {
        this._document?.cancelTransaction();
      } else if (this._document) {
        if (text.trim()) {
          this._document.updateAnnotation(state.annotationId, { text });
          this._document.commitTransaction();
          this._text = text;
        } else if (state.isNew) {
          this._document.cancelTransaction();
        } else {
          this._document.deleteAnnotation(state.annotationId);
          this._document.commitTransaction();
        }
      }

      if (state.isNew) this._activateTool('select');

      this._afterDocumentChange();
      if (restoreFocus) this._drawingArea.grab_focus();
      return true;
    }

    _positionInlineTextEditor() {
      const state = this._inlineTextState;
      const annotation = this._document?.annotations.find(
        (item) => item.id === state?.annotationId,
      );

      if (!state || annotation?.type !== 'text') return;

      const geometry = this._viewGeometry();
      const canvasRect = this._activeBoundsToCanvas(annotation.rect);
      const layer = this._activeLayerPixelSize();
      const canvasWidth = Math.max(1, this._drawingArea.get_width());
      const canvasHeight = Math.max(1, this._drawingArea.get_height());
      const desiredWidth = canvasRect.width * geometry.width * geometry.scale;
      const fontSize =
        Math.max(1, annotation.fontSize * Math.min(layer.width, layer.height)) * geometry.scale;
      const x = clamp(
        geometry.x + canvasRect.x * geometry.width * geometry.scale,
        0,
        Math.max(0, canvasWidth - 1),
      );
      const y = clamp(
        geometry.y + canvasRect.y * geometry.height * geometry.scale,
        0,
        Math.max(0, canvasHeight - 1),
      );
      const width = Math.max(1, Math.min(desiredWidth, canvasWidth - x));

      state.entry.set_attributes(inlineTextAttributes(annotation, fontSize));
      state.entry.set_margin_start(Math.round(x));
      state.entry.set_margin_top(Math.round(y));
      state.entry.set_size_request(Math.round(width), -1);
    }

    _annotationSpec(type, start, end) {
      const common = {
        type,
        opacity: this._opacity,
      };

      if (type === 'pencil') {
        return {
          ...common,
          points: [start],
          strokeColor: this._strokeColor,
          strokeWidth: this._strokeWidth,
        };
      }

      if (type === 'line' || type === 'arrow') {
        return {
          ...common,
          start,
          end,
          strokeColor: this._strokeColor,
          strokeWidth: this._strokeWidth,
        };
      }

      if (type === 'rectangle' || type === 'ellipse') {
        return {
          ...common,
          rect: normalizedRect(start, end),
          strokeColor: this._strokeColor,
          strokeWidth: this._strokeWidth,
          fillColor: this._fillEnabled ? this._fillColor : null,
        };
      }

      return {
        ...common,
        type: 'text',
        rect: {
          x: start.x,
          y: start.y,
          width: Math.min(0.36, 1 - start.x),
          height: Math.min(Math.max(0.08, this._fontSize * 1.5), 1 - start.y),
        },
        text: this._text || 'Text',
        color: this._strokeColor,
        fontSize: this._fontSize,
        fontFamily: this._fontFamily,
        fontWeight: DocumentModel.DEFAULT_ANNOTATION_STYLE.fontWeight,
        rotation: 0,
        flipX: false,
        flipY: false,
      };
    }

    _annotationGeometry(type, start, end) {
      if (type === 'line') return { start, end };
      if (type === 'arrow') {
        return {
          start,
          end,
          bend: {
            x: (start.x + end.x) / 2,
            y: (start.y + end.y) / 2,
          },
        };
      }
      return { rect: normalizedRect(start, end) };
    }

    _updateCropDrag(state, delta) {
      let rect = { ...state.originalRect };

      if (state.type === 'crop-new') {
        rect = normalizedRect(state.start, {
          x: clamp(state.start.x + delta.x, 0, 1),
          y: clamp(state.start.y + delta.y, 0, 1),
        });
      } else if (state.type === 'crop-move') {
        rect.x = clamp(rect.x + delta.x, 0, 1 - rect.width);
        rect.y = clamp(rect.y + delta.y, 0, 1 - rect.height);
        this._cropRect = rect;
        return;
      } else if (DocumentModel.resizeBounds) {
        rect = DocumentModel.resizeBounds(rect, state.handle, delta.x, delta.y, {
          minSize: CROP_MIN_SIZE,
          clamp: true,
          keepAspect: Boolean(this._effectiveCropRatio()),
        });
      } else {
        rect = this._fallbackResizeRect(rect, state.handle, delta.x, delta.y);
      }

      this._cropRect = this._constrainCropRatio(rect, state.handle);
    }

    _fallbackResizeRect(rect, handle, dx, dy) {
      const activeHandle = typeof handle === 'string' && handle ? handle : 'se';

      if (activeHandle.includes('w')) {
        rect.x = clamp(rect.x + dx, 0, rect.x + rect.width - CROP_MIN_SIZE);
        rect.width -= rect.x - this._cropRect.x;
      }
      if (activeHandle.includes('e'))
        rect.width = clamp(rect.width + dx, CROP_MIN_SIZE, 1 - rect.x);
      if (activeHandle.includes('n')) {
        rect.y = clamp(rect.y + dy, 0, rect.y + rect.height - CROP_MIN_SIZE);
        rect.height -= rect.y - this._cropRect.y;
      }
      if (activeHandle.includes('s'))
        rect.height = clamp(rect.height + dy, CROP_MIN_SIZE, 1 - rect.y);
      return rect;
    }

    _effectiveCropRatio() {
      let ratio = this._cropRatio;

      if (ratio === 'original')
        ratio = (this._document?.width ?? 1) / (this._document?.height ?? 1);
      if (!Number.isFinite(ratio) || ratio <= 0) return null;
      return this._cropPortrait ? 1 / ratio : ratio;
    }

    _constrainCropRatio(rect, handle = 'se') {
      const ratio = this._effectiveCropRatio();
      const activeHandle = typeof handle === 'string' && handle ? handle : 'se';

      if (!ratio)
        return {
          x: clamp(rect.x, 0, 1 - CROP_MIN_SIZE),
          y: clamp(rect.y, 0, 1 - CROP_MIN_SIZE),
          width: clamp(rect.width, CROP_MIN_SIZE, 1 - rect.x),
          height: clamp(rect.height, CROP_MIN_SIZE, 1 - rect.y),
        };

      const outputWidth = this._document?.width ?? 1;
      const outputHeight = this._document?.height ?? 1;
      const normalizedRatio = (ratio * outputHeight) / outputWidth;
      let width = rect.width;
      let height = width / normalizedRatio;

      if (height > rect.height && !['e', 'w'].includes(activeHandle)) {
        height = rect.height;
        width = height * normalizedRatio;
      }
      width = clamp(width, CROP_MIN_SIZE, 1);
      height = clamp(height, CROP_MIN_SIZE, 1);
      let x = rect.x;
      let y = rect.y;

      if (activeHandle.includes('w')) x = rect.x + rect.width - width;
      if (activeHandle.includes('n')) y = rect.y + rect.height - height;
      x = clamp(x, 0, 1 - width);
      y = clamp(y, 0, 1 - height);
      return { x, y, width, height };
    }

    _resetCropForRatio() {
      const ratio = this._effectiveCropRatio();

      if (!ratio) {
        this._cropRect = { x: 0, y: 0, width: 1, height: 1 };
      } else {
        const outputWidth = this._document?.width ?? 1;
        const outputHeight = this._document?.height ?? 1;
        const normalizedRatio = (ratio * outputHeight) / outputWidth;
        let width = 0.88;
        let height = width / normalizedRatio;

        if (height > 0.88) {
          height = 0.88;
          width = height * normalizedRatio;
        }
        this._cropRect = {
          x: (1 - width) / 2,
          y: (1 - height) / 2,
          width,
          height,
        };
      }
      this._drawingArea.queue_draw();
    }

    _applyCrop() {
      if (!this._document) return;

      const rect = this._cropRect;

      if (rect.x > 0.0001 || rect.y > 0.0001 || rect.width < 0.9998 || rect.height < 0.9998)
        this._document.crop(rect);

      this._cropRect = { x: 0, y: 0, width: 1, height: 1 };
      this._afterDocumentChange();
      this._resetCropForRatio();
    }

    _transformDocument(callback) {
      if (!this._document) return;
      callback();
      this._cropRect = { x: 0, y: 0, width: 1, height: 1 };
      this._afterDocumentChange();
    }

    async _ensureStaticEditingAccepted() {
      if (!this._conversionAccepted && (this._source.isAnimated || this._source.isVector)) {
        const kind = this._source.isAnimated ? 'animated image' : 'vector image';
        const accepted = await this._choose(
          `Edit ${kind}?`,
          `Editing will use the currently displayed rendering and save a static PNG. The original file will not be changed.`,
          'Edit',
        );

        if (!accepted) return false;
        this._conversionAccepted = true;
      }

      return true;
    }

    async _requestEditMode(mode, options = {}) {
      if (!this._source || !this._document || this._busy) return;
      if (!(await this._ensureStaticEditingAccepted())) return;

      if (this._mode === 'draw' && mode !== 'draw') this._finishDrawPanel({ hide: false });
      if (this._mode === 'crop' && mode !== 'crop') this._finishCropPanel({ hide: false });
      this._stopAnimation();
      this._enterEditMode(mode, options);
    }

    _enterEditMode(mode, { annotationId = null, layer = null } = {}) {
      if (mode === 'draw') {
        this._mode = 'draw';
        if (this._currentHeader !== this._viewHeader) this._replaceHeader(this._viewHeader);
        const targetLayer = annotationId && layer === 'canvas' ? 'canvas' : 'image';
        if (this._backgroundEnabled) this._selectCompositionLayer(targetLayer);
        this._canvasDocument?.select(null);
        this._imageDocument?.select(null);
        if (annotationId) this._document?.select(annotationId);
        this._activateTool('select', { remember: false, syncControl: false });
        this._sidebarKind = 'draw';
        this._sidebarScroller.set_child(this._createDrawSidebar());
        this._setSidebarVisible(true);
        this._zoomControls.set_visible(true);
        this._drawingArea.set_cursor_from_name('default');
        this._drawingArea.queue_draw();
        return;
      }

      this._mode = 'crop';
      if (this._currentHeader !== this._viewHeader) this._replaceHeader(this._viewHeader);
      this._selectCompositionLayer('image');
      this._imageDocument?.select(null);
      this._sidebarKind = 'crop';
      this._sidebarScroller.set_child(this._createCropSidebar());
      this._setSidebarVisible(true);
      this._zoomControls.set_visible(true);
      this._drawingArea.set_cursor_from_name('default');
      this._resetCropForRatio();
      this._drawingArea.queue_draw();
    }

    _finishDrawPanel({ hide = true } = {}) {
      if (this._mode !== 'draw') return false;

      this._finishInlineTextEdit({ restoreFocus: false });
      if (this._document?.inTransaction) this._document.cancelTransaction();
      this._dragState = null;
      this._dragOwner = null;
      this._mode = 'view';
      this._document?.select(null);
      this._drawUndoButton = null;
      this._drawRedoButton = null;
      this._sidebarKind = hide ? null : this._sidebarKind;
      if (this._currentHeader !== this._viewHeader) this._replaceHeader(this._viewHeader);
      if (hide) this._setSidebarVisible(false);
      this._zoomControls.set_visible(true);
      this._drawingArea.set_cursor_from_name('default');
      this._drawingArea.queue_draw();

      if (!this._isDirty()) this._startAnimation();
      return true;
    }

    _finishCropPanel({ hide = true } = {}) {
      if (this._mode !== 'crop') return false;

      if (this._document?.inTransaction) this._document.cancelTransaction();
      this._dragState = null;
      this._dragOwner = null;
      this._cropRect = { x: 0, y: 0, width: 1, height: 1 };
      this._mode = 'view';
      this._document?.select(null);
      this._cropUndoButton = null;
      this._cropRedoButton = null;
      this._sidebarKind = hide ? null : this._sidebarKind;
      if (this._currentHeader !== this._viewHeader) this._replaceHeader(this._viewHeader);
      if (hide) this._setSidebarVisible(false);
      this._zoomControls.set_visible(true);
      this._drawingArea.set_cursor_from_name('default');
      this._drawingArea.queue_draw();

      if (!this._isDirty()) this._startAnimation();
      return true;
    }

    _leaveEditMode() {
      if (this._mode === 'draw') return this._finishDrawPanel();
      if (this._mode === 'crop') return this._finishCropPanel();
      return false;
    }

    _replaceHeader(header) {
      if (this._currentHeader) this._toolbarView.remove(this._currentHeader);
      this._toolbarView.add_top_bar(header);
      this._currentHeader = header;
    }

    _afterDocumentChange() {
      this._surfaceDirty = true;
      this._renderError = null;
      this._setStatus('', false);
      this._syncUndoRedo();
      this._syncSelectionControls();
      this._positionInlineTextEditor();
      this._drawingArea.queue_draw();
    }

    _afterSelectionChange() {
      this._syncSelectionControls();
      this._drawingArea.queue_draw();
    }

    _syncUndoRedo() {
      const canUndo = Boolean(this._document?.canUndo) && !this._busy;
      const canRedo = Boolean(this._document?.canRedo) && !this._busy;
      this._drawUndoButton?.set_sensitive(canUndo);
      this._drawRedoButton?.set_sensitive(canRedo);
      this._cropUndoButton?.set_sensitive(canUndo);
      this._cropRedoButton?.set_sensitive(canRedo);
    }

    _undo() {
      if (this._document?.undo()) this._afterDocumentChange();
    }

    _redo() {
      if (this._document?.redo()) this._afterDocumentChange();
    }

    _deleteSelection() {
      this._finishInlineTextEdit({ restoreFocus: false });
      if (!this._document?.selectionId) return;
      this._document.deleteAnnotation();
      this._afterDocumentChange();
    }

    _activeDrawType() {
      if (this._tool !== 'select') return this._tool;

      return this._document?.selectedAnnotation?.type ?? 'select';
    }

    _activateTool(tool, { remember = true, syncControl = true } = {}) {
      if (!TOOL_LABELS.some(([candidate]) => candidate === tool)) return false;

      if (this._inlineTextState && tool !== this._tool)
        this._finishInlineTextEdit({ restoreFocus: false });

      this._tool = tool;
      if (remember) this._preferences.rememberEditorOption('tool', tool);
      if (this._mode === 'draw' && tool !== 'select' && this._backgroundEnabled)
        this._selectCompositionLayer('canvas');
      const toolButton = syncControl ? this._toolButtons?.get(tool) : null;

      if (toolButton && !toolButton.get_active()) toolButton.set_active(true);

      this._drawingArea?.set_cursor_from_name(tool === 'select' ? 'default' : 'crosshair');
      this._syncDrawControlVisibility();
      this._syncCompactStyleControls();
      return true;
    }

    _syncCompactStyleControls() {
      if (this._mode !== 'draw') return;

      const wasSyncing = this._syncingStyleControls;
      this._syncingStyleControls = true;
      try {
        const colorIndex = closestPresetColorIndex(this._strokeColor);
        const colorButton = this._colorButtons?.[colorIndex];

        if (colorButton && !colorButton.get_active()) colorButton.set_active(true);

        const isText = this._activeDrawType() === 'text';
        const sizeItems = isText ? TEXT_SIZES : THICKNESSES;
        const sizeValue = isText ? this._fontSize : this._strokeWidth;
        const sizeButton = this._sizeButtons?.[closestValueIndex(sizeItems, sizeValue)];

        if (sizeButton && !sizeButton.get_active()) sizeButton.set_active(true);
        if (isText && this._fontButton) {
          const displayedFamily = this._fontButton.get_font_desc()?.get_family();
          if (displayedFamily !== this._fontFamily)
            this._fontButton.set_font_desc(Pango.FontDescription.from_string(this._fontFamily));
        }

        if (this._fillSwitch?.get_active() !== this._fillEnabled)
          this._fillSwitch?.set_active(this._fillEnabled);
      } finally {
        this._syncingStyleControls = wasSyncing;
      }
    }

    _syncSelectionControls() {
      const selected = this._document?.selectedAnnotation;
      this._objectActions?.set_visible(Boolean(selected));
      this._duplicateButton?.set_sensitive(Boolean(selected));
      this._deleteButton?.set_sensitive(Boolean(selected));

      if (!selected) {
        this._syncDrawControlVisibility();
        this._syncCompactStyleControls();
        return;
      }

      this._syncingStyleControls = true;
      try {
        this._opacity = selected.opacity ?? 1;

        if (selected.type === 'text') {
          this._strokeColor = selected.color ?? this._strokeColor;
          this._fontFamily = selected.fontFamily ?? this._fontFamily;
          this._fontSize = selected.fontSize ?? this._fontSize;
          this._text = selected.text ?? '';
        } else {
          this._strokeColor = selected.strokeColor ?? this._strokeColor;
          this._strokeWidth = selected.strokeWidth ?? this._strokeWidth;

          if (selected.type === 'rectangle' || selected.type === 'ellipse') {
            this._fillEnabled = Boolean(selected.fillColor);
            if (selected.fillColor) this._fillColor = selected.fillColor;
          }
        }
      } finally {
        this._syncingStyleControls = false;
      }
      this._syncDrawControlVisibility();
      this._syncCompactStyleControls();
    }

    _syncDrawControlVisibility() {
      const activeType = this._activeDrawType();
      const shape = activeType === 'rectangle' || activeType === 'ellipse';
      this._fontControls?.set_visible(activeType === 'text');
      this._fillControls?.set_visible(shape);
    }

    _updateSelectedStyle(changes = {}) {
      const selected = this._document?.selectedAnnotation;

      if (!selected) return;

      const patch = {};
      if (selected.type === 'text') {
        if (Object.hasOwn(changes, 'strokeColor')) patch.color = changes.strokeColor;
        if (Object.hasOwn(changes, 'fontFamily')) patch.fontFamily = changes.fontFamily;
        if (Object.hasOwn(changes, 'fontSize')) patch.fontSize = changes.fontSize;
        if (Object.hasOwn(changes, 'opacity')) patch.opacity = changes.opacity;
      } else {
        if (Object.hasOwn(changes, 'strokeColor')) patch.strokeColor = changes.strokeColor;
        if (Object.hasOwn(changes, 'strokeWidth')) patch.strokeWidth = changes.strokeWidth;
        if (Object.hasOwn(changes, 'opacity')) patch.opacity = changes.opacity;
        if (
          (selected.type === 'rectangle' || selected.type === 'ellipse') &&
          Object.hasOwn(changes, 'fillColor')
        ) {
          patch.fillColor = changes.fillColor;
        }
      }

      if (Object.keys(patch).length === 0) return;
      this._document.updateAnnotation(selected.id, patch);
      this._afterDocumentChange();
    }

    _zoomBy(factor) {
      if (!this._source) return;
      this._fit = false;
      this._zoomFactor = clamp(this._zoomFactor * factor, MIN_ZOOM, MAX_ZOOM);
      this._syncZoomLabel();
      this._positionInlineTextEditor();
      this._drawingArea.queue_draw();
    }

    _fitImage() {
      this._fit = true;
      this._zoomFactor = 1;
      this._panX = 0;
      this._panY = 0;
      this._syncZoomLabel();
      this._positionInlineTextEditor();
      this._drawingArea.queue_draw();
    }

    _setActualSize() {
      const geometry = this._viewGeometry();
      this._fit = false;
      this._zoomFactor = clamp(1 / Math.max(geometry.fitScale, 0.0001), MIN_ZOOM, MAX_ZOOM);
      this._panX = 0;
      this._panY = 0;
      this._syncZoomLabel();
      this._positionInlineTextEditor();
      this._drawingArea.queue_draw();
    }

    _syncZoomLabel() {
      if (!this._zoomLabel) return;
      if (this._fit) {
        this._zoomLabel.set_label('Fit');
        return;
      }
      const geometry = this._viewGeometry();
      this._zoomLabel.set_label(`${Math.round(geometry.scale * 100)}%`);
    }

    _toggleFullscreen() {
      if (this._hostWindow().is_fullscreen() || this._fullscreenRequestSourceId)
        this._leaveFullscreen();
      else this._enterFullscreen();
    }

    _enterFullscreen() {
      const host = this._hostWindow();
      const transientParent = host.get_transient_for();

      if (transientParent) {
        this._fullscreenTransientParent = transientParent;
        host.set_transient_for(null);
      }

      this._fullscreenRequestSourceId = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        FULLSCREEN_REQUEST_TIMEOUT_MS,
        () => {
          this._fullscreenRequestSourceId = 0;

          if (!host.is_fullscreen()) this._restoreFullscreenTransientParent();
          this._syncFullscreenButton();
          return GLib.SOURCE_REMOVE;
        },
      );
      this._syncFullscreenButton();
      host.fullscreen();
    }

    _leaveFullscreen() {
      this._cancelFullscreenRequestTimeout();
      const host = this._hostWindow();
      host.unfullscreen();

      if (!host.is_fullscreen()) this._restoreFullscreenTransientParent();
      this._syncFullscreenButton();
    }

    _cancelFullscreenRequestTimeout() {
      if (!this._fullscreenRequestSourceId) return;

      GLib.source_remove(this._fullscreenRequestSourceId);
      this._fullscreenRequestSourceId = 0;
    }

    _restoreFullscreenTransientParent() {
      const transientParent = this._fullscreenTransientParent;

      if (!transientParent) return;

      this._fullscreenTransientParent = null;
      try {
        this._hostWindow().set_transient_for(transientParent);
      } catch (_error) {
        // The main window may have been destroyed while the editor was fullscreen.
      }
    }

    _syncFullscreenState() {
      if (this._hostWindow().is_fullscreen()) this._cancelFullscreenRequestTimeout();
      else if (!this._fullscreenRequestSourceId) this._restoreFullscreenTransientParent();
      this._syncFullscreenButton();
    }

    _syncFullscreenButton() {
      if (!this._fullscreenButton) return;
      const fullscreened =
        this._hostWindow().is_fullscreen() || Boolean(this._fullscreenRequestSourceId);
      this._fullscreenButton.set_icon_name(
        fullscreened ? 'view-restore-symbolic' : 'view-fullscreen-symbolic',
      );
      this._fullscreenButton.set_tooltip_text(
        fullscreened ? 'Leave Fullscreen (F11)' : 'Enter Fullscreen (F11)',
      );
    }

    _syncAdaptiveLayout() {
      const width = this._hostWindow().get_width();
      const narrow = width > 0 && width < NARROW_WIDTH;

      this._setNarrowLayout(narrow);
    }

    _sidebarVisible() {
      if (this._narrowLayout && this._bottomSheet) return this._bottomSheet.get_open();
      return this._splitView.get_show_sidebar();
    }

    _setSidebarVisible(visible) {
      const show = Boolean(visible);

      if (this._narrowLayout && this._bottomSheet) {
        this._bottomSheet.set_can_close(true);
        this._bottomSheet.set_open(show);
      } else {
        this._splitView.set_show_sidebar(show);
      }
    }

    _setNarrowLayout(narrow) {
      const useBottomSheet = Boolean(narrow && this._bottomSheet);

      if (this._narrowLayout === useBottomSheet) return;

      const sidebarVisible = this._sidebarVisible();

      if (useBottomSheet) {
        this._splitView.set_show_sidebar(false);
        this._splitView.set_sidebar(null);
        this._bottomSheet.set_sheet(this._sidebarScroller);
        this._narrowLayout = true;
        this._bottomSheet.set_can_close(true);
        this._bottomSheet.set_open(sidebarVisible);
      } else {
        this._narrowLayout = false;
        this._bottomSheet?.set_open(false);
        this._bottomSheet?.set_sheet(null);
        this._splitView.set_sidebar(this._sidebarScroller);
        this._splitView.set_pin_sidebar(true);
        this._splitView.set_sidebar_width_fraction(0.32);
        this._splitView.set_show_sidebar(sidebarVisible);
      }
    }

    _workspaceSession() {
      return {
        activeLayer: this._activeLayer,
        cropPortrait: this._cropPortrait,
        cropRatioId:
          CROP_RATIOS.find(([, ratio]) => ratio === this._cropRatio)?.[2] ??
          this._preferences.getEditorPreferences().cropRatioId,
        cropRect: { ...this._cropRect },
        fillColor: this._fillColor,
        fillEnabled: this._fillEnabled,
        fit: this._fit,
        fontFamily: this._fontFamily,
        fontSize: this._fontSize,
        mode: this._mode,
        opacity: this._opacity,
        panX: this._panX,
        panY: this._panY,
        sidebarKind: this._sidebarKind,
        strokeColor: this._strokeColor,
        strokeWidth: this._strokeWidth,
        text: this._text,
        tool: this._tool,
        zoomFactor: this._zoomFactor,
      };
    }

    _createWorkspaceSnapshot() {
      if (!this._imageDocument || !this._source) throw new Error('No image workspace is open.');
      this._finishInlineTextEdit({ restoreFocus: false });
      for (const document of [this._imageDocument, this._canvasDocument]) {
        if (document?.inTransaction) document.commitTransaction();
      }
      this._dragState = null;
      this._dragOwner = null;

      return createImageWorkspace({
        canvasDocument: this._canvasDocument,
        composition: {
          backgroundEnabled: this._backgroundEnabled,
          settings: this._shareSettingsValue(),
        },
        imageDocument: this._imageDocument,
        session: this._workspaceSession(),
        sourceBytes: ImageRenderer.encodePixbufPng(this._source.pixbuf),
        sourceMetadata: {
          displayName: this._workspaceSourceMetadata?.displayName ?? this._image.title,
          originalMimeType:
            this._workspaceSourceMetadata?.originalMimeType ?? this._source.mimeType ?? 'image/png',
          width: this._source.width,
          height: this._source.height,
        },
      });
    }

    async _saveWorkspace() {
      if (!this._document || !this._source || this._busy || this._workspaceSavePending) return;
      this._workspaceSavePending = true;
      this._setBusy(true, 'Preparing workspace…');

      try {
        if (!(await this._ensureStaticEditingAccepted())) return;
        const replaceExisting = Boolean(this._workspacePath);
        const projectName =
          this._image.sourceKind === 'workspace'
            ? this._image.title
            : (this._workspaceSourceMetadata?.displayName ?? this._image.title ?? 'Untitled');
        const path = managedWorkspaceSavePath(this._workspacePath, projectName);
        const workspace = this._createWorkspaceSnapshot();
        const previewSurface = this._getRenderSurface();
        this._setBusy(true, 'Saving workspace…');
        const saved = await writeImageWorkspace(path, workspace, {
          cancellable: this._loadCancellable,
          etag: replaceExisting ? this._workspaceEtag : null,
          replaceExisting,
        });
        try {
          if (!previewSurface) throw this._renderError ?? new Error('No preview is available.');
          writeWorkspacePreview(saved.path, previewSurface);
        } catch (previewError) {
          try {
            removeWorkspacePreview(saved.path);
          } catch {
            // A missing fallback preview must never invalidate the saved workspace.
          }
          logError(previewError, 'Failed to save Bolas workspace preview');
        }
        this._workspacePath = saved.path;
        this._workspaceEtag = saved.etag;
        this._hostWindow().set_title(GLib.path_get_basename(saved.path));
        this._markCompositionSaved();
        this._toast(`Saved ${GLib.path_get_basename(saved.path)} to Recents`);
      } catch (error) {
        if (!isCancellation(error)) {
          logError(error, 'Failed to save Bolas workspace');
          this._showError('Could Not Save Workspace', error.message);
        }
      } finally {
        this._workspaceSavePending = false;
        this._setBusy(false);
      }
    }

    _saveCopy() {
      if (!this._document || !this._source || this._busy) return;
      this._finishInlineTextEdit({ restoreFocus: false });
      const pngFilter = new Gtk.FileFilter();
      pngFilter.set_name('PNG Images');
      pngFilter.add_mime_type('image/png');
      pngFilter.add_pattern('*.png');
      const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
      filters.append(pngFilter);
      const dialog = new Gtk.FileDialog({
        title: this._backgroundEnabled ? 'Export Composed Image' : 'Save Edited Image',
        initial_name: `${basenameWithoutExtension(this._image.path)}-${
          this._backgroundEnabled ? 'share' : 'edited'
        }.png`,
      });
      dialog.set_filters(filters);
      dialog.set_default_filter(pngFilter);
      dialog.save(this._hostWindow(), null, (_dialog, result) => {
        try {
          const file = dialog.save_finish(result);
          const selectedPath = file.get_path();

          if (!selectedPath) throw new Error('Only local save paths are supported.');
          const path = ensurePngExtension(selectedPath);
          if (path !== selectedPath && GLib.file_test(path, GLib.FileTest.EXISTS)) {
            throw new Error(
              `A file named ${GLib.path_get_basename(path)} already exists. ` +
                'Choose that .png filename directly to confirm replacing it.',
            );
          }
          if (Gio.File.new_for_path(path).equal(Gio.File.new_for_path(this._image.path)))
            throw new Error('Choose a new filename. Bolas never overwrites the original image.');

          this._setBusy(true);
          const saved = this._backgroundEnabled
            ? ImageRenderer.exportCompositionPng(
                this._source.pixbuf,
                this._imageDocument,
                this._canvasDocument,
                {
                  ...this._shareSettings,
                  sourceHasTransparency: this._sourceHasTransparency,
                },
                path,
                { sourcePath: this._image.path },
              )
            : ImageRenderer.exportDocumentPng(this._source.pixbuf, this._imageDocument, path, {
                sourcePath: this._image.path,
              });
          const outputPath = saved?.path ?? path;
          this._setBusy(false);
          this._toast(`Exported ${GLib.path_get_basename(outputPath)}`);
        } catch (error) {
          if (isCancellation(error)) return;
          this._setBusy(false);
          logError(error, 'Failed to save edited image');
          this._showError('Could Not Save Image', error.message);
        }
      });
    }

    _createManagedOutput() {
      if (this._backgroundEnabled) {
        const path = createManagedSharePath(this._image.path);
        return ImageRenderer.exportCompositionPng(
          this._source.pixbuf,
          this._imageDocument,
          this._canvasDocument,
          {
            ...this._shareSettings,
            sourceHasTransparency: this._sourceHasTransparency,
          },
          path,
          { sourcePath: this._image.path },
        ).path;
      }

      const saved = ImageRenderer.saveDocumentForShare(
        this._source.pixbuf,
        this._imageDocument,
        this._image.path,
        { directory: this._editedImageDirectory ?? undefined },
      );
      return saved?.path ?? saved;
    }

    async _saveAndShare() {
      if (!this._document || !this._source || this._busy) return;
      this._finishInlineTextEdit({ restoreFocus: false });

      this._setBusy(true);
      try {
        const outputPath = this._createManagedOutput();

        if (!outputPath) throw new Error('The edited image was not created.');
        await shareImage(this._hostWindow(), outputPath);
      } catch (error) {
        if (!isCancellation(error)) {
          logError(error, 'Failed to share edited image');
          this._showError('Could Not Share Image', error.message);
        }
      } finally {
        this._setBusy(false);
      }
    }

    _setBusy(busy, message = 'Rendering image…') {
      this._busy = Boolean(busy);
      this._syncActionSensitivity();
      this._syncUndoRedo();
      if (busy) this._setStatus(message, true);
      else if (!this._renderError) this._setStatus('', false);
    }

    _toast(message) {
      this._toastOverlay.add_toast(new Adw.Toast({ title: String(message ?? '') }));
    }

    _showError(heading, body) {
      const dialog = new Adw.AlertDialog({
        heading,
        body: String(body || 'An unexpected error occurred.'),
      });
      dialog.add_response('close', 'Close');
      dialog.set_default_response('close');
      dialog.set_close_response('close');
      dialog.present(this._hostWindow());
    }

    _choose(heading, body, acceptLabel) {
      return new Promise((resolve) => {
        const dialog = new Adw.AlertDialog({ heading, body });
        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('accept', acceptLabel);
        dialog.set_close_response('cancel');
        dialog.set_default_response('accept');
        dialog.set_response_appearance('accept', Adw.ResponseAppearance.SUGGESTED);
        dialog.choose(this._hostWindow(), null, (_dialog, result) => {
          try {
            resolve(dialog.choose_finish(result) === 'accept');
          } catch (_error) {
            resolve(false);
          }
        });
      });
    }

    _onCloseRequest() {
      if (this._allowClose || !this._isDirty()) return false;

      this._confirmDiscard();
      return true;
    }

    async _confirmDiscard(onDiscard = null) {
      if (this._discardDialogOpen) return;
      this._discardDialogOpen = true;
      const discard = await this._choose(
        'Discard Unsaved Changes?',
        'Your editable workspace changes have not been saved. Exported images are unchanged.',
        'Discard',
      );
      this._discardDialogOpen = false;

      if (discard) {
        if (onDiscard) onDiscard();
        else {
          this._allowClose = true;
          this.close();
        }
      }
    }

    _handleKey(keyval, state) {
      const control = (state & Gdk.ModifierType.CONTROL_MASK) !== 0;
      const shift = (state & Gdk.ModifierType.SHIFT_MASK) !== 0;
      const editableFocus = isEditableFocus(this._hostWindow().get_focus());

      if (keyval === Gdk.KEY_Escape && this._inlineTextState) {
        this._finishInlineTextEdit({ cancel: true });
        return true;
      }

      if (keyval === Gdk.KEY_F11) {
        this._toggleFullscreen();
        return true;
      }
      if (keyval === Gdk.KEY_Escape) {
        if (this._mode !== 'view') this._leaveEditMode();
        else if (this._hostWindow().is_fullscreen() || this._fullscreenRequestSourceId)
          this._leaveFullscreen();
        else this.requestBack();
        return true;
      }
      if (
        !editableFocus &&
        (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_KP_Enter) &&
        this._mode === 'draw' &&
        this._document?.selectedAnnotation?.type === 'text'
      ) {
        this._beginInlineTextEdit(this._document.selectedAnnotation);
        return true;
      }
      if (control && keyval === Gdk.KEY_z && !editableFocus) {
        shift ? this._redo() : this._undo();
        return true;
      }
      if (control && keyval === Gdk.KEY_y && !editableFocus) {
        this._redo();
        return true;
      }
      if (control && !shift && (keyval === Gdk.KEY_s || keyval === Gdk.KEY_S)) {
        this._saveWorkspace();
        return true;
      }
      if (
        (keyval === Gdk.KEY_Delete || keyval === Gdk.KEY_BackSpace) &&
        this._mode === 'draw' &&
        this._document?.selectionId &&
        !editableFocus
      ) {
        this._deleteSelection();
        return true;
      }
      if (
        !editableFocus &&
        (keyval === Gdk.KEY_plus || keyval === Gdk.KEY_equal || keyval === Gdk.KEY_KP_Add)
      ) {
        this._zoomBy(1.25);
        return true;
      }
      if (!editableFocus && (keyval === Gdk.KEY_minus || keyval === Gdk.KEY_KP_Subtract)) {
        this._zoomBy(1 / 1.25);
        return true;
      }
      if (!editableFocus && keyval === Gdk.KEY_0) {
        this._fitImage();
        return true;
      }
      if (!editableFocus && keyval === Gdk.KEY_1) {
        this._setActualSize();
        return true;
      }
      return false;
    }
  },
);

export function presentImageEditor(options = {}) {
  const viewer = new ImageViewerWindow(options);

  if (options.parent?.showWorkspace)
    options.parent.showWorkspace(viewer.getEmbeddedContent(), viewer);
  else viewer.present();
  return viewer;
}

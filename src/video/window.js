import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Graphene from 'gi://Graphene?version=1.0';
import Gsk from 'gi://Gsk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import { getUserPreferences } from '../preferences.js';
import { shareMedia } from '../services/media-share.js';
import { analyzeVideoInputFocus } from '../services/video-auto-focus.js';
import {
  createManagedVideoPath,
  exportEditedVideo,
  isVideoExportCancellation,
} from '../services/video-export.js';
import {
  generateVideoThumbnail,
  isVideoThumbnailCancellation,
  videoWorkspaceCoverTimestampUs,
} from '../services/video-thumbnail.js';
import {
  loadVideoWorkspaceSource,
  materializeVideoWorkspaceSource,
  removeMaterializedVideoWorkspaceSource,
} from '../services/video-workspace-source.js';
import { readWorkspace, writeWorkspace } from '../services/workspace-file.js';
import { isManagedWorkspacePath, managedWorkspaceSavePath } from '../services/workspace-library.js';
import {
  removeWorkspacePreview,
  writeWorkspacePreviewFromPng,
} from '../services/workspace-preview.js';
import { createShareSettingsSidebar } from '../share/controls.js';
import {
  paintShareVideoBackdrop,
  shareImageLayout,
  sharePreviewCanvasLayout,
} from '../share/renderer.js';
import { presentExportDialog } from '../window.js';
import {
  moveVideoMask,
  normalizeVideoEdit,
  resizeVideoMask,
  resizeVideoTimelineBlock,
  VIDEO_SPEED_VALUES,
  videoEditKey,
  videoMaskContainsPoint,
  videoMaskHandleAt,
  videoMaskResizeHandles,
  videoSourceTransformAt,
  videoTimeLabel,
} from './edit.js';
import { LatestFrameCoalescer } from './frame-coalescer.js';
import { PlaybackClock } from './playback-clock.js';
import { VideoTimeline } from './timeline.js';
import { createVideoWorkspace } from './workspace.js';

const SIDEBAR_SLOT_WIDTH = 370;
const DEFAULT_EFFECT_DURATION_US = 2_000_000;
const BLUR_HANDLE_SIZE = 12;
const BLUR_HANDLE_HIT_RADIUS = 12;
const BLUR_KEYBOARD_STEP = 0.01;
const VIDEO_RADIUS_CLASSES = Object.freeze([
  'video-radius-flat',
  'video-radius-small',
  'video-radius-medium',
  'video-radius-large',
]);
const BLUR_HANDLE_CURSORS = Object.freeze({
  e: 'ew-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  nw: 'nwse-resize',
  s: 'ns-resize',
  se: 'nwse-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
});

function rgba(value) {
  const color = new Gdk.RGBA();
  color.parse(value);
  return color;
}

const BLUR_SELECTION_COLOR = rgba('#3584e4');
const BLUR_HANDLE_COLOR = rgba('#ffffff');

function isCancellation(error) {
  return Boolean(
    error?.matches?.(Gtk.dialog_error_quark(), Gtk.DialogError.DISMISSED) ||
      error?.matches?.(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED) ||
      isVideoExportCancellation(error),
  );
}

function outputStem(path) {
  const basename = GLib.path_get_basename(String(path ?? 'video'));
  const dot = basename.lastIndexOf('.');
  return dot > 0 ? basename.slice(0, dot) : basename;
}

function smallAction(iconName, label, callback) {
  const button = new Gtk.Button({ icon_name: iconName, label, tooltip_text: label });
  button.connect('clicked', callback);
  return button;
}

function labelledScale(label, minimum, maximum, step, value, onChange) {
  const box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 });
  box.append(new Gtk.Label({ label, xalign: 0 }));
  const scale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, minimum, maximum, step);
  scale.set_draw_value(false);
  scale.set_hexpand(true);
  scale.set_value(value);
  scale.connect('value-changed', () => onChange(scale.get_value()));
  box.append(scale);
  return { box, scale };
}

function sharePreviewKey(sourceWidth, sourceHeight, settings = {}) {
  return [
    sourceWidth,
    sourceHeight,
    settings.cornerRadius,
    settings.padding,
    settings.presetId,
    settings.ratioId,
    settings.shadow,
    settings.shadowStrength,
  ].join(':');
}

function appendSnapshotRectangle(snapshot, color, x, y, width, height) {
  if (width <= 0 || height <= 0) return;
  const rect = new Graphene.Rect();
  rect.init(x, y, width, height);
  snapshot.append_color(color, rect);
}

const VideoEffectPicture = GObject.registerClass(
  {
    GTypeName: 'BolasVideoEffectPicture',
  },
  class VideoEffectPicture extends Gtk.Picture {
    _init(options = {}) {
      super._init(options);
      this._blurRegions = [];
      this._blurRegionsKey = '';
      this._selectedBlurRegionId = '';
    }

    setBlurRegions(regions = []) {
      const normalized = regions.map((region) => ({
        blur: Math.max(0, Number(region.blur) || 0),
        height: Math.max(0, Number(region.height) || 0),
        id: String(region.id ?? ''),
        width: Math.max(0, Number(region.width) || 0),
        x: Math.max(0, Number(region.x) || 0),
        y: Math.max(0, Number(region.y) || 0),
      }));
      const key = JSON.stringify(normalized);
      if (key === this._blurRegionsKey) return;
      this._blurRegions = normalized;
      this._blurRegionsKey = key;
      this.queue_draw();
    }

    setSelectedBlurRegion(id = '') {
      const selectedId = String(id ?? '');
      if (selectedId === this._selectedBlurRegionId) return;
      this._selectedBlurRegionId = selectedId;
      this.queue_draw();
    }

    _snapshotSelection(snapshot, region, width, height) {
      const x = region.x * width;
      const y = region.y * height;
      const regionWidth = Math.min(width * region.width, width - x);
      const regionHeight = Math.min(height * region.height, height - y);
      const lineWidth = 2;
      appendSnapshotRectangle(snapshot, BLUR_SELECTION_COLOR, x, y, regionWidth, lineWidth);
      appendSnapshotRectangle(
        snapshot,
        BLUR_SELECTION_COLOR,
        x,
        y + regionHeight - lineWidth,
        regionWidth,
        lineWidth,
      );
      appendSnapshotRectangle(snapshot, BLUR_SELECTION_COLOR, x, y, lineWidth, regionHeight);
      appendSnapshotRectangle(
        snapshot,
        BLUR_SELECTION_COLOR,
        x + regionWidth - lineWidth,
        y,
        lineWidth,
        regionHeight,
      );

      for (const handle of videoMaskResizeHandles(region)) {
        const handleX = handle.x * width - BLUR_HANDLE_SIZE / 2;
        const handleY = handle.y * height - BLUR_HANDLE_SIZE / 2;
        appendSnapshotRectangle(
          snapshot,
          BLUR_SELECTION_COLOR,
          handleX,
          handleY,
          BLUR_HANDLE_SIZE,
          BLUR_HANDLE_SIZE,
        );
        appendSnapshotRectangle(
          snapshot,
          BLUR_HANDLE_COLOR,
          handleX + 2,
          handleY + 2,
          BLUR_HANDLE_SIZE - 4,
          BLUR_HANDLE_SIZE - 4,
        );
      }
    }

    vfunc_snapshot(snapshot) {
      super.vfunc_snapshot(snapshot);
      const width = this.get_width();
      const height = this.get_height();
      for (const region of this._blurRegions) {
        const rect = new Graphene.Rect();
        rect.init(
          region.x * width,
          region.y * height,
          Math.min(width * region.width, width * (1 - region.x)),
          Math.min(height * region.height, height * (1 - region.y)),
        );
        snapshot.push_clip(rect);
        snapshot.push_blur(region.blur);
        super.vfunc_snapshot(snapshot);
        snapshot.pop();
        snapshot.pop();
      }
      const selected = this._blurRegions.find(
        (region) => region.id && region.id === this._selectedBlurRegionId,
      );
      if (selected) this._snapshotSelection(snapshot, selected, width, height);
    }
  },
);

export const VideoEditorView = GObject.registerClass(
  {
    GTypeName: 'BolasVideoEditorView',
  },
  class VideoEditorView extends Gtk.Box {
    _init(options = {}) {
      super._init({ orientation: Gtk.Orientation.VERTICAL });

      const workspacePath = String(options.workspacePath ?? '');
      this._hostWindow = options.parent ?? null;
      this._videoPath = String(options.videoPath ?? '');
      this._workspaceInputPath = workspacePath;
      this._workspaceLoad = options.workspaceLoad ?? null;
      this._workspacePath = null;
      this._workspaceEtag = null;
      this._workspaceSourceMetadata = null;
      this._workspaceCancellable = null;
      this._workspaceSavePending = false;
      this._materializedVideoPath = null;
      this._pendingWorkspace = null;
      this._preferences = options.preferences ?? getUserPreferences();
      this._shareSettings = { ...this._preferences.getSharePreferences() };
      this._durationUs = 0;
      this._sourceWidth = 0;
      this._sourceHeight = 0;
      this._timestampUs = 0;
      this._edit = normalizeVideoEdit({ share: this._shareSettings, shareEnabled: true });
      Object.assign(this._shareSettings, this._edit.share);
      this._edit.share = this._shareSettings;
      this._savedEditKey = '';
      this._syncingControls = false;
      this._busy = false;
      this._disposed = false;
      this._discardDialogOpen = false;
      this._autoFocusCancellable = null;
      this._autoFocusStarted = false;
      this._exportCancellable = null;
      this._exportDialog = null;
      this._mediaSignalIds = [];
      this._selectedEffect = { id: '', kind: '' };
      this._nextEffectId = 1;
      this._lastSharePreviewKey = '';
      this._previewCanvasWidth = 0;
      this._previewCanvasHeight = 0;
      this._previewVideoWidth = 0;
      this._previewVideoHeight = 0;
      this._lastVideoTransformKey = '';
      this._videoRadiusClass = '';
      this._requestedSeekUs = null;
      this._timeLabelText = '';
      this._captionPreviewKey = '';
      this._playButtonIcon = 'media-playback-start-symbolic';
      this._playbackClock = new PlaybackClock();
      this._playbackFrameId = null;

      this._media = this._videoPath
        ? Gtk.MediaFile.new_for_file(Gio.File.new_for_path(this._videoPath))
        : null;
      this.append(this._buildView());
      this._timelineInteractionUpdates = this._createFrameCoalescer((request) =>
        this._applyTimelineInteraction(request),
      );
      this._maskInteractionUpdates = this._createFrameCoalescer((request) =>
        this._applyMaskInteraction(request),
      );
      this._playbackUpdates = this._createFrameCoalescer(() => this._playbackChanged());
      this._installKeyboardShortcuts();
      if (workspacePath) this._loadWorkspace();
      else this._connectMedia();
    }

    _createFrameCoalescer(apply) {
      return new LatestFrameCoalescer({
        apply,
        cancelFrame: (frameId) => this.remove_tick_callback(frameId),
        requestFrame: (callback) =>
          this.add_tick_callback(() => {
            callback();
            return GLib.SOURCE_REMOVE;
          }),
      });
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
      this._exportCancellable?.cancel();
      this._autoFocusCancellable?.cancel();
      this._workspaceCancellable?.cancel();
      if (!this._isDirty()) return false;
      this._confirmDiscard(() => this._hostWindow?.closeAfterWorkspaceConfirmation());
      return true;
    }

    requestWorkspaceReplacement(onReplace) {
      if (!this._isDirty()) return false;
      this._confirmDiscard(onReplace);
      return true;
    }

    disposeEmbedded() {
      if (this._disposed) return;
      this._disposed = true;

      this._quiesceForNavigation();
      this._exportCancellable = null;
      this._autoFocusCancellable = null;
      this._workspaceCancellable = null;
      for (const signalId of this._mediaSignalIds) this._media?.disconnect(signalId);
      this._mediaSignalIds = [];
      this._video?.set_paintable(null);
      this._media = null;
      removeMaterializedVideoWorkspaceSource(this._materializedVideoPath);
      this._materializedVideoPath = null;
    }

    _buildView() {
      const toolbar = new Adw.ToolbarView();
      toolbar.set_extend_content_to_top_edge(true);
      toolbar.set_top_bar_style(Adw.ToolbarStyle.FLAT);
      toolbar.add_top_bar(this._buildHeader());

      const root = new Gtk.Box({
        css_classes: ['video-share-workspace'],
        orientation: Gtk.Orientation.VERTICAL,
        vexpand: true,
      });
      const content = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, vexpand: true });
      content.append(this._buildPreview());

      this._sidebarSlot = new Gtk.Box({
        css_classes: ['share-sidebar-slot'],
        hexpand: false,
        width_request: SIDEBAR_SLOT_WIDTH,
      });
      this._rebuildShareSidebar();
      content.append(this._sidebarSlot);
      root.append(content);
      root.append(this._buildTimelinePanel());
      toolbar.set_content(root);

      this._toastOverlay = new Adw.ToastOverlay({ child: toolbar });
      return this._toastOverlay;
    }

    _rebuildShareSidebar() {
      const current = this._sidebarSlot.get_first_child();
      if (current) this._sidebarSlot.remove(current);
      const sidebar = createShareSettingsSidebar({
        onChange: () => this._shareSettingsChanged(),
        outputKind: 'WebM',
        preferences: this._preferences,
        settings: this._shareSettings,
      });
      sidebar.set_propagate_natural_width(false);
      this._sidebarSlot.append(sidebar);
    }

    _buildHeader() {
      const header = new Adw.HeaderBar({
        show_end_title_buttons: true,
        show_start_title_buttons: false,
        show_title: false,
      });
      header.add_css_class('workspace-transparent-header');

      const back = new Gtk.Button({
        css_classes: ['flat', 'workspace-back-button'],
        icon_name: 'go-previous-symbolic',
        tooltip_text: 'Back to Home',
      });
      back.connect('clicked', () => this.requestBack());
      header.pack_start(back);

      this._shareButton = new Gtk.Button({
        icon_name: 'send-to-symbolic',
        sensitive: false,
        tooltip_text: 'Render and share video with another app',
      });
      this._shareButton.connect('clicked', () => this._share());

      this._exportButton = new Gtk.Button({
        label: 'Export…',
        sensitive: false,
        tooltip_text: 'Export video as MP4 or WebM (Ctrl+Shift+E)',
      });
      this._exportButton.connect('clicked', () => this._export());

      this._saveButton = new Gtk.Button({
        css_classes: ['suggested-action'],
        label: 'Save',
        sensitive: false,
        tooltip_text: 'Save the editable video project as a .bolas workspace (Ctrl+S)',
      });
      this._saveButton.connect('clicked', () => this._saveWorkspace());

      this._cancelOperationButton = new Gtk.Button({
        label: 'Cancel Export',
        tooltip_text: 'Stop the current video operation (Esc)',
        visible: false,
      });
      this._cancelOperationButton.connect('clicked', () => {
        this._exportCancellable?.cancel();
        this._autoFocusCancellable?.cancel();
        this._workspaceCancellable?.cancel();
      });

      const endControls = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 4,
      });
      endControls.append(this._shareButton);
      endControls.append(this._exportButton);
      endControls.append(this._saveButton);
      endControls.append(this._cancelOperationButton);
      header.pack_end(endControls);
      return header;
    }

    _buildPreview() {
      this._previewStage = new Gtk.Overlay({
        css_classes: ['share-preview-stage'],
        hexpand: true,
        vexpand: true,
      });
      this._preview = new Gtk.DrawingArea({
        accessible_role: Gtk.AccessibleRole.IMG,
        content_height: 440,
        content_width: 720,
        hexpand: true,
        vexpand: true,
      });
      this._preview.set_tooltip_text('Preview of the edited video on the share canvas');
      this._preview.connect('resize', (_area, width, height) =>
        this._updatePreviewLayout(width, height),
      );
      this._previewStage.set_child(this._preview);

      this._canvasBackground = new Gtk.DrawingArea();
      this._canvasBackground.set_draw_func((_area, cr, width, height) => {
        if (!this._sourceWidth || !this._sourceHeight) return;
        paintShareVideoBackdrop(
          cr,
          this._sourceWidth,
          this._sourceHeight,
          width,
          height,
          this._shareSettings,
        );
      });

      this._composedCanvas = new Gtk.Overlay();
      this._composedCanvas.set_child(this._canvasBackground);

      this._videoFrame = new Gtk.Frame({
        css_classes: ['video-share-preview-frame'],
        halign: Gtk.Align.FILL,
        hexpand: true,
        valign: Gtk.Align.FILL,
        vexpand: true,
      });
      this._videoFrame.set_overflow(Gtk.Overflow.HIDDEN);
      this._videoViewport = new Gtk.Fixed({
        hexpand: true,
        vexpand: true,
      });
      this._videoViewport.set_overflow(Gtk.Overflow.HIDDEN);
      this._video = new VideoEffectPicture({
        can_shrink: true,
        content_fit: Gtk.ContentFit.CONTAIN,
        focusable: true,
        paintable: this._media,
      });
      this._video.update_property(
        [Gtk.AccessibleProperty.LABEL],
        [
          'Video editing preview. Select and drag a blur region to move it. Drag its handles or use Shift and arrow keys to resize it.',
        ],
      );
      this._video.set_tooltip_text(
        'Drag a blur region to move it; drag its handles to resize. Arrow keys move; Shift+Arrow resizes.',
      );
      this._installMaskControllers();
      this._videoViewport.put(this._video, 0, 0);
      this._videoFrame.set_child(this._videoViewport);
      this._composedCanvas.add_overlay(this._videoFrame);

      this._captionPreview = new Gtk.Label({
        css_classes: ['video-caption-preview'],
        halign: Gtk.Align.CENTER,
        margin_bottom: 44,
        valign: Gtk.Align.END,
        visible: false,
      });
      this._composedCanvas.add_overlay(this._captionPreview);

      this._canvasViewport = new Gtk.Fixed({
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
      });
      this._canvasViewport.set_overflow(Gtk.Overflow.HIDDEN);
      this._canvasViewport.put(this._composedCanvas, 0, 0);
      this._previewStage.add_overlay(this._canvasViewport);
      return this._previewStage;
    }

    _installMaskControllers() {
      const click = new Gtk.GestureClick({ button: Gdk.BUTTON_PRIMARY });
      click.connect('pressed', (_gesture, _presses, x, y) => this._maskPressed(x, y));
      this._video.add_controller(click);

      const drag = new Gtk.GestureDrag({ button: Gdk.BUTTON_PRIMARY });
      drag.connect('drag-begin', (_gesture, x, y) => this._maskDragBegin(x, y));
      drag.connect('drag-update', (_gesture, dx, dy) => this._maskDragUpdate(dx, dy));
      drag.connect('drag-end', (_gesture, dx, dy) => this._maskDragEnd(dx, dy));
      drag.connect('cancel', () => this._maskDragEnd());
      this._video.add_controller(drag);

      const motion = new Gtk.EventControllerMotion();
      motion.connect('motion', (_controller, x, y) => this._updateMaskCursor(x, y));
      motion.connect('leave', () => this._video.set_cursor_from_name('default'));
      this._video.add_controller(motion);

      const keys = new Gtk.EventControllerKey();
      keys.connect('key-pressed', (_controller, keyval, _keycode, state) =>
        this._maskKeyPressed(keyval, state),
      );
      this._video.add_controller(keys);
    }

    _activeMasks() {
      return this._edit.masks.filter(
        (mask) => this._timestampUs >= mask.startUs && this._timestampUs <= mask.endUs,
      );
    }

    _maskInteractionAt(x, y) {
      const width = Math.max(1, this._video.get_width());
      const height = Math.max(1, this._video.get_height());
      const pointX = x / width;
      const pointY = y / height;
      const activeMasks = this._activeMasks();
      const selected = activeMasks.find(
        (mask) => this._selectedEffect.kind === 'mask' && mask.id === this._selectedEffect.id,
      );
      const selectedHandle = selected
        ? videoMaskHandleAt(selected, pointX, pointY, width, height, BLUR_HANDLE_HIT_RADIUS)
        : null;
      if (selectedHandle) return { handle: selectedHandle, mask: selected };
      if (selected && videoMaskContainsPoint(selected, pointX, pointY))
        return { handle: null, mask: selected };

      for (const mask of [...activeMasks].reverse()) {
        if (videoMaskContainsPoint(mask, pointX, pointY)) return { handle: null, mask };
      }
      return null;
    }

    _maskPressed(x, y) {
      if (this._busy) return;
      const interaction = this._maskInteractionAt(x, y);
      if (!interaction) return;
      this._media?.pause();
      this._video.grab_focus();
      this._selectEffect('mask', interaction.mask.id);
    }

    _maskDragBegin(x, y) {
      if (this._busy) return;
      const interaction = this._maskInteractionAt(x, y);
      if (!interaction) return;
      this._media?.pause();
      this._video.grab_focus();
      this._selectEffect('mask', interaction.mask.id);
      this._maskDragState = {
        handle: interaction.handle,
        height: Math.max(1, this._video.get_height()),
        id: interaction.mask.id,
        original: { ...interaction.mask },
        width: Math.max(1, this._video.get_width()),
      };
    }

    _maskDragUpdate(dx, dy) {
      const state = this._maskDragState;
      if (!state) return;
      const offsetX = (Number(dx) || 0) / state.width;
      const offsetY = (Number(dy) || 0) / state.height;
      const mask = state.handle
        ? resizeVideoMask(state.original, state.handle, offsetX, offsetY)
        : moveVideoMask(state.original, offsetX, offsetY);
      this._maskInteractionUpdates?.queue({ id: state.id, mask });
    }

    _maskDragEnd(dx, dy) {
      if (!this._maskDragState) return;
      if (Number.isFinite(dx) && Number.isFinite(dy)) this._maskDragUpdate(dx, dy);
      this._maskInteractionUpdates?.flush();
      this._maskDragState = null;
    }

    _updateMaskCursor(x, y) {
      if (this._busy) {
        this._video.set_cursor_from_name('default');
        return;
      }
      const interaction = this._maskInteractionAt(x, y);
      const cursor = interaction?.handle
        ? BLUR_HANDLE_CURSORS[interaction.handle]
        : interaction
          ? 'move'
          : 'default';
      this._video.set_cursor_from_name(cursor);
    }

    _maskKeyPressed(keyval, state) {
      if (this._busy) return false;
      const mask = this._activeMasks().find(
        (candidate) =>
          this._selectedEffect.kind === 'mask' && candidate.id === this._selectedEffect.id,
      );
      if (!mask) return false;
      const shift = (state & Gdk.ModifierType.SHIFT_MASK) !== 0;
      let updated = null;
      if (shift && keyval === Gdk.KEY_Left)
        updated = resizeVideoMask(mask, 'e', -BLUR_KEYBOARD_STEP, 0);
      else if (shift && keyval === Gdk.KEY_Right)
        updated = resizeVideoMask(mask, 'e', BLUR_KEYBOARD_STEP, 0);
      else if (shift && keyval === Gdk.KEY_Up)
        updated = resizeVideoMask(mask, 's', 0, -BLUR_KEYBOARD_STEP);
      else if (shift && keyval === Gdk.KEY_Down)
        updated = resizeVideoMask(mask, 's', 0, BLUR_KEYBOARD_STEP);
      else if (keyval === Gdk.KEY_Left) updated = moveVideoMask(mask, -BLUR_KEYBOARD_STEP, 0);
      else if (keyval === Gdk.KEY_Right) updated = moveVideoMask(mask, BLUR_KEYBOARD_STEP, 0);
      else if (keyval === Gdk.KEY_Up) updated = moveVideoMask(mask, 0, -BLUR_KEYBOARD_STEP);
      else if (keyval === Gdk.KEY_Down) updated = moveVideoMask(mask, 0, BLUR_KEYBOARD_STEP);
      if (!updated) return false;
      this._media?.pause();
      this._applyMaskInteraction({ id: mask.id, mask: updated });
      return true;
    }

    _applyMaskInteraction(request) {
      if (!request?.id || !request.mask) return;
      const masks = this._edit.masks.map((mask) => (mask.id === request.id ? request.mask : mask));
      this._setEdit({ masks }, false);
      this._timeline.setTimeline(this._durationUs, this._edit, this._timestampUs);
      this._updatePreviewTransform();
    }

    _buildTimelinePanel() {
      const panel = new Gtk.Box({
        css_classes: ['video-timeline-panel'],
        orientation: Gtk.Orientation.VERTICAL,
      });
      const tools = new Gtk.Box({
        css_classes: ['video-timeline-toolbar'],
        margin_bottom: 7,
        margin_end: 14,
        margin_start: 14,
        margin_top: 8,
        spacing: 8,
      });
      this._playButton = new Gtk.Button({
        icon_name: 'media-playback-start-symbolic',
        sensitive: false,
        tooltip_text: 'Play or pause selection (Space)',
      });
      this._playButton.connect('clicked', () => this._togglePlayback());
      tools.append(this._playButton);
      this._timeLabel = new Gtk.Label({
        css_classes: ['caption', 'numeric'],
        label: '0:00.0 / 0:00.0',
        width_chars: 19,
        xalign: 0,
      });
      tools.append(this._timeLabel);

      const separator = () => new Gtk.Separator({ orientation: Gtk.Orientation.VERTICAL });
      tools.append(separator());
      tools.append(
        smallAction('zoom-in-symbolic', 'Add Zoom', () => this._addZoom(this._timestampUs)),
      );
      this._autoFocusButton = smallAction('zoom-fit-best-symbolic', 'Auto Focus', () =>
        this._runAutoFocus(),
      );
      this._autoFocusButton.set_tooltip_text(
        'Find typing in the selected video range and focus its input fields',
      );
      tools.append(this._autoFocusButton);
      tools.append(
        smallAction('insert-text-symbolic', 'Add Caption', () =>
          this._addCaption(this._timestampUs),
        ),
      );
      tools.append(
        smallAction('view-reveal-symbolic', 'Add Blur', () => this._addMask(this._timestampUs)),
      );
      tools.append(separator());

      tools.append(new Gtk.Label({ label: 'Speed' }));
      this._speedDropDown = Gtk.DropDown.new_from_strings(
        VIDEO_SPEED_VALUES.map((speed) => `${speed}×`),
      );
      this._speedDropDown.set_selected(VIDEO_SPEED_VALUES.indexOf(1));
      this._speedDropDown.set_tooltip_text('Change exported video and audio speed (S)');
      this._speedDropDown.connect('notify::selected', () => this._changeSpeed());
      tools.append(this._speedDropDown);

      tools.append(new Gtk.Label({ label: 'Audio' }));
      this._muteButton = new Gtk.ToggleButton({
        icon_name: 'audio-volume-high-symbolic',
        tooltip_text: 'Mute or restore the audio channel',
      });
      this._muteButton.connect('toggled', () => this._changeMuted());
      tools.append(this._muteButton);
      const volume = labelledScale('', 0, 200, 5, 100, (value) => this._changeVolume(value));
      this._volumeScale = volume.scale;
      volume.box.set_size_request(128, -1);
      tools.append(volume.box);

      this._deleteEffectButton = new Gtk.Button({
        icon_name: 'user-trash-symbolic',
        sensitive: false,
        tooltip_text: 'Delete selected timeline effect (Delete)',
      });
      this._deleteEffectButton.connect('clicked', () => this._deleteSelectedEffect());
      tools.append(this._deleteEffectButton);
      tools.append(smallAction('edit-undo-symbolic', 'Reset Timeline', () => this._resetEdits()));
      panel.append(tools);

      this._timeline = new VideoTimeline();
      this._timeline.connect('seek-requested', (_timeline, timestampUs) =>
        this._timelineInteractionUpdates.queue({ timestampUs, type: 'seek' }),
      );
      this._timeline.connect('trim-requested', (_timeline, startUs, endUs) =>
        this._timelineInteractionUpdates.queue({ endUs, startUs, type: 'trim' }),
      );
      this._timeline.connect('segment-resize-requested', (_timeline, kind, id, edge, timestampUs) =>
        this._timelineInteractionUpdates.queue({
          edge,
          id,
          kind,
          timestampUs,
          type: 'segment-resize',
        }),
      );
      this._timeline.connect('lane-activated', (_timeline, lane, timestampUs) =>
        this._activateLane(lane, timestampUs),
      );
      this._timeline.connect('segment-selected', (_timeline, kind, id) =>
        this._selectEffect(kind, id),
      );
      const scroller = new Gtk.ScrolledWindow({
        child: this._timeline,
        hscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
        vscrollbar_policy: Gtk.PolicyType.NEVER,
      });
      panel.append(scroller);
      return panel;
    }

    _connectMedia() {
      if (!this._media) return;
      this._mediaSignalIds = [
        this._media.connect('notify::prepared', () => this._loadMediaDetails()),
        this._media.connect('notify::duration', () => this._loadMediaDetails()),
        this._media.connect('notify::timestamp', () => this._playbackUpdates.queue(null)),
        this._media.connect('notify::playing', () => this._playbackUpdates.queue(null)),
        this._media.connect('notify::seeking', () => this._playbackUpdates.queue(null)),
        this._media.connect('notify::error', () => {
          const error = this._media?.get_error();
          if (error) this._showError('Could Not Load Video', error.message);
        }),
      ];
      this._loadMediaDetails();
    }

    _applyTimelineInteraction(request) {
      if (this._disposed || !request) return;
      if (request.type === 'trim') this._changeTrim(request.startUs, request.endUs);
      else if (request.type === 'segment-resize')
        this._resizeTimelineSegment(request.kind, request.id, request.edge, request.timestampUs);
      else this._seek(request.timestampUs);
    }

    async _loadWorkspace() {
      const cancellable = new Gio.Cancellable();
      this._workspaceCancellable = cancellable;
      this._setBusy(true, null, 'Cancel Open');
      try {
        const loaded =
          this._workspaceLoad ??
          (await readWorkspace(this._workspaceInputPath, {
            cancellable,
          }));
        this._workspaceLoad = null;
        if (loaded.workspace.kind !== 'video')
          throw new Error('This Bolas workspace is not a video project.');

        const videoPath = await materializeVideoWorkspaceSource(loaded.workspace, {
          cancellable,
        });
        if (this._disposed || this._workspaceCancellable !== cancellable) {
          removeMaterializedVideoWorkspaceSource(videoPath);
          return;
        }

        this._materializedVideoPath = videoPath;
        this._videoPath = videoPath;
        this._workspacePath = isManagedWorkspacePath(loaded.path) ? loaded.path : null;
        this._workspaceEtag = this._workspacePath ? loaded.etag : null;
        this._workspaceSourceMetadata = {
          displayName: loaded.workspace.source.displayName,
          originalMimeType: loaded.workspace.source.originalMimeType,
        };
        this._pendingWorkspace = loaded.workspace;
        this._autoFocusStarted = true;
        this._media = Gtk.MediaFile.new_for_file(Gio.File.new_for_path(videoPath));
        this._video.set_paintable(this._media);
        this._connectMedia();
      } catch (error) {
        this._workspaceLoad = null;
        if (!isCancellation(error)) this._showError('Could Not Open Video Project', error.message);
      } finally {
        if (this._workspaceCancellable === cancellable) {
          this._workspaceCancellable = null;
          this._setBusy(false);
        }
      }
    }

    _installKeyboardShortcuts() {
      const controller = new Gtk.EventControllerKey();
      controller.connect('key-pressed', (_controller, keyval, _keycode, state) => {
        if (this._exportDialog) return false;
        const control = (state & Gdk.ModifierType.CONTROL_MASK) !== 0;
        const shift = (state & Gdk.ModifierType.SHIFT_MASK) !== 0;
        if (keyval === Gdk.KEY_Escape) {
          if (this._exportCancellable) this._exportCancellable.cancel();
          else if (this._autoFocusCancellable) this._autoFocusCancellable.cancel();
          else if (this._workspaceCancellable) this._workspaceCancellable.cancel();
          else this.requestBack();
          return true;
        }
        if (control && shift && (keyval === Gdk.KEY_e || keyval === Gdk.KEY_E)) {
          this._export();
          return true;
        }
        if (control && (keyval === Gdk.KEY_s || keyval === Gdk.KEY_S)) {
          this._saveWorkspace();
          return true;
        }
        if (keyval === Gdk.KEY_space) {
          this._togglePlayback();
          return true;
        }
        if (keyval === Gdk.KEY_z || keyval === Gdk.KEY_Z) {
          this._addZoom(this._timestampUs);
          return true;
        }
        if (keyval === Gdk.KEY_s || keyval === Gdk.KEY_S) {
          this._cycleSpeed();
          return true;
        }
        if (keyval === Gdk.KEY_t || keyval === Gdk.KEY_T) {
          this._addCaption(this._timestampUs);
          return true;
        }
        if (keyval === Gdk.KEY_m || keyval === Gdk.KEY_M) {
          this._addMask(this._timestampUs);
          return true;
        }
        if (keyval === Gdk.KEY_Delete) {
          this._deleteSelectedEffect();
          return true;
        }
        return false;
      });
      this.add_controller(controller);
    }

    _loadMediaDetails() {
      if (!this._media?.is_prepared()) return;
      const durationUs = Number(this._media.get_duration());
      if (!Number.isFinite(durationUs) || durationUs <= 0) return;

      const firstDuration = this._durationUs === 0;
      this._durationUs = durationUs;
      this._sourceWidth = Math.max(0, this._media.get_intrinsic_width());
      this._sourceHeight = Math.max(0, this._media.get_intrinsic_height());
      if (firstDuration && this._pendingWorkspace) {
        const workspace = this._pendingWorkspace;
        this._pendingWorkspace = null;
        Object.assign(this._shareSettings, workspace.edit.share);
        this._setEdit(workspace.edit, false);
        this._rebuildShareSidebar();
        this._timestampUs = Math.min(durationUs, workspace.session.timestampUs);
        this._savedEditKey = videoEditKey(this._edit, durationUs);
        this._seek(this._timestampUs, false);
      } else {
        this._setEdit(firstDuration ? { ...this._edit, trimEndUs: durationUs } : this._edit, false);
      }
      if (firstDuration) this._savedEditKey = videoEditKey(this._edit, durationUs);
      this._syncControls();
      if (firstDuration && !this._autoFocusStarted) {
        this._autoFocusStarted = true;
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
          if (!this._disposed) this._runAutoFocus(true);
          return GLib.SOURCE_REMOVE;
        });
      }
    }

    _setEdit(changes, sync = true) {
      const normalized = normalizeVideoEdit(
        { ...this._edit, ...changes, share: this._shareSettings, shareEnabled: true },
        this._durationUs,
      );
      Object.assign(this._shareSettings, normalized.share);
      normalized.share = this._shareSettings;
      this._edit = normalized;
      if (sync) this._syncControls();
    }

    _shareSettingsChanged() {
      if (this._syncingControls) return;
      this._setEdit({ share: this._shareSettings });
    }

    _changeTrim(startUs, endUs) {
      if (!this._durationUs || this._busy) return;
      this._setEdit({ trimEndUs: endUs, trimStartUs: startUs }, false);
      this._seek(this._edit.trimStartUs, false);
      this._syncControls();
    }

    _resizeTimelineSegment(kind, id, edge, timestampUs) {
      if (!this._durationUs || this._busy) return;
      this._media?.pause();
      const resized = resizeVideoTimelineBlock(
        this._edit,
        this._durationUs,
        kind,
        id,
        edge,
        timestampUs,
      );
      this._setEdit(resized, false);
      this._timeline.setTimeline(this._durationUs, this._edit, this._timestampUs);
      this._updateCaptionPreview();
      this._updatePreviewTransform();
      this._syncSensitivity();
    }

    _changeMuted() {
      if (this._syncingControls || !this._durationUs) return;
      this._setEdit({ muted: this._muteButton.get_active() });
    }

    _changeVolume(value) {
      if (this._syncingControls || !this._durationUs) return;
      this._setEdit({ audioVolume: value / 100 });
    }

    _changeSpeed() {
      if (this._syncingControls || !this._durationUs) return;
      const speed = VIDEO_SPEED_VALUES[this._speedDropDown.get_selected()] ?? 1;
      this._setEdit({ speed });
    }

    _cycleSpeed() {
      if (!this._durationUs || this._busy) return;
      const next = (this._speedDropDown.get_selected() + 1) % VIDEO_SPEED_VALUES.length;
      this._speedDropDown.set_selected(next);
    }

    _effectRange(atUs) {
      const startUs = Math.min(
        Math.max(this._edit.trimStartUs, Number(atUs) || this._edit.trimStartUs),
        Math.max(this._edit.trimStartUs, this._edit.trimEndUs - 200_000),
      );
      return {
        endUs: Math.min(this._edit.trimEndUs, startUs + DEFAULT_EFFECT_DURATION_US),
        startUs,
      };
    }

    _newEffectId(prefix) {
      return `${prefix}-${this._nextEffectId++}`;
    }

    async _runAutoFocus(automatic = false) {
      if (!this._durationUs || this._busy || this._disposed) return;
      this._media.pause();
      this._autoFocusCancellable = new Gio.Cancellable();
      this._setBusy(true, 'Finding active input fields…', 'Cancel Analysis');
      try {
        const detected = await analyzeVideoInputFocus({
          cancellable: this._autoFocusCancellable,
          endUs: this._edit.trimEndUs,
          sourcePath: this._videoPath,
          startUs: this._edit.trimStartUs,
        });
        if (this._disposed) return;
        const userSegments = this._edit.zoomSegments.filter(
          (segment) => segment.source !== 'input',
        );
        if (!detected.length) {
          if (userSegments.length !== this._edit.zoomSegments.length)
            this._setEdit({ zoomSegments: userSegments });
          if (!automatic) this._toast('No sustained typing activity was found.');
          return;
        }
        const generated = detected.map((segment) => ({
          ...segment,
          id: this._newEffectId('input-focus'),
          sourceFocusX: segment.focusX,
          sourceFocusY: segment.focusY,
        }));
        this._setEdit({ zoomSegments: [...userSegments, ...generated] });
        this._toast(
          generated.length === 1
            ? 'Focused one active input field.'
            : `Focused ${generated.length} active input fields.`,
        );
      } catch (error) {
        if (!isCancellation(error)) this._showError('Could Not Auto Focus Video', error.message);
      } finally {
        this._autoFocusCancellable = null;
        if (!this._disposed) this._setBusy(false);
      }
    }

    _addZoom(atUs) {
      if (!this._durationUs || this._busy) return;
      const segment = {
        ...this._effectRange(atUs),
        focusX: 0.5,
        focusY: 0.5,
        id: this._newEffectId('zoom'),
        mode: this._edit.zoomSegments.length % 2 === 0 ? 'auto' : 'manual',
        scale: 1.3,
        source: 'user',
      };
      this._setEdit({ zoomSegments: [...this._edit.zoomSegments, segment] });
      this._selectEffect('zoom', segment.id);
    }

    _editZoom(segment) {
      const controls = new Gtk.Box({
        margin_bottom: 8,
        margin_top: 8,
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 12,
      });
      const modeRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 });
      modeRow.append(new Gtk.Label({ label: 'Mode', xalign: 0 }));
      const mode = Gtk.DropDown.new_from_strings(['Center', 'Focus point']);
      mode.set_selected(segment.mode === 'manual' ? 1 : 0);
      modeRow.append(mode);
      controls.append(modeRow);
      const zoom = labelledScale('Zoom', 105, 300, 5, segment.scale * 100, () => {});
      controls.append(zoom.box);
      const duration = labelledScale(
        'Duration',
        0.2,
        Math.max(0.2, (this._edit.trimEndUs - segment.startUs) / 1_000_000),
        0.1,
        (segment.endUs - segment.startUs) / 1_000_000,
        () => {},
      );
      controls.append(duration.box);
      const focusX = labelledScale('Focus X', 0, 100, 5, segment.focusX * 100, () => {});
      controls.append(focusX.box);
      const focusY = labelledScale('Focus Y', 0, 100, 5, segment.focusY * 100, () => {});
      controls.append(focusY.box);
      const syncMode = () => {
        const manual = mode.get_selected() === 1;
        focusX.box.set_sensitive(manual);
        focusY.box.set_sensitive(manual);
      };
      mode.connect('notify::selected', syncMode);
      syncMode();
      this._prompt('Edit Zoom', controls, 'Apply', () => {
        const updated = {
          ...segment,
          focusX: focusX.scale.get_value() / 100,
          focusY: focusY.scale.get_value() / 100,
          mode: mode.get_selected() === 1 ? 'manual' : 'auto',
          scale: zoom.scale.get_value() / 100,
          source: 'user',
          endUs: Math.min(
            this._edit.trimEndUs,
            segment.startUs + Math.round(duration.scale.get_value() * 1_000_000),
          ),
        };
        this._setEdit({
          zoomSegments: this._edit.zoomSegments.map((item) =>
            item.id === segment.id ? updated : item,
          ),
        });
        return true;
      });
    }

    _addCaption(atUs) {
      if (!this._durationUs || this._busy) return;
      const range = this._effectRange(atUs);
      const controls = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 10 });
      const entry = new Gtk.Entry({
        activates_default: true,
        placeholder_text: 'Caption text',
      });
      entry.update_property([Gtk.AccessibleProperty.LABEL], ['Caption text']);
      controls.append(entry);
      const duration = labelledScale(
        'Duration',
        0.2,
        Math.max(0.2, (this._edit.trimEndUs - range.startUs) / 1_000_000),
        0.1,
        (range.endUs - range.startUs) / 1_000_000,
        () => {},
      );
      controls.append(duration.box);
      this._prompt('Add Caption', controls, 'Add', () => {
        const value = entry.get_text().trim();
        if (!value) return false;
        const segment = {
          ...range,
          endUs: Math.min(
            this._edit.trimEndUs,
            range.startUs + Math.round(duration.scale.get_value() * 1_000_000),
          ),
          id: this._newEffectId('caption'),
          text: value,
        };
        this._setEdit({ captions: [...this._edit.captions, segment] });
        this._selectEffect('text', segment.id);
        return true;
      });
    }

    _editCaption(segment) {
      const controls = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 10 });
      const entry = new Gtk.Entry({ activates_default: true, text: segment.text });
      entry.update_property([Gtk.AccessibleProperty.LABEL], ['Caption text']);
      controls.append(entry);
      const duration = labelledScale(
        'Duration',
        0.2,
        Math.max(0.2, (this._edit.trimEndUs - segment.startUs) / 1_000_000),
        0.1,
        (segment.endUs - segment.startUs) / 1_000_000,
        () => {},
      );
      controls.append(duration.box);
      this._prompt('Edit Caption', controls, 'Apply', () => {
        const value = entry.get_text().trim();
        if (!value) return false;
        this._setEdit({
          captions: this._edit.captions.map((item) =>
            item.id === segment.id
              ? {
                  ...item,
                  endUs: Math.min(
                    this._edit.trimEndUs,
                    segment.startUs + Math.round(duration.scale.get_value() * 1_000_000),
                  ),
                  text: value,
                }
              : item,
          ),
        });
        return true;
      });
    }

    _addMask(atUs) {
      if (!this._durationUs || this._busy) return;
      const segment = {
        ...this._effectRange(atUs),
        blur: 18,
        height: 0.35,
        id: this._newEffectId('mask'),
        width: 0.35,
        x: 0.325,
        y: 0.325,
      };
      this._setEdit({ masks: [...this._edit.masks, segment] });
      this._selectEffect('mask', segment.id);
    }

    _editMask(segment) {
      const controls = new Gtk.Box({
        margin_bottom: 8,
        margin_top: 8,
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 10,
      });
      const blur = labelledScale('Blur', 4, 64, 2, segment.blur, () => {});
      const duration = labelledScale(
        'Duration',
        0.2,
        Math.max(0.2, (this._edit.trimEndUs - segment.startUs) / 1_000_000),
        0.1,
        (segment.endUs - segment.startUs) / 1_000_000,
        () => {},
      );
      const x = labelledScale('Left', 0, 95, 5, segment.x * 100, () => {});
      const y = labelledScale('Top', 0, 95, 5, segment.y * 100, () => {});
      const width = labelledScale('Width', 5, 100, 5, segment.width * 100, () => {});
      const height = labelledScale('Height', 5, 100, 5, segment.height * 100, () => {});
      for (const row of [blur, duration, x, y, width, height]) controls.append(row.box);
      this._prompt('Edit Blur Region', controls, 'Apply', () => {
        const updated = {
          ...segment,
          blur: blur.scale.get_value(),
          endUs: Math.min(
            this._edit.trimEndUs,
            segment.startUs + Math.round(duration.scale.get_value() * 1_000_000),
          ),
          height: height.scale.get_value() / 100,
          width: width.scale.get_value() / 100,
          x: x.scale.get_value() / 100,
          y: y.scale.get_value() / 100,
        };
        this._setEdit({
          masks: this._edit.masks.map((item) => (item.id === segment.id ? updated : item)),
        });
        return true;
      });
    }

    _effectAt(lane, timestampUs) {
      const collection =
        lane === 'zoom'
          ? this._edit.zoomSegments
          : lane === 'text'
            ? this._edit.captions
            : lane === 'mask'
              ? this._edit.masks
              : [];
      return collection.find((item) => timestampUs >= item.startUs && timestampUs <= item.endUs);
    }

    _activateLane(lane, timestampUs) {
      if (lane === 'audio') this._muteButton.set_active(!this._muteButton.get_active());
      else if (lane === 'zoom') {
        const segment = this._effectAt(lane, timestampUs);
        if (segment) this._editZoom(segment);
        else this._addZoom(timestampUs);
      } else if (lane === 'speed') this._cycleSpeed();
      else if (lane === 'text') {
        const segment = this._effectAt(lane, timestampUs);
        if (segment) this._editCaption(segment);
        else this._addCaption(timestampUs);
      } else if (lane === 'mask') {
        const segment = this._effectAt(lane, timestampUs);
        if (segment) this._editMask(segment);
        else this._addMask(timestampUs);
      }
    }

    _selectEffect(kind = '', id = '') {
      this._selectedEffect = { id, kind };
      this._timeline.setSelected(kind, id);
      this._video?.setSelectedBlurRegion(kind === 'mask' ? id : '');
      this._deleteEffectButton.set_sensitive(
        Boolean(id) && ['zoom', 'text', 'mask'].includes(kind) && !this._busy,
      );
    }

    _deleteSelectedEffect() {
      const { id, kind } = this._selectedEffect;
      if (!id || !['zoom', 'text', 'mask'].includes(kind) || this._busy) return;
      if (kind === 'zoom')
        this._setEdit({ zoomSegments: this._edit.zoomSegments.filter((item) => item.id !== id) });
      else if (kind === 'text')
        this._setEdit({ captions: this._edit.captions.filter((item) => item.id !== id) });
      else if (kind === 'mask')
        this._setEdit({ masks: this._edit.masks.filter((item) => item.id !== id) });
      this._selectEffect();
    }

    _resetEdits() {
      if (!this._durationUs || this._busy) return;
      this._media.pause();
      this._setEdit({
        audioVolume: 1,
        captions: [],
        masks: [],
        muted: false,
        speed: 1,
        trimEndUs: this._durationUs,
        trimStartUs: 0,
        zoomSegments: [],
      });
      this._selectEffect();
      this._seek(0);
    }

    _syncControls() {
      if (!this._durationUs) return;
      this._syncingControls = true;
      this._muteButton.set_active(this._edit.muted);
      this._muteButton.set_icon_name(
        this._edit.muted ? 'audio-volume-muted-symbolic' : 'audio-volume-high-symbolic',
      );
      this._volumeScale.set_value(this._edit.audioVolume * 100);
      this._speedDropDown.set_selected(VIDEO_SPEED_VALUES.indexOf(this._edit.speed));
      this._media.set_muted(this._edit.muted);
      this._media.set_volume(this._edit.audioVolume);
      this._syncingControls = false;

      this._timeline.setTimeline(this._durationUs, this._edit, this._timestampUs);
      this._updateTimeLabel();
      this._updateCaptionPreview();
      const previewKey = sharePreviewKey(
        this._sourceWidth,
        this._sourceHeight,
        this._shareSettings,
      );
      if (previewKey !== this._lastSharePreviewKey) {
        this._lastSharePreviewKey = previewKey;
        this._canvasBackground.queue_draw();
        this._updatePreviewLayout(this._preview.get_width(), this._preview.get_height());
      } else {
        this._updatePreviewTransform();
      }
      this._syncSensitivity();
    }

    _syncSensitivity() {
      const ready = this._durationUs > 0 && !this._busy;
      this._playButton.set_sensitive(ready);
      this._muteButton.set_sensitive(ready && Boolean(this._media?.has_audio));
      this._volumeScale.set_sensitive(ready && Boolean(this._media?.has_audio));
      this._speedDropDown.set_sensitive(ready);
      this._autoFocusButton.set_sensitive(ready);
      this._saveButton.set_label(this._workspaceSavePending ? 'Saving' : 'Save');
      this._saveButton.set_sensitive(ready && this._sourceWidth > 0 && this._sourceHeight > 0);
      this._exportButton.set_sensitive(ready);
      this._shareButton.set_sensitive(ready);
      this._deleteEffectButton.set_sensitive(
        ready &&
          Boolean(this._selectedEffect.id) &&
          ['zoom', 'text', 'mask'].includes(this._selectedEffect.kind),
      );
      this._cancelOperationButton.set_visible(
        this._busy && !this._workspaceSavePending && !this._exportDialog,
      );
      this._cancelOperationButton.set_sensitive(
        Boolean(
          this._exportCancellable || this._autoFocusCancellable || this._workspaceCancellable,
        ),
      );
    }

    _updatePreviewLayout(width, height) {
      if (!this._sourceWidth || !this._sourceHeight || width <= 0 || height <= 0) return;
      const canvas = sharePreviewCanvasLayout(width, height, this._shareSettings.ratioId);
      const canvasWidth = Math.max(2, Math.round(canvas.width));
      const canvasHeight = Math.max(2, Math.round(canvas.height));
      const layout = shareImageLayout(
        this._sourceWidth,
        this._sourceHeight,
        canvasWidth,
        canvasHeight,
        this._shareSettings,
      );
      const radiusClass =
        layout.radius <= 1
          ? 'video-radius-flat'
          : layout.radius <= 8
            ? 'video-radius-small'
            : layout.radius <= 16
              ? 'video-radius-medium'
              : 'video-radius-large';
      if (radiusClass !== this._videoRadiusClass) {
        for (const cssClass of VIDEO_RADIUS_CLASSES) this._videoFrame.remove_css_class(cssClass);
        this._videoFrame.add_css_class(radiusClass);
        this._videoRadiusClass = radiusClass;
      }
      const horizontalInset = Math.max(0, Math.round(layout.x));
      const verticalInset = Math.max(0, Math.round(layout.y));
      const videoWidth = Math.max(2, canvasWidth - horizontalInset * 2);
      const videoHeight = Math.max(2, canvasHeight - verticalInset * 2);
      this._canvasViewport.set_size_request(canvasWidth, canvasHeight);
      this._composedCanvas.set_size_request(canvasWidth, canvasHeight);
      this._canvasBackground.set_size_request(canvasWidth, canvasHeight);
      this._videoFrame.set_margin_start(horizontalInset);
      this._videoFrame.set_margin_end(horizontalInset);
      this._videoFrame.set_margin_top(verticalInset);
      this._videoFrame.set_margin_bottom(verticalInset);
      this._videoViewport.set_size_request(videoWidth, videoHeight);
      this._video.set_size_request(videoWidth, videoHeight);

      this._previewCanvasWidth = canvasWidth;
      this._previewCanvasHeight = canvasHeight;
      this._previewVideoWidth = videoWidth;
      this._previewVideoHeight = videoHeight;
      this._lastVideoTransformKey = '';
      this._updatePreviewTransform();
    }

    _updatePreviewTransform() {
      const videoWidth = this._previewVideoWidth;
      const videoHeight = this._previewVideoHeight;
      if (!videoWidth || !videoHeight) return;
      const activeMasks = this._edit.masks.filter(
        (mask) => this._timestampUs >= mask.startUs && this._timestampUs <= mask.endUs,
      );
      this._video.setBlurRegions(activeMasks);
      this._video.setSelectedBlurRegion(
        this._selectedEffect.kind === 'mask' ? this._selectedEffect.id : '',
      );
      const videoTransform = videoSourceTransformAt(
        this._edit,
        this._durationUs,
        this._timestampUs,
        videoWidth,
        videoHeight,
      );
      const transformKey = `${videoTransform.x}:${videoTransform.y}:${videoTransform.scale}`;
      if (transformKey === this._lastVideoTransformKey) return;
      this._lastVideoTransformKey = transformKey;
      const transform = Gsk.Transform.new()
        .translate(new Graphene.Point({ x: videoTransform.x, y: videoTransform.y }))
        .scale(videoTransform.scale, videoTransform.scale);
      this._videoViewport
        .get_layout_manager()
        .get_layout_child(this._video)
        .set_transform(transform);
    }

    _seek(timestampUs, sync = true) {
      if (!this._durationUs || !this._media) return;
      const timestamp = Math.min(this._durationUs, Math.max(0, Number(timestampUs) || 0));
      if (this._media.get_playing()) this._media.pause();
      this._requestedSeekUs = timestamp;
      this._media.seek(timestamp);
      if (sync) this._presentTimestamp(timestamp);
    }

    _togglePlayback() {
      if (!this._durationUs || this._busy) return;
      this._timelineInteractionUpdates?.flush();
      if (this._media.get_playing()) {
        this._media.pause();
        return;
      }
      if (
        this._timestampUs < this._edit.trimStartUs ||
        this._timestampUs >= this._edit.trimEndUs - 50_000
      ) {
        this._seek(this._edit.trimStartUs);
      }
      this._media.play();
    }

    _playbackChanged() {
      if (!this._media || !this._durationUs) return;
      const playing = this._media.get_playing();
      const iconName = playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
      if (iconName !== this._playButtonIcon) {
        this._playButton.set_icon_name(iconName);
        this._playButtonIcon = iconName;
      }
      if (playing) {
        this._startPlaybackFrames();
        return;
      }

      this._stopPlaybackFrames();
      const seeking = this._media.is_seeking();
      const timestamp =
        seeking && this._requestedSeekUs !== null
          ? this._requestedSeekUs
          : Number(this._media.get_timestamp()) || 0;
      if (!seeking) this._requestedSeekUs = null;
      this._presentTimestamp(timestamp);
    }

    _startPlaybackFrames() {
      if (this._playbackFrameId !== null) return;
      this._playbackClock.reset();
      this._playbackFrameId = this.add_tick_callback((_widget, frameClock) => {
        if (this._disposed || !this._media?.get_playing()) {
          this._playbackFrameId = null;
          this._playbackClock.reset();
          return GLib.SOURCE_REMOVE;
        }

        const seeking = this._media.is_seeking();
        if (!seeking) this._requestedSeekUs = null;
        const timestamp = this._playbackClock.sample({
          frameTimeUs: frameClock.get_frame_time(),
          mediaTimestampUs: this._media.get_timestamp(),
          playing: true,
          requestedTimestampUs: this._requestedSeekUs,
          seeking,
        });

        if (timestamp >= this._edit.trimEndUs - 50_000) {
          this._media.pause();
          this._requestedSeekUs = this._edit.trimStartUs;
          this._media.seek(this._edit.trimStartUs);
          this._presentTimestamp(this._edit.trimStartUs);
          this._playbackFrameId = null;
          this._playbackClock.reset();
          return GLib.SOURCE_REMOVE;
        }

        this._presentTimestamp(timestamp);
        return GLib.SOURCE_CONTINUE;
      });
    }

    _stopPlaybackFrames() {
      if (this._playbackFrameId !== null) this.remove_tick_callback(this._playbackFrameId);
      this._playbackFrameId = null;
      this._playbackClock.reset();
    }

    _presentTimestamp(timestampUs) {
      this._timestampUs = Math.min(this._durationUs, Math.max(0, Number(timestampUs) || 0));
      this._timeline.setTimestamp(this._timestampUs);
      this._updateTimeLabel();
      this._updateCaptionPreview();
      this._updatePreviewTransform();
    }

    _updateTimeLabel() {
      const label = `${videoTimeLabel(this._timestampUs)} / ${videoTimeLabel(this._durationUs)}`;
      if (label === this._timeLabelText) return;
      this._timeLabelText = label;
      this._timeLabel?.set_label(label);
    }

    _updateCaptionPreview() {
      const caption = this._edit.captions.find(
        (item) => this._timestampUs >= item.startUs && this._timestampUs <= item.endUs,
      );
      const previewKey = caption ? `${caption.id}:${caption.text}` : '';
      if (previewKey === this._captionPreviewKey) return;
      this._captionPreviewKey = previewKey;
      this._captionPreview?.set_label(caption?.text ?? '');
      this._captionPreview?.set_visible(Boolean(caption));
    }

    _isDirty() {
      return (
        this._durationUs > 0 && videoEditKey(this._edit, this._durationUs) !== this._savedEditKey
      );
    }

    _setBusy(busy, label = 'Exporting video…', cancelLabel = 'Cancel Export') {
      this._busy = Boolean(busy);
      this._cancelOperationButton.set_label(cancelLabel);
      this._syncSensitivity();
      if (busy && label && !this._exportDialog) this._toast(label);
    }

    _exportOptions(targetPath) {
      return {
        cancellable: this._exportCancellable,
        durationUs: this._durationUs,
        edit: this._edit,
        sourceHeight: this._sourceHeight,
        sourcePath: this._videoPath,
        sourceWidth: this._sourceWidth,
        targetPath,
      };
    }

    async _saveWorkspace() {
      if (
        this._busy ||
        !this._durationUs ||
        !this._sourceWidth ||
        !this._sourceHeight ||
        !this._videoPath
      )
        return;

      const cancellable = new Gio.Cancellable();
      this._workspaceCancellable = cancellable;
      this._workspaceSavePending = true;
      this._media.pause();
      this._setBusy(true, null);
      try {
        const source = await loadVideoWorkspaceSource(this._videoPath, { cancellable });
        if (this._disposed || this._workspaceCancellable !== cancellable) return;
        const replaceExisting = Boolean(this._workspacePath);
        const displayName =
          this._workspaceSourceMetadata?.displayName ??
          source.displayName ??
          GLib.path_get_basename(this._videoPath);
        const path = managedWorkspaceSavePath(this._workspacePath, displayName);
        const workspace = createVideoWorkspace({
          edit: this._edit,
          session: { timestampUs: this._timestampUs },
          sourceBytes: source.bytes,
          sourceMetadata: {
            displayName,
            durationUs: this._durationUs,
            height: this._sourceHeight,
            originalMimeType: this._workspaceSourceMetadata?.originalMimeType ?? source.mimeType,
            width: this._sourceWidth,
          },
        });

        this._setBusy(true, 'Saving video workspace…');
        const saved = await writeWorkspace(path, workspace, {
          cancellable,
          etag: replaceExisting ? this._workspaceEtag : null,
          replaceExisting,
        });
        if (this._disposed || this._workspaceCancellable !== cancellable) return;
        this._workspacePath = saved.path;
        this._workspaceEtag = saved.etag;
        this._workspaceSourceMetadata = {
          displayName: workspace.source.displayName,
          originalMimeType: workspace.source.originalMimeType,
        };
        this._savedEditKey = videoEditKey(this._edit, this._durationUs);
        try {
          const thumbnailPath = await generateVideoThumbnail({
            cancellable,
            fileSize: source.fileSize,
            modifiedTime: source.modifiedTime,
            sourcePath: this._videoPath,
            timestampUs: videoWorkspaceCoverTimestampUs({
              durationUs: workspace.source.durationUs,
              timestampUs: workspace.session.timestampUs,
              trimEndUs: workspace.edit.trimEndUs,
              trimStartUs: workspace.edit.trimStartUs,
            }),
          });
          if (this._disposed || this._workspaceCancellable !== cancellable) return;
          writeWorkspacePreviewFromPng(saved.path, thumbnailPath);
        } catch (previewError) {
          try {
            removeWorkspacePreview(saved.path);
          } catch {
            // A missing cover must never invalidate the saved video workspace.
          }
          if (!isCancellation(previewError) && !isVideoThumbnailCancellation(previewError))
            logError(previewError, 'Failed to save Bolas video workspace cover');
        }
        if (!this._disposed) this._toast(`Saved ${GLib.path_get_basename(saved.path)} to Recents`);
      } catch (error) {
        if (!isCancellation(error)) this._showError('Could Not Save Video Project', error.message);
      } finally {
        this._workspaceSavePending = false;
        if (this._workspaceCancellable === cancellable) {
          this._workspaceCancellable = null;
          this._setBusy(false);
        }
      }
    }

    _export() {
      if (this._busy || !this._durationUs) return;
      if (this._exportDialog) {
        this._exportDialog.present();
        return;
      }
      this._media.pause();
      this._exportDialog = presentExportDialog({
        parent: this._hostWindow,
        kind: 'video',
        stem: `${outputStem(this._workspaceSourceMetadata?.displayName ?? this._videoPath)}-share`,
        onClosed: () => {
          this._exportDialog = null;
        },
        runExport: async (options) => {
          this._exportCancellable = options.cancellable;
          this._setBusy(true);
          try {
            return await exportEditedVideo({
              ...this._exportOptions(options.targetPath),
              ...options,
            });
          } finally {
            this._exportCancellable = null;
            if (!this._disposed) this._setBusy(false);
          }
        },
      });
    }

    async _share() {
      if (this._busy || !this._durationUs) return;
      this._media.pause();
      this._exportCancellable = new Gio.Cancellable();
      this._setBusy(true, 'Preparing share video…');
      try {
        const path = createManagedVideoPath(this._videoPath);
        await exportEditedVideo(this._exportOptions(path));
        await shareMedia(this._hostWindow, path);
      } catch (error) {
        if (!isCancellation(error)) this._showError('Could Not Share Video', error.message);
      } finally {
        this._exportCancellable = null;
        this._setBusy(false);
      }
    }

    _quiesceForNavigation() {
      this._exportDialog?.dispose();
      this._exportDialog = null;
      this._exportCancellable?.cancel();
      this._autoFocusCancellable?.cancel();
      this._workspaceCancellable?.cancel();
      this._media?.pause();
      this._timelineInteractionUpdates?.cancel();
      this._maskInteractionUpdates?.cancel();
      this._playbackUpdates?.cancel();
      this._stopPlaybackFrames();
    }

    _navigateBack() {
      this._quiesceForNavigation();
      // The live media, nested transforms, and Cairo backdrop are expensive to
      // composite through an outgoing navigation animation.
      this._hostWindow?.showHome({ animate: false });
    }

    _toast(message) {
      this._toastOverlay.add_toast(new Adw.Toast({ title: String(message ?? '') }));
    }

    _showError(heading, body) {
      const dialog = new Adw.AlertDialog({
        body: String(body || 'An unexpected error occurred.'),
        heading,
      });
      dialog.add_response('close', 'Close');
      dialog.set_close_response('close');
      dialog.set_default_response('close');
      dialog.present(this._hostWindow);
    }

    _prompt(heading, child, acceptLabel, onAccept) {
      const dialog = new Adw.AlertDialog({ heading });
      dialog.set_extra_child(child);
      dialog.add_response('cancel', 'Cancel');
      dialog.add_response('accept', acceptLabel);
      dialog.set_close_response('cancel');
      dialog.set_default_response('accept');
      dialog.set_response_appearance('accept', Adw.ResponseAppearance.SUGGESTED);
      dialog.choose(this._hostWindow, null, (_dialog, result) => {
        try {
          if (dialog.choose_finish(result) === 'accept' && onAccept() === false) {
            this._toast('Enter caption text first.');
          }
        } catch (_error) {
          // Closing the prompt is equivalent to cancelling it.
        }
      });
    }

    _choose(heading, body, acceptLabel) {
      return new Promise((resolve) => {
        const dialog = new Adw.AlertDialog({ body, heading });
        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('accept', acceptLabel);
        dialog.set_close_response('cancel');
        dialog.set_default_response('accept');
        dialog.set_response_appearance('accept', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.choose(this._hostWindow, null, (_dialog, result) => {
          try {
            resolve(dialog.choose_finish(result) === 'accept');
          } catch (_error) {
            resolve(false);
          }
        });
      });
    }

    async _confirmDiscard(onDiscard) {
      if (this._discardDialogOpen) return;
      this._discardDialogOpen = true;
      const discard = await this._choose(
        'Discard Video Project?',
        'The original video is unchanged, but timeline and share-canvas changes will be lost.',
        'Discard',
      );
      this._discardDialogOpen = false;
      if (discard) onDiscard?.();
    }
  },
);

export function presentVideoEditor(options = {}) {
  const host = options.parent;
  if (!host?.showWorkspace) throw new Error('The video editor requires the main Bolas window.');
  const view = new VideoEditorView(options);
  host.showWorkspace(view, view);
  return view;
}

import Gio from 'gi://Gio?version=2.0';
import System from 'system';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sourceText(pathParts) {
  let file = Gio.File.new_for_uri(import.meta.url)
    .get_parent()
    .get_parent();
  for (const part of pathParts) file = file.get_child(part);
  const [loaded, contents] = file.load_contents(null);
  assert(loaded, `${pathParts.join('/')} could not be read`);
  return new TextDecoder().decode(contents);
}

function cssRule(stylesheet, selector) {
  const marker = `${selector} {`;
  const start = stylesheet.indexOf(marker);
  assert(start >= 0, `${selector} is missing from the stylesheet`);
  const end = stylesheet.indexOf('}', start);
  assert(end > start, `${selector} has no closing brace`);
  return stylesheet.slice(start, end + 1);
}

try {
  const mainWindow = sourceText(['src', 'window.js']);
  const videoWindow = sourceText(['src', 'video', 'window.js']);
  const stylesheet = sourceText(['src', 'style.css']);
  const frameRule = cssRule(stylesheet, '.video-share-preview-frame');

  assert(
    videoWindow.includes('this._video = new VideoEffectPicture({'),
    'the video editor must display its managed media stream in the effect-aware picture',
  );
  assert(
    videoWindow.includes('content_fit: Gtk.ContentFit.CONTAIN'),
    'the video preview must preserve the original recording aspect ratio',
  );
  assert(
    videoWindow.includes('can_shrink: true'),
    'the video preview must shrink into the composed canvas allocation',
  );
  assert(
    videoWindow.includes('paintable: this._media'),
    'the video preview must use the editor-managed media stream',
  );
  assert(
    videoWindow.includes('this._videoFrame.set_margin_start(horizontalInset);') &&
      videoWindow.includes('this._videoFrame.set_margin_bottom(verticalInset);'),
    'the video preview must apply the calculated background padding as allocation margins',
  );
  assert(
    videoWindow.includes(
      'const canvas = sharePreviewCanvasLayout(width, height, this._shareSettings.ratioId);',
    ),
    'the composed video canvas must use the full preview allocation without an outer inset',
  );
  assert(
    !videoWindow.includes('this._videoFrame.set_size_request(') &&
      videoWindow.includes('this._videoViewport.set_size_request(videoWidth, videoHeight);') &&
      videoWindow.includes('this._video.set_size_request(videoWidth, videoHeight);'),
    'the video effect surface must match the fitted recording without sizing the outer canvas',
  );
  assert(
    !videoWindow.includes('this._video = new Gtk.Video({'),
    'the video editor must not embed the black-backed standalone player',
  );
  assert(
    !mainWindow.includes('_buildViewerView()') &&
      !mainWindow.includes("_stack.add_named(this._buildViewerView(), 'viewer')"),
    'the main window must not expose an intermediate media viewer',
  );
  assert(
    mainWindow.includes('this._onEdit?.(media.path, media.kind);'),
    'validated media must enter its matching editor directly',
  );
  assert(
    videoWindow.includes('this._hostWindow?.showHome({ animate: false });') &&
      !videoWindow.includes('this._hostWindow?.showViewer();'),
    'video editor Back must return directly to Home without animating the live preview',
  );
  assert(
    mainWindow.includes('showHome({ animate = true } = {})') &&
      mainWindow.includes('if (!animate) this._navigationView.set_animate_transitions(false);'),
    'the host must support a video-only non-animated programmatic pop',
  );
  assert(
    !videoWindow.includes('Cancel the current video operation before leaving.') &&
      videoWindow.includes('_quiesceForNavigation()') &&
      videoWindow.includes('this._autoFocusCancellable?.cancel();'),
    'Back must cancel active video work instead of refusing to leave the editor',
  );
  assert(
    videoWindow.includes("css_classes: ['share-sidebar-slot'],\n        hexpand: false,") &&
      videoWindow.includes('sidebar.set_propagate_natural_width(false);'),
    'the video settings sidebar must keep its fixed width while the preview expands',
  );
  assert(
    videoWindow.includes('this._timelineInteractionUpdates = this._createFrameCoalescer(') &&
      videoWindow.includes('this._playbackUpdates = this._createFrameCoalescer('),
    'timeline input and media notifications must coalesce against the GTK frame clock',
  );
  assert(
    videoWindow.includes('this._playbackFrameId = this.add_tick_callback(') &&
      videoWindow.includes('frameTimeUs: frameClock.get_frame_time()') &&
      !videoWindow.includes('this._video.queue_draw();'),
    'active playback must update timestamps without redundantly invalidating the media paintable',
  );
  assert(
    videoWindow.includes('this._timeline.setTimestamp(this._timestampUs);'),
    'playback must update only the timeline timestamp instead of rebuilding its edit model',
  );
  assert(
    videoWindow.includes('if (previewKey !== this._lastSharePreviewKey) {'),
    'timeline-only edits must reuse the existing share backdrop and preview layout',
  );
  assert(
    videoWindow.includes('this._video.setBlurRegions(activeMasks);') &&
      videoWindow.includes('.get_layout_child(this._video)') &&
      !videoWindow.includes(
        '.get_layout_child(this._composedCanvas)\n        .set_transform(transform);',
      ),
    'zoom and blur previews must target only the imported-video surface',
  );
  assert(
    videoWindow.includes('snapshot.push_clip(rect);') &&
      videoWindow.includes('snapshot.push_blur(region.blur);'),
    'blur previews must clip each region inside the imported video',
  );
  assert(
    videoWindow.includes('this._installMaskControllers();') &&
      videoWindow.includes("drag.connect('drag-update', (_gesture, dx, dy)") &&
      videoWindow.includes('moveVideoMask(state.original, offsetX, offsetY)') &&
      videoWindow.includes('resizeVideoMask(state.original, state.handle, offsetX, offsetY)'),
    'blur regions must support direct move and resize gestures on the video canvas',
  );
  assert(
    videoWindow.includes('for (const handle of videoMaskResizeHandles(region))') &&
      videoWindow.includes('snapshot.append_color(color, rect);') &&
      videoWindow.includes('this._video.set_cursor_from_name(cursor);'),
    'the selected blur region must draw resize handles and expose matching pointer cursors',
  );
  assert(
    videoWindow.includes('this._maskInteractionUpdates = this._createFrameCoalescer(') &&
      videoWindow.includes('this._maskInteractionUpdates?.queue({ id: state.id, mask });'),
    'rapid blur-region drags must coalesce against the GTK frame clock',
  );
  assert(
    videoWindow.includes('focusable: true,') &&
      videoWindow.includes('this._maskKeyPressed(keyval, state)') &&
      videoWindow.includes('Shift+Arrow resizes.'),
    'blur-region geometry must remain adjustable from the keyboard',
  );
  assert(
    videoWindow.includes(
      "this._saveButton = new Gtk.Button({\n        css_classes: ['suggested-action'],",
    ),
    'video Save must use the same suggested-action style as image Save',
  );
  assert(
    videoWindow.includes(
      'endControls.append(this._shareButton);\n      endControls.append(this._exportButton);\n      endControls.append(this._saveButton);',
    ),
    'video header actions must match the image editor Share, Export, Save order',
  );
  assert(
    videoWindow.includes('orientation: Gtk.Orientation.HORIZONTAL,\n        spacing: 4,'),
    'video header actions must use the image editor spacing',
  );
  assert(
    frameRule.includes('background-color: transparent;'),
    'the fitted video frame must not cover the composed background',
  );
  assert(frameRule.includes('border: none;'), 'the fitted video frame must not add a border');
  assert(
    frameRule.includes('box-shadow: none;'),
    'the fitted video frame must not duplicate the composed canvas shadow',
  );

  print('video opens directly in an editor with a transparent, padded preview');
  System.exit(0);
} catch (error) {
  printerr(error.stack ?? error.message);
  System.exit(1);
}

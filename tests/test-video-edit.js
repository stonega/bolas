import System from 'system';

import {
  hasVideoEdits,
  MIN_VIDEO_TRIM_DURATION_US,
  moveVideoMask,
  normalizeVideoEdit,
  resizeVideoMask,
  resizeVideoTimelineBlock,
  selectedVideoDurationUs,
  videoEditKey,
  videoMaskContainsPoint,
  videoMaskHandleAt,
  videoMaskResizeHandles,
  videoSourceTransformAt,
  videoTimeLabel,
  videoZoomAt,
} from '../src/video/edit.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const duration = 10_000_000;
  const untouched = normalizeVideoEdit({}, duration);
  assert(untouched.trimStartUs === 0, 'an untouched video must start at zero');
  assert(untouched.trimEndUs === duration, 'an untouched video must end at its duration');
  assert(!hasVideoEdits(untouched, duration), 'default video state must not be dirty');

  const trimmed = normalizeVideoEdit(
    { muted: true, trimEndUs: 8_500_000, trimStartUs: 1_250_000 },
    duration,
  );
  assert(trimmed.trimStartUs === 1_250_000, 'trim start changed unexpectedly');
  assert(trimmed.trimEndUs === 8_500_000, 'trim end changed unexpectedly');
  assert(trimmed.muted, 'mute state changed unexpectedly');
  assert(hasVideoEdits(trimmed, duration), 'trimmed video state must be dirty');

  const collapsed = normalizeVideoEdit({ trimEndUs: 1_000_001, trimStartUs: 1_000_000 }, duration);
  assert(
    collapsed.trimEndUs - collapsed.trimStartUs === MIN_VIDEO_TRIM_DURATION_US,
    'collapsed trim range must be expanded to the minimum duration',
  );
  assert(videoTimeLabel(3_723_400_000) === '1:02:03.4', 'hour timestamp label is incorrect');
  assert(videoTimeLabel(63_400_000) === '1:03.4', 'minute timestamp label is incorrect');
  assert(
    videoEditKey(trimmed, duration) === videoEditKey({ ...trimmed }, duration),
    'equivalent edits must have the same stable key',
  );

  const composed = normalizeVideoEdit(
    {
      audioVolume: 1.25,
      captions: [{ endUs: 4_000_000, startUs: 2_000_000, text: 'Focus here' }],
      masks: [{ endUs: 5_000_000, height: 0.25, startUs: 3_000_000, width: 0.3 }],
      shareEnabled: true,
      speed: 2,
      zoomSegments: [
        {
          confidence: 0.82,
          endUs: 3_000_000,
          focusX: 0.7,
          mode: 'manual',
          scale: 1.4,
          source: 'input',
          sourceFocusX: 0.68,
          sourceFocusY: 0.4,
          startUs: 1_000_000,
        },
      ],
    },
    duration,
  );
  assert(composed.zoomSegments.length === 1, 'zoom segments must be retained');
  assert(composed.zoomSegments[0].source === 'input', 'detected zoom origin must be retained');
  assert(
    composed.zoomSegments[0].sourceFocusX === 0.68 && composed.zoomSegments[0].sourceFocusY === 0.4,
    'detected source coordinates must survive normalization',
  );
  assert(composed.captions[0].text === 'Focus here', 'caption text changed unexpectedly');
  assert(composed.masks.length === 1, 'blur masks must be retained');
  assert(composed.audioVolume === 1.25, 'audio volume changed unexpectedly');
  assert(selectedVideoDurationUs(composed, duration) === 5_000_000, 'speed must retime output');
  assert(
    hasVideoEdits(composed, duration),
    'timeline and share settings must mark the project dirty',
  );

  const resizedClip = resizeVideoTimelineBlock(
    composed,
    duration,
    'audio',
    'audio',
    'start',
    1_500_000,
  );
  assert(
    resizedClip.trimStartUs === 1_500_000 && resizedClip.trimEndUs === duration,
    'video, audio, and speed blocks must resize the shared clip range',
  );
  const minimumClip = resizeVideoTimelineBlock(
    resizedClip,
    duration,
    'video',
    'video',
    'end',
    1_500_001,
  );
  assert(
    minimumClip.trimEndUs - minimumClip.trimStartUs === MIN_VIDEO_TRIM_DURATION_US,
    'clip block resizing must preserve the minimum trim duration',
  );
  const resizedZoom = resizeVideoTimelineBlock(
    composed,
    duration,
    'zoom',
    composed.zoomSegments[0].id,
    'end',
    4_500_000,
  );
  assert(resizedZoom.zoomSegments[0].endUs === 4_500_000, 'zoom end drag must resize the block');
  assert(
    resizedZoom.zoomSegments[0].source === 'user',
    'resizing an automatic zoom block must preserve it as a user edit',
  );
  const resizedCaption = resizeVideoTimelineBlock(
    composed,
    duration,
    'text',
    composed.captions[0].id,
    'start',
    2_500_000,
  );
  assert(
    resizedCaption.captions[0].startUs === 2_500_000 &&
      resizedCaption.captions[0].text === 'Focus here',
    'caption start drag must resize the block without losing its text',
  );
  const resizedMaskDuration = resizeVideoTimelineBlock(
    composed,
    duration,
    'mask',
    composed.masks[0].id,
    'end',
    6_500_000,
  );
  assert(
    resizedMaskDuration.masks[0].endUs === 6_500_000 &&
      resizedMaskDuration.masks[0].width === composed.masks[0].width,
    'blur end drag must resize the block without changing its region',
  );
  const zoomStart = videoZoomAt(composed, duration, 1_000_000);
  const zoomMiddle = videoZoomAt(composed, duration, 2_000_000);
  const zoomEnd = videoZoomAt(composed, duration, 3_000_000);
  assert(zoomStart.scale === 1, 'zoom must ease in from the unscaled frame');
  assert(Math.abs(zoomMiddle.scale - 1.4) < 1e-9, 'zoom must reach its requested scale');
  assert(zoomEnd.scale === 1, 'zoom must ease back to the unscaled frame');
  assert(zoomMiddle.focusX === 0.68, 'zoom preview must use the detected source position');
  assert(zoomMiddle.focusY === 0.4, 'zoom preview must preserve the detected source position');
  const sourceTransform = videoSourceTransformAt(composed, duration, 2_000_000, 160, 90);
  assert(
    Math.abs(sourceTransform.width - 224) < 1e-9,
    'preview zoom must scale only the imported video width',
  );
  assert(
    Math.abs(sourceTransform.height - 126) < 1e-9,
    'preview zoom must scale only the imported video height',
  );
  assert(
    Math.abs(sourceTransform.x + 64) < 1e-9,
    'preview focus must clamp at the imported video edge',
  );
  assert(
    Math.abs(sourceTransform.y + 5.4) < 1e-9,
    'preview focus must use imported-video coordinates',
  );

  const mask = { height: 0.25, id: 'mask-direct', width: 0.3, x: 0.2, y: 0.3 };
  const movedMask = moveVideoMask(mask, 0.7, -0.5);
  assert(movedMask.x === 0.7, 'mask movement must stop at the recording right edge');
  assert(movedMask.y === 0, 'mask movement must stop at the recording top edge');
  assert(movedMask.id === mask.id, 'mask movement must preserve effect metadata');
  const enlargedMask = resizeVideoMask(mask, 'se', 0.2, 0.35);
  assert(Math.abs(enlargedMask.width - 0.5) < 1e-9, 'east mask handles must resize width');
  assert(Math.abs(enlargedMask.height - 0.6) < 1e-9, 'south mask handles must resize height');
  const minimumMask = resizeVideoMask(mask, 'nw', 1, 1);
  assert(
    Math.abs(minimumMask.width - 0.05) < 1e-9 && Math.abs(minimumMask.height - 0.05) < 1e-9,
    'mask resize handles must preserve the minimum region size',
  );
  assert(
    videoMaskResizeHandles(mask).length === 8,
    'blur regions must expose corner and edge resize handles',
  );
  assert(
    videoMaskHandleAt(mask, 0.5, 0.55, 1_000, 500, 12) === 'se',
    'mask handles must be hit tested in preview pixels',
  );
  assert(videoMaskContainsPoint(mask, 0.35, 0.4), 'mask interiors must support direct movement');
  assert(
    !videoMaskContainsPoint(mask, 0.1, 0.4),
    'points outside a blur region must not start movement',
  );

  print('video edit state is valid');
  System.exit(0);
} catch (error) {
  printerr(String(error));
  printerr(error.stack ?? error.message);
  System.exit(1);
}

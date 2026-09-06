import { backgroundPreset, shareRatio } from '../share/presets.js';

export const MIN_VIDEO_TRIM_DURATION_US = 250_000;
export const MIN_TIMELINE_SEGMENT_DURATION_US = 200_000;
export const MIN_VIDEO_MASK_SIZE = 0.05;
export const VIDEO_SPEED_VALUES = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2]);
export const VIDEO_MASK_RESIZE_HANDLES = Object.freeze([
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
]);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function microseconds(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : fallback;
}

function finiteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function segmentId(segment, prefix, index) {
  const candidate = String(segment?.id ?? '').trim();
  return candidate || `${prefix}-${index + 1}`;
}

function normalizeSegmentRange(segment, durationUs) {
  const duration = microseconds(durationUs);
  if (duration <= 0) return null;

  const startUs = clamp(microseconds(segment?.startUs), 0, duration);
  const fallbackEnd = Math.min(duration, startUs + 2_000_000);
  const endUs = clamp(microseconds(segment?.endUs, fallbackEnd), 0, duration);
  if (endUs - startUs < Math.min(MIN_TIMELINE_SEGMENT_DURATION_US, duration)) return null;
  return { endUs, startUs };
}

function normalizeZoomSegments(segments, durationUs) {
  if (!Array.isArray(segments)) return [];
  return segments
    .map((segment, index) => {
      const range = normalizeSegmentRange(segment, durationUs);
      if (!range) return null;
      const source = segment.source === 'input' ? 'input' : 'user';
      const normalized = {
        ...range,
        confidence: source === 'input' ? clamp(finiteNumber(segment.confidence, 0.6), 0, 1) : 1,
        focusX: clamp(finiteNumber(segment.focusX, 0.5), 0, 1),
        focusY: clamp(finiteNumber(segment.focusY, 0.5), 0, 1),
        id: segmentId(segment, 'zoom', index),
        mode: segment.mode === 'manual' ? 'manual' : 'auto',
        scale: clamp(finiteNumber(segment.scale, 1.3), 1.05, 3),
        source,
      };
      if (source === 'input') {
        normalized.sourceFocusX = clamp(
          finiteNumber(segment.sourceFocusX, segment.focusX ?? 0.5),
          0,
          1,
        );
        normalized.sourceFocusY = clamp(
          finiteNumber(segment.sourceFocusY, segment.focusY ?? 0.5),
          0,
          1,
        );
        normalized.focusX = normalized.sourceFocusX;
        normalized.focusY = normalized.sourceFocusY;
      }
      return normalized;
    })
    .filter(Boolean)
    .sort((left, right) => left.startUs - right.startUs || left.endUs - right.endUs);
}

function normalizeCaptions(captions, durationUs) {
  if (!Array.isArray(captions)) return [];
  return captions
    .map((caption, index) => {
      const range = normalizeSegmentRange(caption, durationUs);
      const text = String(caption?.text ?? '')
        .trim()
        .slice(0, 240);
      if (!range || !text) return null;
      return { ...range, id: segmentId(caption, 'caption', index), text };
    })
    .filter(Boolean)
    .sort((left, right) => left.startUs - right.startUs || left.endUs - right.endUs);
}

function normalizeMasks(masks, durationUs) {
  if (!Array.isArray(masks)) return [];
  return masks
    .map((mask, index) => {
      const range = normalizeSegmentRange(mask, durationUs);
      if (!range) return null;
      const x = clamp(finiteNumber(mask.x, 0.325), 0, 0.95);
      const y = clamp(finiteNumber(mask.y, 0.325), 0, 0.95);
      return {
        ...range,
        blur: clamp(finiteNumber(mask.blur, 18), 4, 64),
        height: clamp(finiteNumber(mask.height, 0.35), MIN_VIDEO_MASK_SIZE, 1 - y),
        id: segmentId(mask, 'mask', index),
        width: clamp(finiteNumber(mask.width, 0.35), MIN_VIDEO_MASK_SIZE, 1 - x),
        x,
        y,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.startUs - right.startUs || left.endUs - right.endUs);
}

function videoMaskGeometry(mask = {}) {
  const width = clamp(finiteNumber(mask.width, 0.35), MIN_VIDEO_MASK_SIZE, 1);
  const height = clamp(finiteNumber(mask.height, 0.35), MIN_VIDEO_MASK_SIZE, 1);
  return {
    height,
    width,
    x: clamp(finiteNumber(mask.x, 0.325), 0, 1 - width),
    y: clamp(finiteNumber(mask.y, 0.325), 0, 1 - height),
  };
}

export function videoMaskResizeHandles(mask = {}) {
  const { height, width, x, y } = videoMaskGeometry(mask);
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const right = x + width;
  const bottom = y + height;
  return [
    { handle: 'nw', x, y },
    { handle: 'n', x: centerX, y },
    { handle: 'ne', x: right, y },
    { handle: 'e', x: right, y: centerY },
    { handle: 'se', x: right, y: bottom },
    { handle: 's', x: centerX, y: bottom },
    { handle: 'sw', x, y: bottom },
    { handle: 'w', x, y: centerY },
  ];
}

export function videoMaskContainsPoint(mask = {}, x = 0, y = 0) {
  const geometry = videoMaskGeometry(mask);
  const pointX = finiteNumber(x, -1);
  const pointY = finiteNumber(y, -1);
  return (
    pointX >= geometry.x &&
    pointX <= geometry.x + geometry.width &&
    pointY >= geometry.y &&
    pointY <= geometry.y + geometry.height
  );
}

export function videoMaskHandleAt(mask = {}, x = 0, y = 0, width = 0, height = 0, tolerance = 10) {
  const pixelWidth = Math.max(1, finiteNumber(width, 0));
  const pixelHeight = Math.max(1, finiteNumber(height, 0));
  const pointX = finiteNumber(x, -1);
  const pointY = finiteNumber(y, -1);
  const hitRadius = Math.max(0, finiteNumber(tolerance, 10));
  return (
    videoMaskResizeHandles(mask).find(
      (candidate) =>
        Math.hypot((pointX - candidate.x) * pixelWidth, (pointY - candidate.y) * pixelHeight) <=
        hitRadius,
    )?.handle ?? null
  );
}

export function moveVideoMask(mask = {}, dx = 0, dy = 0) {
  const geometry = videoMaskGeometry(mask);
  return {
    ...mask,
    ...geometry,
    x: clamp(geometry.x + finiteNumber(dx, 0), 0, 1 - geometry.width),
    y: clamp(geometry.y + finiteNumber(dy, 0), 0, 1 - geometry.height),
  };
}

export function resizeVideoMask(mask = {}, handle, dx = 0, dy = 0) {
  const resizeHandle = String(handle ?? '').toLowerCase();
  if (!VIDEO_MASK_RESIZE_HANDLES.includes(resizeHandle))
    throw new TypeError(`Unsupported video mask resize handle: ${handle}`);

  const geometry = videoMaskGeometry(mask);
  let left = geometry.x;
  let right = geometry.x + geometry.width;
  let top = geometry.y;
  let bottom = geometry.y + geometry.height;
  const offsetX = finiteNumber(dx, 0);
  const offsetY = finiteNumber(dy, 0);

  if (resizeHandle.includes('w')) left = clamp(left + offsetX, 0, right - MIN_VIDEO_MASK_SIZE);
  if (resizeHandle.includes('e')) right = clamp(right + offsetX, left + MIN_VIDEO_MASK_SIZE, 1);
  if (resizeHandle.includes('n')) top = clamp(top + offsetY, 0, bottom - MIN_VIDEO_MASK_SIZE);
  if (resizeHandle.includes('s')) bottom = clamp(bottom + offsetY, top + MIN_VIDEO_MASK_SIZE, 1);

  return {
    ...mask,
    height: bottom - top,
    width: right - left,
    x: left,
    y: top,
  };
}

function normalizeShareSettings(settings = {}) {
  return {
    cornerRadius: clamp(finiteNumber(settings.cornerRadius, 42), 0, 96),
    padding: clamp(finiteNumber(settings.padding, 0.085), 0.035, 0.22),
    presetId: backgroundPreset(settings.presetId).id,
    ratioId: shareRatio(settings.ratioId).id,
    shadow: settings.shadow !== false,
    shadowStrength: clamp(finiteNumber(settings.shadowStrength, 1), 0, 1),
  };
}

function closestSpeed(value) {
  const speed = finiteNumber(value, 1);
  return VIDEO_SPEED_VALUES.reduce((best, candidate) =>
    Math.abs(candidate - speed) < Math.abs(best - speed) ? candidate : best,
  );
}

export function normalizeVideoEdit(edit = {}, durationUs = 0) {
  const duration = microseconds(durationUs);
  const common = {
    audioVolume: clamp(finiteNumber(edit.audioVolume, 1), 0, 2),
    captions: normalizeCaptions(edit.captions, duration),
    masks: normalizeMasks(edit.masks, duration),
    muted: Boolean(edit.muted),
    share: normalizeShareSettings(edit.share),
    shareEnabled: Boolean(edit.shareEnabled),
    speed: closestSpeed(edit.speed),
    zoomSegments: normalizeZoomSegments(edit.zoomSegments, duration),
  };
  if (duration <= 0) return { ...common, trimEndUs: 0, trimStartUs: 0 };

  const minimumDuration = Math.min(MIN_VIDEO_TRIM_DURATION_US, duration);
  let trimStartUs = clamp(microseconds(edit.trimStartUs), 0, duration - minimumDuration);
  let trimEndUs = clamp(microseconds(edit.trimEndUs, duration), minimumDuration, duration);
  if (trimEndUs - trimStartUs < minimumDuration) {
    trimEndUs = Math.min(duration, trimStartUs + minimumDuration);
    trimStartUs = Math.max(0, trimEndUs - minimumDuration);
  }

  return { ...common, trimEndUs, trimStartUs };
}

export function resizeVideoTimelineBlock(
  edit = {},
  durationUs = 0,
  kind = '',
  id = '',
  edge = '',
  timestampUs = 0,
) {
  const duration = microseconds(durationUs);
  const normalized = normalizeVideoEdit(edit, duration);
  const blockKind = String(kind);
  const blockId = String(id);
  const resizeEdge = String(edge);
  if (duration <= 0 || !['start', 'end'].includes(resizeEdge)) return normalized;

  const timestamp = clamp(microseconds(timestampUs), 0, duration);
  if (['video', 'audio', 'speed'].includes(blockKind)) {
    const minimumDuration = Math.min(MIN_VIDEO_TRIM_DURATION_US, duration);
    return normalizeVideoEdit(
      {
        ...normalized,
        trimEndUs:
          resizeEdge === 'end'
            ? clamp(timestamp, normalized.trimStartUs + minimumDuration, duration)
            : normalized.trimEndUs,
        trimStartUs:
          resizeEdge === 'start'
            ? clamp(timestamp, 0, normalized.trimEndUs - minimumDuration)
            : normalized.trimStartUs,
      },
      duration,
    );
  }

  const collectionName =
    blockKind === 'zoom'
      ? 'zoomSegments'
      : blockKind === 'text'
        ? 'captions'
        : blockKind === 'mask'
          ? 'masks'
          : '';
  if (!collectionName) return normalized;

  const minimumDuration = Math.min(MIN_TIMELINE_SEGMENT_DURATION_US, duration);
  const collection = normalized[collectionName];
  const segment = collection.find((candidate) => candidate.id === blockId);
  if (!segment) return normalized;

  const startUs =
    resizeEdge === 'start' ? clamp(timestamp, 0, segment.endUs - minimumDuration) : segment.startUs;
  const endUs =
    resizeEdge === 'end'
      ? clamp(timestamp, segment.startUs + minimumDuration, duration)
      : segment.endUs;
  if (startUs === segment.startUs && endUs === segment.endUs) return normalized;

  return normalizeVideoEdit(
    {
      ...normalized,
      [collectionName]: collection.map((candidate) =>
        candidate.id === blockId
          ? {
              ...candidate,
              endUs,
              startUs,
              ...(blockKind === 'zoom' ? { source: 'user' } : {}),
            }
          : candidate,
      ),
    },
    duration,
  );
}

export function selectedVideoDurationUs(edit = {}, durationUs = 0) {
  const normalized = normalizeVideoEdit(edit, durationUs);
  return Math.round((normalized.trimEndUs - normalized.trimStartUs) / normalized.speed);
}

export function videoZoomAt(edit = {}, durationUs = 0, timestampUs = 0) {
  const normalized = normalizeVideoEdit(edit, durationUs);
  const timestamp = clamp(microseconds(timestampUs), 0, microseconds(durationUs));
  const segment = normalized.zoomSegments.find(
    (candidate) => timestamp >= candidate.startUs && timestamp <= candidate.endUs,
  );
  if (!segment) return { active: false, focusX: 0.5, focusY: 0.5, scale: 1, source: 'user' };

  const duration = segment.endUs - segment.startUs;
  const transitionUs = Math.min(250_000, duration / 2);
  const edgeDistance = Math.min(timestamp - segment.startUs, segment.endUs - timestamp);
  const progress = transitionUs > 0 ? clamp(edgeDistance / transitionUs, 0, 1) : 1;
  const eased = (1 - Math.cos(Math.PI * progress)) / 2;
  return {
    active: true,
    focusX:
      segment.mode === 'manual' && segment.source === 'input'
        ? segment.sourceFocusX
        : segment.mode === 'manual'
          ? segment.focusX
          : 0.5,
    focusY:
      segment.mode === 'manual' && segment.source === 'input'
        ? segment.sourceFocusY
        : segment.mode === 'manual'
          ? segment.focusY
          : 0.5,
    scale: 1 + (segment.scale - 1) * eased,
    source: segment.source,
  };
}

export function videoSourceTransformAt(
  edit = {},
  durationUs = 0,
  timestampUs = 0,
  width = 0,
  height = 0,
) {
  const sourceWidth = Math.max(0, finiteNumber(width, 0));
  const sourceHeight = Math.max(0, finiteNumber(height, 0));
  const zoom = videoZoomAt(edit, durationUs, timestampUs);
  const scaledWidth = sourceWidth * zoom.scale;
  const scaledHeight = sourceHeight * zoom.scale;
  return {
    ...zoom,
    height: scaledHeight,
    width: scaledWidth,
    x: Math.min(
      0,
      Math.max(sourceWidth - scaledWidth, sourceWidth / 2 - zoom.focusX * scaledWidth),
    ),
    y: Math.min(
      0,
      Math.max(sourceHeight - scaledHeight, sourceHeight / 2 - zoom.focusY * scaledHeight),
    ),
  };
}

export function hasVideoEdits(edit = {}, durationUs = 0) {
  const duration = microseconds(durationUs);
  const normalized = normalizeVideoEdit(edit, duration);
  return (
    normalized.muted ||
    Math.abs(normalized.audioVolume - 1) > 1e-9 ||
    Math.abs(normalized.speed - 1) > 1e-9 ||
    normalized.shareEnabled ||
    normalized.zoomSegments.length > 0 ||
    normalized.captions.length > 0 ||
    normalized.masks.length > 0 ||
    normalized.trimStartUs > 0 ||
    (duration > 0 && normalized.trimEndUs < duration)
  );
}

export function videoEditKey(edit = {}, durationUs = 0) {
  return JSON.stringify(normalizeVideoEdit(edit, durationUs));
}

export function videoTimeLabel(timestampUs) {
  const timestamp = microseconds(timestampUs);
  const wholeSeconds = Math.floor(timestamp / 1_000_000);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const seconds = wholeSeconds % 60;
  const tenths = Math.floor((timestamp % 1_000_000) / 100_000);
  const suffix = `${String(seconds).padStart(2, '0')}.${tenths}`;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${suffix}`;
  return `${minutes}:${suffix}`;
}

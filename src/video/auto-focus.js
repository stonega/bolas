const DEFAULT_DIFF_THRESHOLD = 20;
const DEFAULT_MAX_SAMPLES = 480;
const DEFAULT_MAX_SAMPLE_RATE = 4;
const MAX_CHANGED_FRAME_RATIO = 0.18;
const MAX_INPUT_HEIGHT_RATIO = 0.24;
const MAX_INPUT_WIDTH_RATIO = 0.86;
const MIN_ACTIVITY_SAMPLES = 3;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function distance(left, right) {
  return Math.hypot(left.focusX - right.focusX, left.focusY - right.focusY);
}

export function autoFocusSampleRate(
  durationUs,
  { maxRate = DEFAULT_MAX_SAMPLE_RATE, maxSamples = DEFAULT_MAX_SAMPLES } = {},
) {
  const seconds = Math.max(0.001, finiteNumber(durationUs) / 1_000_000);
  return clamp(Math.min(maxRate, maxSamples / seconds), 0.000001, maxRate);
}

function changedComponents(previous, current, threshold) {
  const { data, height, width } = current;
  if (
    previous.width !== width ||
    previous.height !== height ||
    previous.data.length !== data.length
  )
    return { changed: 0, components: [] };

  const cellSize = 12;
  const columns = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const cells = Array.from({ length: columns * rows }, () => ({
    changed: 0,
    maxX: 0,
    maxY: 0,
    minX: width,
    minY: height,
  }));
  let changed = 0;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const index = row + x;
      if (Math.abs(data[index] - previous.data[index]) < threshold) continue;
      changed++;
      const cell = cells[Math.floor(y / cellSize) * columns + Math.floor(x / cellSize)];
      cell.changed++;
      cell.minX = Math.min(cell.minX, x);
      cell.minY = Math.min(cell.minY, y);
      cell.maxX = Math.max(cell.maxX, x);
      cell.maxY = Math.max(cell.maxY, y);
    }
  }

  if (changed < 6 || changed / (width * height) > MAX_CHANGED_FRAME_RATIO)
    return { changed, components: [] };

  const active = cells.map((cell) => cell.changed >= 2);
  const visited = new Uint8Array(cells.length);
  const components = [];
  for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
    if (!active[cellIndex] || visited[cellIndex]) continue;
    const queue = [cellIndex];
    visited[cellIndex] = 1;
    const component = {
      changed: 0,
      maxX: 0,
      maxY: 0,
      minX: width,
      minY: height,
    };
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor];
      const cell = cells[index];
      component.changed += cell.changed;
      component.minX = Math.min(component.minX, cell.minX);
      component.minY = Math.min(component.minY, cell.minY);
      component.maxX = Math.max(component.maxX, cell.maxX);
      component.maxY = Math.max(component.maxY, cell.maxY);
      const column = index % columns;
      const row = Math.floor(index / columns);
      for (let yOffset = -1; yOffset <= 1; yOffset++) {
        for (let xOffset = -1; xOffset <= 1; xOffset++) {
          const nextColumn = column + xOffset;
          const nextRow = row + yOffset;
          if (nextColumn < 0 || nextColumn >= columns || nextRow < 0 || nextRow >= rows) continue;
          const nextIndex = nextRow * columns + nextColumn;
          if (!active[nextIndex] || visited[nextIndex]) continue;
          visited[nextIndex] = 1;
          queue.push(nextIndex);
        }
      }
    }
    if (component.changed >= Math.max(6, changed * 0.12)) components.push(component);
  }
  return { changed, components };
}

export function detectFrameInputActivity(previous, current, options = {}) {
  if (!previous?.data || !current?.data) return null;
  const width = Math.max(1, Number(current.width) || 0);
  const height = Math.max(1, Number(current.height) || 0);
  const { changed, components } = changedComponents(
    previous,
    current,
    finiteNumber(options.diffThreshold, DEFAULT_DIFF_THRESHOLD),
  );
  const candidates = components
    .map((component) => {
      const componentWidth = component.maxX - component.minX + 1;
      const componentHeight = component.maxY - component.minY + 1;
      const widthRatio = componentWidth / width;
      const heightRatio = componentHeight / height;
      if (widthRatio > MAX_INPUT_WIDTH_RATIO || heightRatio > MAX_INPUT_HEIGHT_RATIO) return null;
      const area = Math.max(1, componentWidth * componentHeight);
      const concentration = component.changed / area;
      return {
        changed: component.changed,
        focusX: (component.minX + component.maxX + 1) / 2 / width,
        focusY: (component.minY + component.maxY + 1) / 2 / height,
        heightRatio,
        maxX: component.maxX / width,
        maxY: component.maxY / height,
        minX: component.minX / width,
        minY: component.minY / height,
        score: component.changed * (0.5 + Math.min(1, concentration)),
        widthRatio,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);

  if (!candidates.length) return null;
  const candidate = candidates[0];
  return { ...candidate, changedRatio: changed / (width * height) };
}

function addActivity(events, observation) {
  const activity = observation.activity;
  const matching = [...events]
    .reverse()
    .find(
      (event) =>
        observation.startUs - event.lastUs <= 900_000 &&
        distance(event, activity) <= 0.16 &&
        Math.abs(event.focusY - activity.focusY) <= 0.1,
    );
  if (!matching) {
    events.push({
      changed: activity.changed,
      firstUs: observation.startUs,
      focusX: activity.focusX,
      focusY: activity.focusY,
      lastUs: observation.endUs,
      maxX: activity.maxX,
      maxY: activity.maxY,
      minX: activity.minX,
      minY: activity.minY,
      samples: 1,
    });
    return;
  }

  const totalChanged = matching.changed + activity.changed;
  matching.focusX =
    (matching.focusX * matching.changed + activity.focusX * activity.changed) / totalChanged;
  matching.focusY =
    (matching.focusY * matching.changed + activity.focusY * activity.changed) / totalChanged;
  matching.changed = totalChanged;
  matching.lastUs = observation.endUs;
  matching.maxX = Math.max(matching.maxX, activity.maxX);
  matching.maxY = Math.max(matching.maxY, activity.maxY);
  matching.minX = Math.min(matching.minX, activity.minX);
  matching.minY = Math.min(matching.minY, activity.minY);
  matching.samples++;
}

function zoomScale(event) {
  const width = Math.max(0.18, event.maxX - event.minX);
  const height = Math.max(0.08, event.maxY - event.minY);
  return clamp(Math.min(0.62 / width, 0.32 / height), 1.25, 2.2);
}

function mergeSegments(segments) {
  const merged = [];
  for (const segment of segments) {
    const previous = merged.at(-1);
    if (
      previous &&
      segment.startUs - previous.endUs <= 500_000 &&
      distance(previous, segment) <= 0.12
    ) {
      const leftDuration = previous.endUs - previous.startUs;
      const rightDuration = segment.endUs - segment.startUs;
      const duration = leftDuration + rightDuration;
      previous.endUs = Math.max(previous.endUs, segment.endUs);
      previous.focusX =
        (previous.focusX * leftDuration + segment.focusX * rightDuration) / duration;
      previous.focusY =
        (previous.focusY * leftDuration + segment.focusY * rightDuration) / duration;
      previous.scale = Math.max(previous.scale, segment.scale);
      previous.confidence = Math.max(previous.confidence, segment.confidence);
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
}

export function inputFocusSegmentsFromActivities(
  observations,
  { trimEndUs = Number.MAX_SAFE_INTEGER, trimStartUs = 0 } = {},
) {
  const startLimit = Math.max(0, finiteNumber(trimStartUs));
  const endLimit = Math.max(startLimit, finiteNumber(trimEndUs, Number.MAX_SAFE_INTEGER));
  const events = [];
  for (const observation of observations ?? []) {
    if (observation?.activity) addActivity(events, observation);
  }

  const segments = events
    .filter(
      (event) =>
        event.samples >= MIN_ACTIVITY_SAMPLES &&
        event.lastUs - event.firstUs >= 300_000 &&
        event.maxY - event.minY <= MAX_INPUT_HEIGHT_RATIO &&
        event.maxX - event.minX <= MAX_INPUT_WIDTH_RATIO,
    )
    .map((event) => ({
      confidence: clamp(0.58 + (event.samples - MIN_ACTIVITY_SAMPLES) * 0.055, 0.58, 0.94),
      endUs: Math.min(endLimit, event.lastUs + 800_000),
      focusX: clamp(event.focusX, 0, 1),
      focusY: clamp(event.focusY, 0, 1),
      mode: 'manual',
      scale: zoomScale(event),
      source: 'input',
      startUs: Math.max(startLimit, event.firstUs - 250_000),
    }))
    .filter((segment) => segment.endUs - segment.startUs >= 400_000)
    .sort((left, right) => left.startUs - right.startUs);

  return mergeSegments(segments).map((segment, index) => ({
    ...segment,
    id: `input-focus-${index + 1}`,
  }));
}

export function detectInputFocusSegments(frames, options = {}) {
  const observations = [];
  for (let index = 1; index < (frames?.length ?? 0); index++) {
    observations.push({
      activity: detectFrameInputActivity(frames[index - 1], frames[index], options),
      endUs: finiteNumber(frames[index].timestampUs),
      startUs: finiteNumber(frames[index - 1].timestampUs),
    });
  }
  return inputFocusSegmentsFromActivities(observations, options);
}

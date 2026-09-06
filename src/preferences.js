import Gio from 'gi://Gio?version=2.0';

import { APP_ID } from './config.js';

export const EDITOR_PREFERENCE_DEFAULTS = Object.freeze({
  cropPortrait: false,
  cropRatioId: 'free',
  fillEnabled: false,
  fontFamily: 'Sans',
  fontSize: 0.06,
  strokeColor: '#e52f36',
  strokeWidth: 0.006,
  tool: 'select',
});

export const SHARE_PREFERENCE_DEFAULTS = Object.freeze({
  cornerRadius: 42,
  padding: 0.085,
  presetId: 'aurora',
  ratioId: 'landscape',
  shadow: true,
  shadowStrength: 1,
});

const EDITOR_TOOLS = Object.freeze([
  'select',
  'pencil',
  'line',
  'arrow',
  'rectangle',
  'ellipse',
  'text',
]);
const EDITOR_COLORS = Object.freeze([
  '#1c1c1c',
  '#9aa6b2',
  '#d56ef2',
  '#b635c8',
  '#3b5bdb',
  '#4a9ee8',
  '#f4ab49',
  '#e45a17',
  '#07996f',
  '#49b568',
  '#f47476',
  '#e52f36',
]);
const EDITOR_STROKE_WIDTHS = Object.freeze([0.0025, 0.006, 0.012, 0.022]);
const EDITOR_FONT_SIZES = Object.freeze([0.03, 0.045, 0.06, 0.09]);
const EDITOR_CROP_RATIOS = Object.freeze([
  'free',
  'original',
  'square',
  '5:4',
  '4:3',
  '3:2',
  '16:9',
]);
const SHARE_PRESETS = Object.freeze([
  'aurora',
  'sky',
  'sunset',
  'midnight',
  'mint-bloom',
  'violet-bloom',
  'sunbeam',
  'deep-teal',
  'brass-tide',
  'eclipse-gold',
  'paper',
  'graphite',
]);
const SHARE_RATIOS = Object.freeze(['landscape', 'wide', 'square']);

function choice(value, allowed, fallback) {
  const candidate = String(value ?? '');
  return allowed.includes(candidate) ? candidate : fallback;
}

function numericChoice(value, allowed, fallback) {
  const candidate = Number(value);
  return allowed.some((allowedValue) => Math.abs(allowedValue - candidate) < 1e-9)
    ? candidate
    : fallback;
}

function numberInRange(value, minimum, maximum, fallback) {
  const candidate = Number(value);
  if (!Number.isFinite(candidate)) return fallback;
  return Math.min(maximum, Math.max(minimum, candidate));
}

function boolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function nonEmptyString(value, fallback) {
  const candidate = String(value ?? '').trim();

  return candidate || fallback;
}

export function normalizeEditorPreferences(values = {}) {
  return {
    cropPortrait: boolean(values.cropPortrait, EDITOR_PREFERENCE_DEFAULTS.cropPortrait),
    cropRatioId: choice(
      values.cropRatioId,
      EDITOR_CROP_RATIOS,
      EDITOR_PREFERENCE_DEFAULTS.cropRatioId,
    ),
    fillEnabled: boolean(values.fillEnabled, EDITOR_PREFERENCE_DEFAULTS.fillEnabled),
    fontFamily: nonEmptyString(values.fontFamily, EDITOR_PREFERENCE_DEFAULTS.fontFamily),
    fontSize: numericChoice(
      values.fontSize,
      EDITOR_FONT_SIZES,
      EDITOR_PREFERENCE_DEFAULTS.fontSize,
    ),
    strokeColor: choice(
      String(values.strokeColor ?? '').toLowerCase(),
      EDITOR_COLORS,
      EDITOR_PREFERENCE_DEFAULTS.strokeColor,
    ),
    strokeWidth: numericChoice(
      values.strokeWidth,
      EDITOR_STROKE_WIDTHS,
      EDITOR_PREFERENCE_DEFAULTS.strokeWidth,
    ),
    tool: choice(values.tool, EDITOR_TOOLS, EDITOR_PREFERENCE_DEFAULTS.tool),
  };
}

export function normalizeSharePreferences(values = {}) {
  return {
    cornerRadius: numberInRange(values.cornerRadius, 0, 96, SHARE_PREFERENCE_DEFAULTS.cornerRadius),
    padding: numberInRange(values.padding, 0.035, 0.22, SHARE_PREFERENCE_DEFAULTS.padding),
    presetId: choice(values.presetId, SHARE_PRESETS, SHARE_PREFERENCE_DEFAULTS.presetId),
    ratioId: choice(values.ratioId, SHARE_RATIOS, SHARE_PREFERENCE_DEFAULTS.ratioId),
    shadow: boolean(values.shadow, SHARE_PREFERENCE_DEFAULTS.shadow),
    shadowStrength: numberInRange(
      values.shadowStrength,
      0,
      1,
      SHARE_PREFERENCE_DEFAULTS.shadowStrength,
    ),
  };
}

export function sharePreferencesForSource(values = {}, hasTransparency = false) {
  const preferences = normalizeSharePreferences(values);

  return hasTransparency ? { ...preferences, cornerRadius: 0, shadow: false } : preferences;
}

const EDITOR_DEFINITIONS = Object.freeze({
  cropPortrait: { key: 'editor-crop-portrait', type: 'boolean' },
  cropRatioId: { key: 'editor-crop-ratio', type: 'string' },
  fillEnabled: { key: 'editor-fill-enabled', type: 'boolean' },
  fontFamily: { key: 'editor-font-family', type: 'string' },
  fontSize: { key: 'editor-font-size', type: 'double' },
  strokeColor: { key: 'editor-stroke-color', type: 'string' },
  strokeWidth: { key: 'editor-stroke-width', type: 'double' },
  tool: { key: 'editor-tool', type: 'string' },
});

const SHARE_DEFINITIONS = Object.freeze({
  cornerRadius: { key: 'share-corner-radius', type: 'double' },
  padding: { key: 'share-padding', type: 'double' },
  presetId: { key: 'share-background', type: 'string' },
  ratioId: { key: 'share-ratio', type: 'string' },
  shadow: { key: 'share-shadow', type: 'boolean' },
  shadowStrength: { key: 'share-shadow-strength', type: 'double' },
});

function readPreferences(settings, definitions) {
  return Object.fromEntries(
    Object.entries(definitions).map(([name, { key, type }]) => [
      name,
      settings[`get_${type}`](key),
    ]),
  );
}

function writePreference(settings, definitions, name, value) {
  const definition = definitions[name];
  if (!definition) throw new Error(`Unknown preference: ${name}`);

  return settings[`set_${definition.type}`](definition.key, value);
}

export class UserPreferences {
  constructor(settings = null) {
    this._settings = settings ?? Gio.Settings.new(APP_ID);
  }

  getEditorPreferences() {
    return normalizeEditorPreferences(readPreferences(this._settings, EDITOR_DEFINITIONS));
  }

  rememberEditorOption(name, value) {
    const normalized = normalizeEditorPreferences({
      ...EDITOR_PREFERENCE_DEFAULTS,
      [name]: value,
    });
    return writePreference(this._settings, EDITOR_DEFINITIONS, name, normalized[name]);
  }

  getSharePreferences() {
    return normalizeSharePreferences(readPreferences(this._settings, SHARE_DEFINITIONS));
  }

  rememberShareOption(name, value) {
    const normalized = normalizeSharePreferences({
      ...SHARE_PREFERENCE_DEFAULTS,
      [name]: value,
    });
    return writePreference(this._settings, SHARE_DEFINITIONS, name, normalized[name]);
  }
}

let defaultPreferences = null;

export function getUserPreferences() {
  defaultPreferences ??= new UserPreferences();
  return defaultPreferences;
}

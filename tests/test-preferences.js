import Gio from 'gi://Gio?version=2.0';
import System from 'system';

import { APP_ID } from '../src/config.js';
import {
  EDITOR_PREFERENCE_DEFAULTS,
  normalizeEditorPreferences,
  normalizeSharePreferences,
  SHARE_PREFERENCE_DEFAULTS,
  sharePreferencesForSource,
  UserPreferences,
} from '../src/preferences.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

try {
  const preferences = new UserPreferences(Gio.Settings.new(APP_ID));
  assertEqual(
    preferences.getEditorPreferences(),
    EDITOR_PREFERENCE_DEFAULTS,
    'editor defaults should come from the application schema',
  );
  assertEqual(
    preferences.getSharePreferences(),
    SHARE_PREFERENCE_DEFAULTS,
    'share defaults should come from the application schema',
  );

  const editorChoices = {
    cropPortrait: true,
    cropRatioId: '16:9',
    fillEnabled: true,
    fontFamily: 'Cantarell',
    fontSize: 0.09,
    strokeColor: '#b635c8',
    strokeWidth: 0.022,
    tool: 'arrow',
  };
  for (const [name, value] of Object.entries(editorChoices))
    preferences.rememberEditorOption(name, value);

  const shareChoices = {
    cornerRadius: 76,
    padding: 0.18,
    presetId: 'graphite',
    ratioId: 'square',
    shadow: false,
    shadowStrength: 0.55,
  };
  for (const [name, value] of Object.entries(shareChoices))
    preferences.rememberShareOption(name, value);

  const restored = new UserPreferences(Gio.Settings.new(APP_ID));
  assertEqual(
    restored.getEditorPreferences(),
    editorChoices,
    'every editor option should survive a new preferences instance',
  );
  assertEqual(
    restored.getSharePreferences(),
    shareChoices,
    'every share option should survive a new preferences instance',
  );

  assertEqual(
    normalizeEditorPreferences({ fontFamily: '   ', tool: 'invalid', strokeColor: 'invalid' }),
    EDITOR_PREFERENCE_DEFAULTS,
    'invalid editor values should fall back safely',
  );
  assertEqual(
    normalizeSharePreferences({
      cornerRadius: 200,
      padding: -1,
      ratioId: 'invalid',
      shadowStrength: -1,
    }),
    { ...SHARE_PREFERENCE_DEFAULTS, cornerRadius: 96, padding: 0.035, shadowStrength: 0 },
    'share numeric values should be constrained and invalid choices should fall back',
  );
  assertEqual(
    sharePreferencesForSource(shareChoices, true),
    { ...shareChoices, cornerRadius: 0, shadow: false },
    'transparent sources should disable only the effective corner and shadow options',
  );
  assertEqual(
    restored.getSharePreferences(),
    shareChoices,
    'transparent source constraints should not erase remembered choices',
  );

  print('user preferences are normalized and persisted independently');
  System.exit(0);
} catch (error) {
  printerr(error.stack ?? error.message);
  System.exit(1);
}

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import System from 'system';

import { APP_ID } from '../src/config.js';
import { configureSourceSettings } from '../src/source-settings.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = GLib.build_filenamev([
  GLib.get_tmp_dir(),
  `bolas-source-settings-${GLib.uuid_string_random()}`,
]);
const sourceDirectory = GLib.build_filenamev([root, 'src']);
const dataDirectory = GLib.build_filenamev([root, 'data']);
const targetDirectory = GLib.build_filenamev([root, 'build', 'data']);
const schemaName = `${APP_ID}.gschema.xml`;
const schemaPath = GLib.build_filenamev([dataDirectory, schemaName]);
const compiledPath = GLib.build_filenamev([targetDirectory, 'gschemas.compiled']);
const originalSchemaDirectory = GLib.getenv('GSETTINGS_SCHEMA_DIR');
const originalSettingsBackend = GLib.getenv('GSETTINGS_BACKEND');
let exitCode = 0;

try {
  GLib.mkdir_with_parents(sourceDirectory, 0o700);
  GLib.mkdir_with_parents(dataDirectory, 0o700);
  const repositoryRoot = Gio.File.new_for_uri(import.meta.url)
    .get_parent()
    .get_parent();
  Gio.File.new_for_path(repositoryRoot.get_child('data').get_child(schemaName).get_path()).copy(
    Gio.File.new_for_path(schemaPath),
    Gio.FileCopyFlags.NONE,
    null,
    null,
  );

  GLib.unsetenv('GSETTINGS_SCHEMA_DIR');
  GLib.setenv('GSETTINGS_BACKEND', 'memory', true);
  const configured = configureSourceSettings({
    appId: APP_ID,
    mainModuleUrl: Gio.File.new_for_path(`${sourceDirectory}/main.js`).get_uri(),
  });
  assert(configured, 'source-tree settings were not configured');
  assert(GLib.getenv('GSETTINGS_SCHEMA_DIR') === targetDirectory, 'schema directory is incorrect');
  assert(GLib.file_test(compiledPath, GLib.FileTest.EXISTS), 'compiled schema is missing');
  const settings = Gio.Settings.new(APP_ID);
  assert(settings.get_boolean('share-shadow'), 'the compiled schema could not be loaded');

  GLib.setenv('GSETTINGS_SCHEMA_DIR', '/explicit/schema/directory', true);
  assert(
    !configureSourceSettings({
      appId: APP_ID,
      mainModuleUrl: Gio.File.new_for_path(`${sourceDirectory}/main.js`).get_uri(),
    }),
    'an explicit schema directory was replaced',
  );
  assert(
    GLib.getenv('GSETTINGS_SCHEMA_DIR') === '/explicit/schema/directory',
    'the explicit schema directory changed',
  );

  print('source-tree settings schema is prepared before application startup');
} catch (error) {
  printerr(error.stack ?? error.message);
  exitCode = 1;
} finally {
  if (originalSchemaDirectory) GLib.setenv('GSETTINGS_SCHEMA_DIR', originalSchemaDirectory, true);
  else GLib.unsetenv('GSETTINGS_SCHEMA_DIR');
  if (originalSettingsBackend) GLib.setenv('GSETTINGS_BACKEND', originalSettingsBackend, true);
  else GLib.unsetenv('GSETTINGS_BACKEND');
  if (GLib.file_test(compiledPath, GLib.FileTest.EXISTS)) GLib.unlink(compiledPath);
  if (GLib.file_test(schemaPath, GLib.FileTest.EXISTS)) GLib.unlink(schemaPath);
  for (const directory of [
    targetDirectory,
    GLib.path_get_dirname(targetDirectory),
    dataDirectory,
    sourceDirectory,
    root,
  ]) {
    if (GLib.file_test(directory, GLib.FileTest.IS_DIR)) GLib.rmdir(directory);
  }
}

System.exit(exitCode);

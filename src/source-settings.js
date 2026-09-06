import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

/**
 * Compile and select the source-tree GSettings schema when Bolas is launched
 * directly with GJS. Installed builds have no adjacent source schema and keep
 * using GIO's normal system schema search path.
 */
export function configureSourceSettings({ appId, mainModuleUrl } = {}) {
  if (GLib.getenv('GSETTINGS_SCHEMA_DIR')) return false;

  const moduleFile = Gio.File.new_for_uri(String(mainModuleUrl ?? ''));
  const repositoryRoot = moduleFile.get_parent()?.get_parent();
  if (!repositoryRoot) return false;

  const dataDirectory = repositoryRoot.get_child('data');
  const sourceSchema = dataDirectory.get_child(`${appId}.gschema.xml`);
  if (!sourceSchema.query_exists(null)) return false;

  const targetDirectory = repositoryRoot.get_child('build').get_child('data');
  const dataPath = dataDirectory.get_path();
  const targetPath = targetDirectory.get_path();
  if (!dataPath || !targetPath) throw new Error('Could not resolve the source schema directory.');
  if (GLib.mkdir_with_parents(targetPath, 0o755) !== 0)
    throw new Error(`Could not create the source schema directory: ${targetPath}.`);

  const compiler = GLib.find_program_in_path('glib-compile-schemas');
  if (!compiler)
    throw new Error('glib-compile-schemas is required to run Bolas from the source tree.');

  const process = Gio.Subprocess.new(
    [compiler, '--strict', '--targetdir', targetPath, dataPath],
    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
  );
  const [, , standardError] = process.communicate_utf8(null, null);
  if (!process.get_successful())
    throw new Error(standardError?.trim() || 'Could not compile the Bolas settings schema.');

  GLib.setenv('GSETTINGS_SCHEMA_DIR', targetPath, true);
  return true;
}

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import System from 'system';

function readText(file) {
  return new TextDecoder().decode(file.load_contents(null)[1]);
}

function removeTree(file) {
  if (
    file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.DIRECTORY
  ) {
    const entries = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    try {
      for (let entry = entries.next_file(null); entry; entry = entries.next_file(null))
        removeTree(file.get_child(entry.get_name()));
    } finally {
      entries.close(null);
    }
  }
  file.delete(null);
}

const root = Gio.File.new_for_path(GLib.dir_make_tmp('bolas-launcher-test-XXXXXX'));
let exitCode = 1;
try {
  const [launcherPath, moduleDirectory] = ARGV;
  if (!launcherPath || !moduleDirectory)
    throw new Error('Usage: test-installed-launcher.js LAUNCHER MODULE_DIRECTORY');
  const modules = Gio.File.new_for_path(moduleDirectory);
  const tests = Gio.File.new_for_uri(import.meta.url).get_parent();
  const main = root.get_child('main.js');
  // Only relocate the module URI. Preserve the actual installed import statement
  // so a dynamic import regression is exercised, not hidden by the test harness.
  const launcher = readText(Gio.File.new_for_path(launcherPath));
  const moduleUri = launcher.match(/file:\/\/[^'"\n]+\/main\.js/)?.[0];
  if (!moduleUri) throw new Error('Installed launcher has no application module URI');
  const relocatedLauncher = root.get_child('bolas');
  GLib.file_set_contents(relocatedLauncher.get_path(), launcher.replace(moduleUri, main.get_uri()));
  const fixture = readText(tests.get_child('check-installed-launcher-main.js'));
  GLib.file_set_contents(main.get_path(), fixture.replaceAll('../src/', `${modules.get_uri()}/`));
  const process = Gio.Subprocess.new(
    ['gjs', '-m', relocatedLauncher.get_path(), root.get_path()],
    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
  );
  const [, stdout, stderr] = process.communicate_utf8(null, null);
  if (!process.get_successful()) throw new Error(stderr || 'Installed launcher check failed');
  print(stdout.trim());
  exitCode = 0;
} catch (error) {
  printerr(error.message);
} finally {
  removeTree(root);
}
System.exit(exitCode);

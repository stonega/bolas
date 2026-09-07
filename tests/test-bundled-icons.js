import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';

import { configureSourceIcons, resolveBundledIconFile } from '../src/bundledIcons.js';
import { APP_ID } from '../src/config.js';

const DRAW_TOOL_ICONS = [
  'tool-arrow-symbolic.svg',
  'tool-ellipse-symbolic.svg',
  'tool-line-symbolic.svg',
  'tool-pencil-symbolic.svg',
  'tool-rectangle-symbolic.svg',
  'tool-select-symbolic.svg',
  'tool-text-symbolic.svg',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function checkSourceIconLookup(appIconFile) {
  const root = GLib.dir_make_tmp('bolas-icon-lookup-XXXXXX');
  const themeDirectory = `${root}/hicolor`;
  const appsDirectory = `${themeDirectory}/scalable/apps`;
  const staleIconPath = `${appsDirectory}/${APP_ID}.svg`;
  const indexPath = `${themeDirectory}/index.theme`;
  try {
    GLib.mkdir_with_parents(appsDirectory, 0o700);
    GLib.file_set_contents(
      indexPath,
      '[Icon Theme]\nName=Hicolor\nDirectories=scalable/apps\n\n[scalable/apps]\nSize=128\nType=Scalable\nMinSize=16\nMaxSize=512\nContext=Applications\n',
    );
    GLib.file_set_contents(
      staleIconPath,
      '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128"/></svg>',
    );
    const theme = new Gtk.IconTheme();
    theme.set_theme_name('hicolor');
    theme.set_search_path([root]);
    const lookup = () =>
      theme.lookup_icon(APP_ID, [], 128, 1, Gtk.TextDirection.NONE, 0).get_file();
    assert(lookup().get_path() === staleIconPath, 'The installed-icon fixture was not selected');
    assert(configureSourceIcons(theme), 'The source icon directory was not registered');
    const sourceIcon = lookup();
    assert(
      sourceIcon.equal(appIconFile),
      `GTK resolves ${sourceIcon.get_path()} instead of ${appIconFile.get_path()}`,
    );
    configureSourceIcons(theme);
    assert(theme.get_search_path().length === 2, 'Repeated registration duplicates search paths');
    assert(theme.get_search_path().includes(root), 'The installed icon search path was lost');
    assert(lookup().equal(appIconFile), 'Repeated registration changed source icon priority');
    assert(
      !configureSourceIcons(
        theme,
        Gio.File.new_for_path(`${root}/installed/bundledIcons.js`).get_uri(),
      ),
      'An installed launch must keep normal icon lookup',
    );
    assert(lookup().equal(appIconFile), 'Missing source icons changed the existing search path');
  } finally {
    GLib.unlink(staleIconPath);
    GLib.unlink(indexPath);
    for (const path of [appsDirectory, `${themeDirectory}/scalable`, themeDirectory, root])
      GLib.rmdir(path);
  }
}

try {
  const appIconFile = Gio.File.new_for_uri(import.meta.url)
    .get_parent()
    .get_parent()
    .get_child(`data/icons/hicolor/scalable/apps/${APP_ID}.svg`);
  const appIcon = GdkPixbuf.Pixbuf.new_from_file(appIconFile.get_path());
  assert(appIcon.get_width() === 128 && appIcon.get_height() === 128, 'App icon must be 128px');
  assert(appIcon.get_has_alpha(), 'App icon must preserve transparency');
  const pixels = appIcon.get_pixels();
  const stride = appIcon.get_rowstride();
  const channels = appIcon.get_n_channels();
  assert(pixels[64 * stride + 64 * channels + 3] === 255, 'App icon center must render');
  // The canvas ends above this margin; a baked-in shadow would paint into it.
  for (let y = 116; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      assert(pixels[y * stride + x * channels + 3] === 0, 'App icon has a shadow below its canvas');
    }
  }
  checkSourceIconLookup(appIconFile);

  for (const filename of DRAW_TOOL_ICONS) {
    const file = resolveBundledIconFile(filename);
    assert(file.query_exists(null), `${filename} is missing`);
    assert(file.query_info('standard::size', 0, null).get_size() > 0, `${filename} is empty`);
    const [loaded, contents] = file.load_contents(null);
    const svg = new TextDecoder().decode(contents);

    assert(loaded, `${filename} could not be read`);
    assert(!svg.includes('stroke='), `${filename} uses unsupported symbolic stroke geometry`);
    assert(svg.includes('fill="#2e3436"'), `${filename} is not a GNOME symbolic icon`);
    if (filename.includes('rectangle') || filename.includes('ellipse'))
      assert(svg.includes('fill-rule="evenodd"'), `${filename} is not outlined`);
  }

  print('application icon renders without a shadow and bundled draw tool icons are available');
  System.exit(0);
} catch (error) {
  printerr(`${error.message}\n${error.stack ?? ''}`);
  System.exit(1);
}

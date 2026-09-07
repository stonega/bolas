import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { APP_ID } from './config.js';

export function configureSourceIcons(iconTheme, moduleUrl = import.meta.url) {
  const directory = Gio.File.new_for_uri(moduleUrl)
    .get_parent()
    .get_parent()
    .get_child('data/icons');
  if (!directory.query_exists(null)) return false;

  const path = directory.get_path();
  const existingPaths = iconTheme.get_search_path().filter((entry) => entry !== path);
  iconTheme.set_search_path([path, ...existingPaths]);

  // GTK 4.18 scans duplicate theme directories in reverse search-path order.
  // Check the resolved icon so distribution backports need no version checks.
  const sourceIcon = directory.get_child(`hicolor/scalable/apps/${APP_ID}.svg`);
  const resolved = iconTheme.lookup_icon(APP_ID, [], 128, 1, Gtk.TextDirection.NONE, 0);
  if (!resolved.get_file()?.equal(sourceIcon)) iconTheme.set_search_path([...existingPaths, path]);
  return true;
}

export function resolveBundledIconFile(filename) {
  return Gio.File.new_for_uri(import.meta.url)
    .get_parent()
    .get_child('icons')
    .get_child(String(filename));
}

export function createBundledIcon(filename, fallbackIcon = 'image-missing-symbolic') {
  const file = resolveBundledIconFile(filename);

  if (!file.query_exists(null)) return new Gtk.Image({ icon_name: fallbackIcon });

  return new Gtk.Image({ gicon: new Gio.FileIcon({ file }), pixel_size: 16 });
}

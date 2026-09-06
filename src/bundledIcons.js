import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

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

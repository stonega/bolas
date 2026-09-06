import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import System from 'system';

import { imageFormatLabel, inspectImagePath } from '../src/model/image-file.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const path = GLib.build_filenamev([
  GLib.get_tmp_dir(),
  `bolas-image-${GLib.uuid_string_random()}.png`,
]);

try {
  const pixbuf = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 32, 24);
  pixbuf.fill(0x3d6fb4ff);
  pixbuf.savev(path, 'png', [], []);

  const image = inspectImagePath(path);
  assert(image.path === path, 'the inspected path changed');
  assert(image.width === 32 && image.height === 24, 'image dimensions are incorrect');
  assert(image.format === 'PNG', 'image format is incorrect');
  assert(imageFormatLabel('jpeg') === 'JPEG', 'JPEG label is incorrect');

  let rejected = false;
  try {
    inspectImagePath('relative.png');
  } catch {
    rejected = true;
  }
  assert(rejected, 'relative image paths must be rejected');

  Gio.File.new_for_path(path).delete(null);
  print('image file inspection is valid');
  System.exit(0);
} catch (error) {
  if (GLib.file_test(path, GLib.FileTest.EXISTS)) GLib.unlink(path);
  printerr(String(error));
  printerr(error.stack ?? error.message);
  System.exit(1);
}

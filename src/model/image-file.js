import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

const FORMAT_LABELS = Object.freeze({
  bmp: 'BMP',
  gif: 'GIF',
  jpeg: 'JPEG',
  png: 'PNG',
  tiff: 'TIFF',
  webp: 'WebP',
});

export function imageFormatLabel(name) {
  const normalized = String(name ?? '').toLowerCase();
  return FORMAT_LABELS[normalized] ?? (normalized ? normalized.toUpperCase() : 'Image');
}

export function inspectImagePath(path) {
  const resolvedPath = String(path ?? '');
  if (!resolvedPath || !GLib.path_is_absolute(resolvedPath)) {
    throw new Error('Choose a local image file.');
  }

  const file = Gio.File.new_for_path(resolvedPath);
  if (!file.query_exists(null)) {
    throw new Error('The selected image no longer exists.');
  }

  const [format, width, height] = GdkPixbuf.Pixbuf.get_file_info(resolvedPath);
  if (!format || width <= 0 || height <= 0) {
    throw new Error('The selected file is not a supported image.');
  }

  return {
    basename: GLib.path_get_basename(resolvedPath),
    format: imageFormatLabel(format.get_name()),
    height,
    path: resolvedPath,
    width,
  };
}

export function inspectImageFile(file) {
  const path = file?.get_path?.() ?? '';
  return inspectImagePath(path);
}

import GLib from 'gi://GLib?version=2.0';

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  'bmp',
  'gif',
  'jpeg',
  'jpg',
  'png',
  'tif',
  'tiff',
  'webp',
]);

const SUPPORTED_VIDEO_EXTENSIONS = new Set([
  '3gp',
  'asf',
  'avi',
  'm4v',
  'mkv',
  'mov',
  'mp4',
  'mpeg',
  'mpg',
  'ogv',
  'webm',
  'wmv',
]);

function extensionForName(name) {
  const basename = String(name ?? '');
  const dot = basename.lastIndexOf('.');
  if (dot <= 0 || dot === basename.length - 1) return '';
  return basename.slice(dot + 1).toLowerCase();
}

export function screenshotFolderPath(picturesDirectory = null) {
  const pictures =
    picturesDirectory ||
    GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) ||
    GLib.build_filenamev([GLib.get_home_dir(), 'Pictures']);
  return GLib.build_filenamev([pictures, 'Screenshots']);
}

export function screencastFolderPath(videosDirectory = null) {
  const videos =
    videosDirectory ||
    GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_VIDEOS) ||
    GLib.build_filenamev([GLib.get_home_dir(), 'Videos']);
  return GLib.build_filenamev([videos, 'Screencasts']);
}

export function isSupportedImageName(name) {
  return SUPPORTED_IMAGE_EXTENSIONS.has(extensionForName(name));
}

export function isSupportedVideoName(name) {
  return SUPPORTED_VIDEO_EXTENSIONS.has(extensionForName(name));
}

export function isSupportedMediaName(name) {
  return isSupportedImageName(name) || isSupportedVideoName(name);
}

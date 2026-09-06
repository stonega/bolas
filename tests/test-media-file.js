import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import System from 'system';

import { inspectMediaPath, videoFormatLabel } from '../src/model/media-file.js';
import { WORKSPACE_MAGIC_TEXT } from '../src/services/workspace-file.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const token = GLib.uuid_string_random();
const imagePath = GLib.build_filenamev([GLib.get_tmp_dir(), `bolas-media-${token}.png`]);
const videoPath = GLib.build_filenamev([GLib.get_tmp_dir(), `bolas-media-${token}.mp4`]);
const textPath = GLib.build_filenamev([GLib.get_tmp_dir(), `bolas-media-${token}.txt`]);
const workspacePath = GLib.build_filenamev([GLib.get_tmp_dir(), `bolas-media-${token}.bolas`]);
const temporaryPaths = [imagePath, videoPath, textPath, workspacePath];
let exitCode = 0;

try {
  const pixbuf = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 32, 24);
  pixbuf.fill(0x3d6fb4ff);
  const [pngSaved, pngBytes] = pixbuf.save_to_bufferv('png', [], []);
  assert(pngSaved, 'the PNG fixture could not be encoded');
  GLib.file_set_contents(imagePath, pngBytes);

  const mp4Header = new Uint8Array([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31,
  ]);
  GLib.file_set_contents(videoPath, mp4Header);
  GLib.file_set_contents(textPath, 'not media');
  GLib.file_set_contents(workspacePath, new TextEncoder().encode(WORKSPACE_MAGIC_TEXT));

  const image = inspectMediaPath(imagePath);
  assert(image.kind === 'image', 'PNG files must be identified as images');
  assert(image.width === 32 && image.height === 24, 'image dimensions are incorrect');

  const video = inspectMediaPath(videoPath);
  assert(video.kind === 'video', 'MP4 files must be identified as videos');
  assert(video.format === 'MP4', 'the MP4 format label is incorrect');
  assert(video.mimeType === 'video/mp4', 'the MP4 MIME type is incorrect');
  assert(
    videoFormatLabel('video/x-matroska', 'clip.mkv') === 'Matroska',
    'the MKV label is incorrect',
  );

  const workspace = inspectMediaPath(workspacePath);
  assert(workspace.kind === 'workspace', '.bolas files must be identified as workspaces');
  assert(workspace.format === 'Bolas Workspace', 'the workspace format label is incorrect');

  let rejectedText = false;
  try {
    inspectMediaPath(textPath);
  } catch {
    rejectedText = true;
  }
  assert(rejectedText, 'non-media files must be rejected');

  let rejectedRelative = false;
  try {
    inspectMediaPath('relative.mp4');
  } catch {
    rejectedRelative = true;
  }
  assert(rejectedRelative, 'relative media paths must be rejected');

  print('media file inspection is valid');
} catch (error) {
  printerr(String(error));
  printerr(error.stack ?? error.message);
  exitCode = 1;
} finally {
  for (const path of temporaryPaths) {
    if (GLib.file_test(path, GLib.FileTest.EXISTS)) GLib.unlink(path);
  }
}

System.exit(exitCode);

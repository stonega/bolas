import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Gst from 'gi://Gst?version=1.0';
import GstPbutils from 'gi://GstPbutils?version=1.0';
import System from 'system';

import { exportEditedVideo } from '../src/services/video-export.js';

function localPath(argument) {
  return GLib.canonicalize_filename(String(argument ?? ''), GLib.get_current_dir());
}

try {
  if (ARGV.length < 2) {
    throw new Error(
      'Usage: gjs -m examples/edit-video.js INPUT OUTPUT [START_SECONDS] [END_SECONDS] [--mute] [--share]',
    );
  }

  Gst.init(null);
  const sourcePath = localPath(ARGV[0]);
  const targetPath = localPath(ARGV[1]);
  const discoverer = GstPbutils.Discoverer.new(5 * Gst.SECOND);
  const info = discoverer.discover_uri(Gio.File.new_for_path(sourcePath).get_uri());
  const durationUs = Math.round(Number(info.get_duration()) / 1000);
  const videoStream = info.get_video_streams()[0];
  const startSeconds = Number(ARGV[2] ?? 0);
  const endSeconds = Number(ARGV[3] ?? durationUs / 1_000_000);
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds))
    throw new Error('Start and end must be times in seconds.');

  const exported = await exportEditedVideo({
    durationUs,
    edit: {
      muted: ARGV.includes('--mute'),
      shareEnabled: ARGV.includes('--share'),
      trimEndUs: Math.round(endSeconds * 1_000_000),
      trimStartUs: Math.round(startSeconds * 1_000_000),
    },
    sourceHeight: videoStream?.get_height() ?? 0,
    sourcePath,
    sourceWidth: videoStream?.get_width() ?? 0,
    targetPath,
  });
  print(exported.path);
  System.exit(0);
} catch (error) {
  printerr(error.message);
  System.exit(1);
}

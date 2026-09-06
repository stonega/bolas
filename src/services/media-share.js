import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

export function shareMedia(parent, mediaPath) {
  const file = Gio.File.new_for_path(String(mediaPath ?? ''));
  if (!file.query_exists(null)) {
    return Promise.reject(new Error('The file is no longer available.'));
  }

  const launcher = new Gtk.FileLauncher({ always_ask: true, file });
  return new Promise((resolve, reject) => {
    launcher.launch(parent, null, (_launcher, result) => {
      try {
        launcher.launch_finish(result);
        resolve(true);
      } catch (error) {
        reject(error);
      }
    });
  });
}

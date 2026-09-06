import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import { APP_ID } from '../config.js';

const PORTAL_BUS_NAME = 'org.freedesktop.portal.Desktop';
const PORTAL_OBJECT_PATH = '/org/freedesktop/portal/desktop';
const REQUEST_INTERFACE = 'org.freedesktop.portal.Request';
const SCREENSHOT_INTERFACE = 'org.freedesktop.portal.Screenshot';
const SCREENSHOT_TIMEOUT_MS = 5 * 60 * 1000;

export function screenshotRequestPath(uniqueName, token) {
  const sender = String(uniqueName ?? '')
    .replace(/^:/, '')
    .replaceAll('.', '_');
  const normalizedToken = String(token ?? '').replace(/[^A-Za-z0-9_]/g, '_');
  if (!sender || !normalizedToken) throw new Error('Could not prepare the screenshot request.');
  return `/org/freedesktop/portal/desktop/request/${sender}/${normalizedToken}`;
}

export function screenshotUriFromResponse(response, results = {}) {
  if (response === 1) return null;
  if (response !== 0)
    throw new Error('The screenshot request was denied or could not be completed.');

  const uri = String(results.uri?.unpack?.() ?? results.uri ?? '').trim();
  if (!uri) throw new Error('The screenshot portal did not return an image.');
  return uri;
}

export function managedScreenshotDirectory(
  cacheDirectory = GLib.get_user_cache_dir(),
  appId = APP_ID,
) {
  return GLib.build_filenamev([cacheDirectory, appId, 'captured-screenshots']);
}

export function managedScreenshotPath(
  cacheDirectory = GLib.get_user_cache_dir(),
  appId = APP_ID,
  identifier = GLib.uuid_string_random(),
) {
  const safeIdentifier = String(identifier).replace(/[^A-Za-z0-9_-]/g, '-');
  return GLib.build_filenamev([
    managedScreenshotDirectory(cacheDirectory, appId),
    `screenshot-${safeIdentifier}.png`,
  ]);
}

function closeRequest(connection, requestPath) {
  connection.call(
    PORTAL_BUS_NAME,
    requestPath,
    REQUEST_INTERFACE,
    'Close',
    null,
    null,
    Gio.DBusCallFlags.NONE,
    5000,
    null,
    null,
  );
}

export function requestScreenshot({ cancellable = null, parentWindow = '' } = {}) {
  const connection = Gio.DBus.session;
  const token = `bolas_${GLib.uuid_string_random().replaceAll('-', '_')}`;
  let requestPath = screenshotRequestPath(connection.get_unique_name(), token);

  return new Promise((resolve, reject) => {
    let cancellationSignalId = 0;
    let responseSignalId = 0;
    let settled = false;
    let timeoutSourceId = 0;

    const cleanup = () => {
      if (responseSignalId) connection.signal_unsubscribe(responseSignalId);
      if (cancellationSignalId) cancellable?.disconnect(cancellationSignalId);
      if (timeoutSourceId) GLib.source_remove(timeoutSourceId);
      cancellationSignalId = 0;
      responseSignalId = 0;
      timeoutSourceId = 0;
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const subscribe = (path) => {
      responseSignalId = connection.signal_subscribe(
        PORTAL_BUS_NAME,
        REQUEST_INTERFACE,
        'Response',
        path,
        null,
        Gio.DBusSignalFlags.NONE,
        (_connection, _sender, _path, _interface, _signal, parameters) => {
          try {
            const [response, results] = parameters.deepUnpack();
            finish(resolve, screenshotUriFromResponse(response, results));
          } catch (error) {
            finish(reject, error);
          }
        },
      );
    };

    subscribe(requestPath);
    if (cancellable) {
      cancellationSignalId = cancellable.connect(() => {
        cancellationSignalId = 0;
        closeRequest(connection, requestPath);
        finish(resolve, null);
      });
    }
    timeoutSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SCREENSHOT_TIMEOUT_MS, () => {
      timeoutSourceId = 0;
      closeRequest(connection, requestPath);
      finish(reject, new Error('The screenshot request timed out.'));
      return GLib.SOURCE_REMOVE;
    });

    const options = {
      handle_token: new GLib.Variant('s', token),
      interactive: new GLib.Variant('b', true),
      modal: new GLib.Variant('b', true),
    };
    connection.call(
      PORTAL_BUS_NAME,
      PORTAL_OBJECT_PATH,
      SCREENSHOT_INTERFACE,
      'Screenshot',
      new GLib.Variant('(sa{sv})', [String(parentWindow ?? ''), options]),
      new GLib.VariantType('(o)'),
      Gio.DBusCallFlags.NONE,
      -1,
      cancellable,
      (source, result) => {
        if (settled) return;
        try {
          const [returnedPath] = source.call_finish(result).deepUnpack();
          if (returnedPath === requestPath) return;
          connection.signal_unsubscribe(responseSignalId);
          responseSignalId = 0;
          requestPath = returnedPath;
          subscribe(requestPath);
        } catch (error) {
          finish(reject, error);
        }
      },
    );
  });
}

export function persistScreenshot(uri, { appId = APP_ID, cacheDirectory, cancellable } = {}) {
  const directory = managedScreenshotDirectory(cacheDirectory, appId);
  if (GLib.mkdir_with_parents(directory, 0o700) !== 0)
    return Promise.reject(new Error('Could not create the private screenshot directory.'));
  if (GLib.chmod(directory, 0o700) !== 0)
    return Promise.reject(new Error('Could not secure the private screenshot directory.'));

  const source = Gio.File.new_for_uri(String(uri ?? ''));
  const outputPath = managedScreenshotPath(cacheDirectory, appId);
  const destination = Gio.File.new_for_path(outputPath);
  return new Promise((resolve, reject) => {
    source.copy_async(
      destination,
      Gio.FileCopyFlags.NONE,
      GLib.PRIORITY_DEFAULT,
      cancellable ?? null,
      null,
      (file, result) => {
        try {
          file.copy_finish(result);
          if (GLib.chmod(outputPath, 0o600) !== 0)
            throw new Error('Could not secure the captured screenshot.');
          resolve(outputPath);
        } catch (error) {
          if (destination.query_exists(null)) destination.delete(null);
          reject(error);
        }
      },
    );
  });
}

export async function captureScreenshot(options = {}) {
  const uri = await requestScreenshot(options);
  if (!uri) return null;
  return persistScreenshot(uri, options);
}

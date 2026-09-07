import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

export function exportCancellationError() {
  const error = new Error('Export was cancelled.');
  error.cancelled = true;
  return error;
}

export function checkExportCancellation(cancellable) {
  if (cancellable?.is_cancelled()) throw exportCancellationError();
}

async function readLines(stream, onLine) {
  const input = new Gio.DataInputStream({ base_stream: stream });
  try {
    while (true) {
      const line = await new Promise((resolve, reject) => {
        input.read_line_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
          try {
            resolve(source.read_line_finish_utf8(result)[0]);
          } catch (error) {
            reject(error);
          }
        });
      });
      if (line === null) break;
      onLine?.(line);
    }
  } finally {
    input.close(null);
  }
}

async function readErrorTail(stream) {
  let tail = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const bytes = await new Promise((resolve, reject) => {
        stream.read_bytes_async(4096, GLib.PRIORITY_DEFAULT, null, (source, result) => {
          try {
            resolve(source.read_bytes_finish(result).toArray());
          } catch (error) {
            reject(error);
          }
        });
      });
      if (!bytes.length) return tail;
      tail = (tail + decoder.decode(bytes)).slice(-2048);
    }
  } finally {
    stream.close(null);
  }
}

export async function runExportProcess(
  args,
  {
    cancellable = null,
    onLine = null,
    unavailableMessage = 'The exporter is unavailable.',
    failureMessage = 'Export failed.',
  } = {},
) {
  checkExportCancellation(cancellable);
  let process;
  try {
    process = Gio.Subprocess.new(
      args,
      Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    );
  } catch {
    throw new Error(unavailableMessage);
  }
  const stop = () => {
    try {
      process.force_exit();
    } catch {
      // The process may already have exited.
    }
  };
  const cancelId = cancellable?.connect(stop) ?? 0;
  const guard = (promise) =>
    promise.catch((error) => {
      stop();
      throw error;
    });
  try {
    // Drain both pipes while waiting. Cancellation kills the child, then reaps it
    // before callers remove temporary files. Diagnostics stay bounded in memory.
    const results = await Promise.allSettled([
      guard(readLines(process.get_stdout_pipe(), onLine)),
      guard(readErrorTail(process.get_stderr_pipe())),
      new Promise((resolve, reject) => {
        process.wait_async(null, (source, result) => {
          try {
            resolve(source.wait_finish(result));
          } catch (error) {
            reject(error);
          }
        });
      }),
    ]);
    checkExportCancellation(cancellable);
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
    }
    if (!process.get_successful()) {
      const detail = results[1].value.trim().split('\n').slice(-4).join(' ');
      throw new Error(detail ? `${failureMessage} ${detail}` : failureMessage);
    }
  } finally {
    if (cancelId) cancellable.disconnect(cancelId);
  }
}

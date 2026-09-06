import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import { normalizeImageWorkspace } from '../editor/workspace.js';
import { normalizeVideoWorkspace } from '../video/workspace.js';

export const WORKSPACE_MAGIC_TEXT = 'BOLASWS\0';
export const MAX_WORKSPACE_FILE_BYTES = 192 * 1024 * 1024;
export const MAX_WORKSPACE_PAYLOAD_BYTES = 256 * 1024 * 1024;

const MAGIC = new TextEncoder().encode(WORKSPACE_MAGIC_TEXT);
const CHUNK_SIZE = 64 * 1024;

function requireLocalPath(path) {
  const normalized = String(path ?? '').trim();
  if (!normalized || !GLib.path_is_absolute(normalized))
    throw new Error('Choose a local Bolas workspace file.');
  if (normalized.includes('\0')) throw new Error('The workspace path is invalid.');
  return normalized;
}

function bytesArray(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof GLib.Bytes) return value.toArray();
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('Workspace file contents must be bytes.');
}

function concatenate(parts, totalLength) {
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function gzip(bytes) {
  const memory = Gio.MemoryOutputStream.new_resizable();
  const compressor = new Gio.ZlibCompressor({
    format: Gio.ZlibCompressorFormat.GZIP,
    level: 6,
  });
  const output = new Gio.ConverterOutputStream({ base_stream: memory, converter: compressor });

  try {
    output.write_all(bytes, null);
    output.close(null);
    return memory.steal_as_bytes().toArray();
  } finally {
    try {
      if (!output.is_closed()) output.close(null);
    } catch {
      // Preserve the compression error.
    }
  }
}

function gunzip(bytes) {
  const input = Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(bytes));
  const decompressor = new Gio.ZlibDecompressor({ format: Gio.ZlibCompressorFormat.GZIP });
  const stream = new Gio.ConverterInputStream({ base_stream: input, converter: decompressor });
  const parts = [];
  let totalLength = 0;

  try {
    while (true) {
      const part = stream.read_bytes(CHUNK_SIZE, null).toArray();
      if (part.length === 0) break;
      totalLength += part.length;
      if (totalLength > MAX_WORKSPACE_PAYLOAD_BYTES)
        throw new Error('The workspace expands beyond the safe size limit.');
      parts.push(part);
    }
  } catch (error) {
    if (String(error.message ?? '').includes('safe size limit')) throw error;
    throw new Error(`The workspace payload is damaged: ${error.message}`);
  } finally {
    try {
      stream.close(null);
    } catch {
      // The converter may already be closed after malformed input.
    }
  }

  return concatenate(parts, totalLength);
}

function hasMagic(bytes) {
  if (bytes.length < MAGIC.length) return false;
  return MAGIC.every((byte, index) => bytes[index] === byte);
}

function normalizeWorkspace(workspace) {
  if (workspace?.kind === 'image') return normalizeImageWorkspace(workspace);
  if (workspace?.kind === 'video') return normalizeVideoWorkspace(workspace);
  throw new Error('This Bolas workspace uses an unsupported project kind.');
}

export function encodeWorkspace(workspace) {
  const json = JSON.stringify(normalizeWorkspace(workspace));
  const payload = new TextEncoder().encode(json);
  if (payload.length > MAX_WORKSPACE_PAYLOAD_BYTES)
    throw new Error('The workspace is too large to save safely.');

  const compressed = gzip(payload);
  const encoded = concatenate([MAGIC, compressed], MAGIC.length + compressed.length);
  if (encoded.length > MAX_WORKSPACE_FILE_BYTES)
    throw new Error('The compressed workspace is too large to save safely.');
  return encoded;
}

export function decodeWorkspace(value) {
  const bytes = bytesArray(value);
  if (bytes.length > MAX_WORKSPACE_FILE_BYTES)
    throw new Error('The workspace file is too large to open safely.');
  if (!hasMagic(bytes)) throw new Error('The selected file is not a Bolas workspace.');

  const payload = gunzip(bytes.slice(MAGIC.length));
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
  } catch (error) {
    throw new Error(`The workspace manifest is damaged: ${error.message}`);
  }
  return normalizeWorkspace(parsed);
}

export function encodeImageWorkspace(workspace) {
  return encodeWorkspace(normalizeImageWorkspace(workspace));
}

export function decodeImageWorkspace(value) {
  const workspace = decodeWorkspace(value);
  if (workspace.kind !== 'image') throw new Error('This Bolas workspace is not an image project.');
  return workspace;
}

export function hasWorkspaceMagic(path) {
  const localPath = requireLocalPath(path);
  const stream = Gio.File.new_for_path(localPath).read(null);
  try {
    return hasMagic(stream.read_bytes(MAGIC.length, null).toArray());
  } finally {
    stream.close(null);
  }
}

function fileEtag(file) {
  return file
    .query_info(Gio.FILE_ATTRIBUTE_ETAG_VALUE, Gio.FileQueryInfoFlags.NONE, null)
    .get_etag();
}

function secureWorkspaceFiles(path) {
  for (const candidate of [path, `${path}~`]) {
    if (!GLib.file_test(candidate, GLib.FileTest.EXISTS)) continue;
    if (GLib.chmod(candidate, 0o600) !== 0)
      throw new Error('The saved workspace could not be restricted to private permissions.');
  }
}

function replaceFileBytes(file, bytes, options = {}) {
  return new Promise((resolve, reject) => {
    file.replace_contents_bytes_async(
      new GLib.Bytes(bytes),
      options.etag ?? null,
      Boolean(options.backup),
      Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION,
      options.cancellable ?? null,
      (source, result) => {
        try {
          const [success, etag] = source.replace_contents_finish(result);
          if (!success) throw new Error('The workspace could not be written.');
          resolve(etag ?? fileEtag(source));
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}

export function readWorkspace(path, { cancellable = null } = {}) {
  const localPath = requireLocalPath(path);
  const file = Gio.File.new_for_path(localPath);

  return new Promise((resolve, reject) => {
    file.load_bytes_async(cancellable, (source, result) => {
      try {
        const [bytes, etag] = source.load_bytes_finish(result);
        resolve({ etag, path: localPath, workspace: decodeWorkspace(bytes) });
      } catch (error) {
        reject(error);
      }
    });
  });
}

export async function writeWorkspace(
  path,
  workspace,
  { cancellable = null, etag = null, replaceExisting = false } = {},
) {
  const localPath = requireLocalPath(path);
  const target = Gio.File.new_for_path(localPath);
  const bytes = encodeWorkspace(workspace);

  if (replaceExisting) {
    if (!target.query_exists(cancellable))
      throw new Error('The workspace was moved or deleted before it could be saved.');
    const expectedEtag = etag ?? fileEtag(target);
    await replaceFileBytes(target, bytes, {
      backup: true,
      cancellable,
      etag: expectedEtag,
    });
    secureWorkspaceFiles(localPath);
    return { etag: fileEtag(target), path: localPath };
  }

  if (target.query_exists(cancellable))
    throw new Error('A file with that name already exists. Choose a new workspace name.');

  const directory = GLib.path_get_dirname(localPath);
  if (GLib.mkdir_with_parents(directory, 0o700) !== 0)
    throw new Error('The workspace directory could not be created.');
  const temporaryPath = GLib.build_filenamev([
    directory,
    `.${GLib.path_get_basename(localPath)}.${GLib.uuid_string_random()}.tmp`,
  ]);
  const temporary = Gio.File.new_for_path(temporaryPath);

  try {
    await replaceFileBytes(temporary, bytes, { cancellable });
    temporary.move(target, Gio.FileCopyFlags.NONE, cancellable, null);
    secureWorkspaceFiles(localPath);
    return { etag: fileEtag(target), path: localPath };
  } finally {
    if (temporary.query_exists(null)) {
      try {
        temporary.delete(null);
      } catch {
        // The successful atomic move already removed the temporary path.
      }
    }
  }
}

export async function readImageWorkspace(path, options = {}) {
  const loaded = await readWorkspace(path, options);
  if (loaded.workspace.kind !== 'image')
    throw new Error('This Bolas workspace is not an image project.');
  return loaded;
}

export function writeImageWorkspace(path, workspace, options = {}) {
  return writeWorkspace(path, normalizeImageWorkspace(workspace), options);
}

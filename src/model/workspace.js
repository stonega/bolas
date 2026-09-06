import GLib from 'gi://GLib?version=2.0';

export const WORKSPACE_SCHEMA = 'io.github.stonega.Bolas.workspace';
export const MAX_WORKSPACE_ASSET_BYTES = 128 * 1024 * 1024;

export function workspaceObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value;
}

export function workspacePositiveInteger(value, label) {
  const number = Math.round(Number(value));
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${label} is invalid.`);
  return number;
}

export function workspaceCleanString(value, fallback = '', maximumLength = 1024) {
  const normalized = String(value ?? fallback)
    .replaceAll('\0', '')
    .trim();
  return normalized.slice(0, maximumLength) || fallback;
}

function bytesArray(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof GLib.Bytes) return value.toArray();
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('Workspace asset data must be bytes.');
}

function checksum(bytes) {
  return GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, new GLib.Bytes(bytes));
}

export function createWorkspaceAsset(bytes, options = {}) {
  const data = bytesArray(bytes);
  if (data.length < 1) throw new Error('Workspace assets cannot be empty.');
  if (data.length > MAX_WORKSPACE_ASSET_BYTES)
    throw new Error('The workspace source media is too large to save safely.');

  return {
    encoding: 'base64',
    mediaType: workspaceCleanString(options.mediaType, 'application/octet-stream', 255),
    sha256: checksum(data),
    size: data.length,
    data: GLib.base64_encode(data),
  };
}

export function decodeWorkspaceAsset(value, label = 'Workspace asset') {
  const asset = workspaceObject(value, label);
  if (asset.encoding !== 'base64') throw new Error(`${label} uses an unsupported encoding.`);

  const size = workspacePositiveInteger(asset.size, `${label} size`);
  if (size > MAX_WORKSPACE_ASSET_BYTES) throw new Error(`${label} is too large to open safely.`);
  if (typeof asset.data !== 'string' || asset.data.length > MAX_WORKSPACE_ASSET_BYTES * 2)
    throw new Error(`${label} data is invalid.`);

  let bytes;
  try {
    bytes = GLib.base64_decode(asset.data);
  } catch {
    throw new Error(`${label} is not valid base64 data.`);
  }

  if (bytes.length !== size) throw new Error(`${label} size does not match its manifest.`);
  const expectedChecksum = workspaceCleanString(asset.sha256, '', 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedChecksum) || checksum(bytes) !== expectedChecksum)
    throw new Error(`${label} checksum verification failed.`);

  return bytes;
}

export function normalizeWorkspaceAsset(value, label) {
  const bytes = decodeWorkspaceAsset(value, label);
  return {
    encoding: 'base64',
    mediaType: workspaceCleanString(value.mediaType, 'application/octet-stream', 255),
    sha256: workspaceCleanString(value.sha256, '', 64).toLowerCase(),
    size: bytes.length,
    data: value.data,
  };
}

import { APP_VERSION } from '../config.js';
import {
  createWorkspaceAsset,
  decodeWorkspaceAsset,
  normalizeWorkspaceAsset,
  WORKSPACE_SCHEMA,
  workspaceCleanString,
  workspaceObject,
  workspacePositiveInteger,
} from '../model/workspace.js';
import { normalizeVideoEdit } from './edit.js';

export const VIDEO_WORKSPACE_SCHEMA = WORKSPACE_SCHEMA;
export const VIDEO_WORKSPACE_VERSION = 1;

function normalizeSource(value) {
  const source = workspaceObject(value, 'Workspace source');
  const asset = normalizeWorkspaceAsset(source.asset, 'Workspace source video');
  const originalMimeType = workspaceCleanString(
    source.originalMimeType,
    asset.mediaType,
    255,
  ).toLowerCase();
  if (!originalMimeType.startsWith('video/') || !asset.mediaType.toLowerCase().startsWith('video/'))
    throw new Error('The workspace source asset is not a video.');

  return {
    asset,
    displayName: workspaceCleanString(source.displayName, 'Video', 255),
    durationUs: workspacePositiveInteger(source.durationUs, 'Workspace source duration'),
    height: workspacePositiveInteger(source.height, 'Workspace source height'),
    originalMimeType,
    width: workspacePositiveInteger(source.width, 'Workspace source width'),
  };
}

function normalizeSession(value, durationUs) {
  const session =
    value && typeof value === 'object' && !Array.isArray(value) ? value : Object.create(null);
  const timestamp = Math.round(Number(session.timestampUs));
  return {
    timestampUs: Number.isSafeInteger(timestamp) ? Math.min(durationUs, Math.max(0, timestamp)) : 0,
  };
}

export function normalizeVideoWorkspace(value) {
  const workspace = workspaceObject(value, 'Workspace');
  if (workspace.schema !== VIDEO_WORKSPACE_SCHEMA)
    throw new Error('The selected file is not a Bolas workspace.');

  const version = workspacePositiveInteger(workspace.version, 'Workspace version');
  if (version > VIDEO_WORKSPACE_VERSION)
    throw new Error('This workspace was created by a newer version of Bolas.');
  if (version < 1) throw new Error('This workspace version is not supported.');
  if (workspace.kind !== 'video') throw new Error('This Bolas workspace is not a video project.');

  const source = normalizeSource(workspace.source);
  return {
    schema: VIDEO_WORKSPACE_SCHEMA,
    version: VIDEO_WORKSPACE_VERSION,
    kind: 'video',
    createdWith: workspaceCleanString(workspace.createdWith, APP_VERSION, 64),
    source,
    edit: normalizeVideoEdit(workspace.edit, source.durationUs),
    session: normalizeSession(workspace.session, source.durationUs),
  };
}

export function createVideoWorkspace({
  edit = {},
  session = {},
  sourceBytes,
  sourceMetadata = {},
}) {
  const durationUs = workspacePositiveInteger(
    sourceMetadata.durationUs,
    'Workspace source duration',
  );
  const originalMimeType = workspaceCleanString(
    sourceMetadata.originalMimeType,
    'video/webm',
    255,
  ).toLowerCase();

  return normalizeVideoWorkspace({
    schema: VIDEO_WORKSPACE_SCHEMA,
    version: VIDEO_WORKSPACE_VERSION,
    kind: 'video',
    createdWith: APP_VERSION,
    source: {
      asset: createWorkspaceAsset(sourceBytes, { mediaType: originalMimeType }),
      displayName: workspaceCleanString(sourceMetadata.displayName, 'Video', 255),
      durationUs,
      height: workspacePositiveInteger(sourceMetadata.height, 'Workspace source height'),
      originalMimeType,
      width: workspacePositiveInteger(sourceMetadata.width, 'Workspace source width'),
    },
    edit,
    session,
  });
}

export function videoWorkspaceSourceBytes(workspace) {
  const source = workspaceObject(workspace?.source, 'Workspace source');
  return decodeWorkspaceAsset(source.asset, 'Workspace source video');
}

export function cloneVideoWorkspace(workspace) {
  return JSON.parse(JSON.stringify(normalizeVideoWorkspace(workspace)));
}

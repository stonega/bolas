import { APP_VERSION } from '../config.js';
import {
  createWorkspaceAsset,
  decodeWorkspaceAsset,
  MAX_WORKSPACE_ASSET_BYTES,
  normalizeWorkspaceAsset,
  WORKSPACE_SCHEMA,
  workspaceCleanString,
  workspaceObject,
  workspacePositiveInteger,
} from '../model/workspace.js';
import { normalizeSharePreferences } from '../preferences.js';
import { ImageDocument, normalizeCropRect } from './document.js';

export const IMAGE_WORKSPACE_SCHEMA = WORKSPACE_SCHEMA;
export const IMAGE_WORKSPACE_VERSION = 1;
export { createWorkspaceAsset, decodeWorkspaceAsset, MAX_WORKSPACE_ASSET_BYTES };

const SESSION_MODES = Object.freeze(['view', 'draw', 'crop']);
const SESSION_LAYERS = Object.freeze(['image', 'canvas']);
const SESSION_TOOLS = Object.freeze([
  'select',
  'pencil',
  'line',
  'arrow',
  'rectangle',
  'ellipse',
  'text',
]);
const SESSION_SIDEBARS = Object.freeze(['background', 'draw', 'crop']);

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

const plainObject = workspaceObject;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedNumber(value, minimum, maximum, fallback) {
  return Math.min(maximum, Math.max(minimum, finiteNumber(value, fallback)));
}

const positiveInteger = workspacePositiveInteger;
const cleanString = workspaceCleanString;

function choice(value, allowed, fallback) {
  const candidate = String(value ?? '');
  return allowed.includes(candidate) ? candidate : fallback;
}

function normalizeAsset(value, label) {
  return normalizeWorkspaceAsset(value, label);
}

function normalizeSource(value) {
  const source = plainObject(value, 'Workspace source');
  return {
    asset: normalizeAsset(source.asset, 'Workspace source image'),
    displayName: cleanString(source.displayName, 'Image', 255),
    originalMimeType: cleanString(source.originalMimeType, 'image/png', 255),
    width: positiveInteger(source.width, 'Workspace source width'),
    height: positiveInteger(source.height, 'Workspace source height'),
  };
}

function canonicalDocumentSnapshot(value, label) {
  try {
    return ImageDocument.fromWorkspaceSnapshot(value).toWorkspaceSnapshot();
  } catch (error) {
    throw new Error(`${label} is invalid: ${error.message}`);
  }
}

function normalizeComposition(value, canvasSnapshot) {
  const composition = plainObject(value, 'Workspace composition');
  const backgroundEnabled = Boolean(composition.backgroundEnabled);
  if (backgroundEnabled && !canvasSnapshot)
    throw new Error('A workspace with a background requires a canvas document.');

  return {
    backgroundEnabled,
    settings: normalizeSharePreferences(composition.settings),
  };
}

function normalizeSession(value = {}) {
  const session = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const cropRect = normalizeCropRect(session.cropRect ?? { x: 0, y: 0, width: 1, height: 1 });
  const sidebarKind = SESSION_SIDEBARS.includes(session.sidebarKind) ? session.sidebarKind : null;

  return {
    activeLayer: choice(session.activeLayer, SESSION_LAYERS, 'image'),
    cropPortrait: Boolean(session.cropPortrait),
    cropRatioId: cleanString(session.cropRatioId, 'free', 32),
    cropRect,
    fillColor: cleanString(session.fillColor, '#e52f36', 64),
    fillEnabled: Boolean(session.fillEnabled),
    fit: session.fit !== false,
    fontFamily: cleanString(session.fontFamily, 'Sans', 255),
    fontSize: boundedNumber(session.fontSize, 0.001, 1, 0.06),
    mode: choice(session.mode, SESSION_MODES, 'view'),
    opacity: boundedNumber(session.opacity, 0, 1, 1),
    panX: boundedNumber(session.panX, -1000000, 1000000, 0),
    panY: boundedNumber(session.panY, -1000000, 1000000, 0),
    sidebarKind,
    strokeColor: cleanString(session.strokeColor, '#e52f36', 64),
    strokeWidth: boundedNumber(session.strokeWidth, 0.0001, 1, 0.006),
    text: cleanString(session.text, 'Text', 10000),
    tool: choice(session.tool, SESSION_TOOLS, 'select'),
    zoomFactor: boundedNumber(session.zoomFactor, 0.1, 12, 1),
  };
}

export function normalizeImageWorkspace(value) {
  const workspace = plainObject(value, 'Workspace');
  if (workspace.schema !== IMAGE_WORKSPACE_SCHEMA)
    throw new Error('The selected file is not a Bolas workspace.');

  const version = positiveInteger(workspace.version, 'Workspace version');
  if (version > IMAGE_WORKSPACE_VERSION)
    throw new Error('This workspace was created by a newer version of Bolas.');
  if (version < 1) throw new Error('This workspace version is not supported.');
  if (workspace.kind !== 'image') throw new Error('This Bolas workspace is not an image project.');

  const documents = plainObject(workspace.documents, 'Workspace documents');
  const image = canonicalDocumentSnapshot(documents.image, 'Image document');
  const canvas = documents.canvas
    ? canonicalDocumentSnapshot(documents.canvas, 'Canvas document')
    : null;

  return {
    schema: IMAGE_WORKSPACE_SCHEMA,
    version: IMAGE_WORKSPACE_VERSION,
    kind: 'image',
    createdWith: cleanString(workspace.createdWith, APP_VERSION, 64),
    source: normalizeSource(workspace.source),
    documents: { image, canvas },
    composition: normalizeComposition(workspace.composition, canvas),
    session: normalizeSession(workspace.session),
  };
}

export function createImageWorkspace({
  canvasDocument = null,
  composition = {},
  imageDocument,
  session = {},
  sourceBytes,
  sourceMetadata = {},
}) {
  if (!(imageDocument instanceof ImageDocument))
    throw new TypeError('An image document is required to create a workspace.');

  return normalizeImageWorkspace({
    schema: IMAGE_WORKSPACE_SCHEMA,
    version: IMAGE_WORKSPACE_VERSION,
    kind: 'image',
    createdWith: APP_VERSION,
    source: {
      asset: createWorkspaceAsset(sourceBytes, { mediaType: 'image/png' }),
      displayName: cleanString(sourceMetadata.displayName, 'Image', 255),
      originalMimeType: cleanString(sourceMetadata.originalMimeType, 'image/png', 255),
      width: positiveInteger(sourceMetadata.width, 'Workspace source width'),
      height: positiveInteger(sourceMetadata.height, 'Workspace source height'),
    },
    documents: {
      image: imageDocument.toWorkspaceSnapshot(),
      canvas: canvasDocument?.toWorkspaceSnapshot?.() ?? null,
    },
    composition,
    session,
  });
}

export function workspaceSourceBytes(workspace) {
  const source = plainObject(workspace?.source, 'Workspace source');
  return decodeWorkspaceAsset(source.asset, 'Workspace source image');
}

export function cloneImageWorkspace(workspace) {
  return deepClone(normalizeImageWorkspace(workspace));
}

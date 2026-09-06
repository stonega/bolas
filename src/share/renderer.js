import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Cairo from 'cairo';

import { backgroundPreset, shareRatio } from './presets.js';

const APP_ID = 'io.github.stonega.Bolas';
const backgroundSurfaceCache = new Map();
const transparencyCache = new WeakMap();

export const SHARE_SHADOW_STYLES = Object.freeze([
  Object.freeze({
    blurRadius: 100,
    color: '#32325d',
    offsetX: 0,
    offsetY: 50,
    opacity: 0.25,
    spreadRadius: -20,
  }),
  Object.freeze({
    blurRadius: 60,
    color: '#000000',
    offsetX: 0,
    offsetY: 30,
    opacity: 0.3,
    spreadRadius: -30,
  }),
]);

// Keep each pass above ARGB32's 8-bit alpha precision so the falloff survives export.
const SHARE_SHADOW_BLUR_STEPS = 32;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value)));
}

function colorComponents(hexColor) {
  const value = String(hexColor ?? '#000000').replace(/^#/, '');
  const normalized =
    value.length === 3 ? [...value].map((part) => `${part}${part}`).join('') : value;
  const number = Number.parseInt(normalized, 16);

  if (!Number.isFinite(number) || normalized.length !== 6) return [0, 0, 0];
  return [((number >> 16) & 0xff) / 255, ((number >> 8) & 0xff) / 255, (number & 0xff) / 255];
}

function roundedRectangle(cr, x, y, width, height, radius) {
  const corner = Math.min(Math.max(0, radius), width / 2, height / 2);
  cr.newSubPath();
  cr.arc(x + width - corner, y + corner, corner, -Math.PI / 2, 0);
  cr.arc(x + width - corner, y + height - corner, corner, 0, Math.PI / 2);
  cr.arc(x + corner, y + height - corner, corner, Math.PI / 2, Math.PI);
  cr.arc(x + corner, y + corner, corner, Math.PI, (Math.PI * 3) / 2);
  cr.closePath();
}

/**
 * Return whether a pixbuf contains at least one non-opaque pixel.
 *
 * An alpha channel alone is not sufficient: PNG encoders commonly retain an
 * entirely opaque alpha channel. Cache the scan because the live preview may
 * repaint the same source many times while controls are adjusted.
 */
export function pixbufHasTransparency(pixbuf) {
  if (!pixbuf?.get_has_alpha?.()) return false;

  const cached = transparencyCache.get(pixbuf);
  if (cached !== undefined) return cached;

  const pixels = pixbuf.get_pixels();
  const channels = pixbuf.get_n_channels();
  const rowstride = pixbuf.get_rowstride();
  const width = pixbuf.get_width();
  const height = pixbuf.get_height();
  let transparent = false;

  for (let y = 0; y < height && !transparent; y++) {
    const row = y * rowstride;
    for (let x = 0; x < width; x++) {
      if (pixels[row + x * channels + channels - 1] < 255) {
        transparent = true;
        break;
      }
    }
  }

  transparencyCache.set(pixbuf, transparent);
  return transparent;
}

export function normalizeShareOptions(options = {}) {
  return {
    cornerRadius: clamp(options.cornerRadius ?? 42, 0, 96),
    padding: clamp(options.padding ?? 0.085, 0.035, 0.22),
    presetId: backgroundPreset(options.presetId).id,
    ratioId: shareRatio(options.ratioId).id,
    shadow: options.shadow !== false,
    shadowStrength: clamp(options.shadowStrength ?? 1, 0, 1),
  };
}

export function shareCanvasSize(ratioId = 'landscape') {
  const ratio = shareRatio(ratioId);
  return { height: ratio.height, width: ratio.width };
}

export function sharePreviewCanvasLayout(width, height, ratioId = 'landscape', inset = 0) {
  if (width <= 0 || height <= 0) throw new Error('The share preview size is invalid.');

  const { width: outputWidth, height: outputHeight } = shareCanvasSize(ratioId);
  const safeInset = Math.max(0, Number(inset) || 0);
  const scale = Math.min(
    Math.max(1, width - safeInset * 2) / outputWidth,
    Math.max(1, height - safeInset * 2) / outputHeight,
  );
  const canvasWidth = outputWidth * scale;
  const canvasHeight = outputHeight * scale;
  return {
    height: canvasHeight,
    scale,
    width: canvasWidth,
    x: (width - canvasWidth) / 2,
    y: (height - canvasHeight) / 2,
  };
}

export function sharePreviewSourceSize(width, height, maximumDimension = 1600) {
  const sourceWidth = Math.round(Number(width));
  const sourceHeight = Math.round(Number(height));
  const maximum = Math.round(Number(maximumDimension));
  if (sourceWidth <= 0 || sourceHeight <= 0)
    throw new Error('The share preview source size is invalid.');
  if (maximum <= 0) throw new Error('The share preview maximum size is invalid.');

  const largest = Math.max(sourceWidth, sourceHeight);
  if (largest <= maximum) return { height: sourceHeight, width: sourceWidth };

  const scale = maximum / largest;
  return {
    height: Math.max(1, Math.round(sourceHeight * scale)),
    width: Math.max(1, Math.round(sourceWidth * scale)),
  };
}

export function shareImageLayout(sourceWidth, sourceHeight, width, height, options = {}) {
  if (sourceWidth <= 0 || sourceHeight <= 0) throw new Error('The source image size is invalid.');
  if (width <= 0 || height <= 0) throw new Error('The share image size is invalid.');

  const normalized = normalizeShareOptions(options);
  const minimum = Math.min(width, height);
  const outputScale = minimum / Math.min(...Object.values(shareCanvasSize(normalized.ratioId)));
  const padding = normalized.padding * minimum;
  const availableWidth = width - padding * 2;
  const availableHeight = height - padding * 2;
  const scale = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
  const imageWidth = sourceWidth * scale;
  const imageHeight = sourceHeight * scale;
  return {
    height: imageHeight,
    normalized,
    outputScale,
    radius: normalized.cornerRadius * outputScale,
    scale,
    width: imageWidth,
    x: (width - imageWidth) / 2,
    y: (height - imageHeight) / 2,
  };
}

function loadBackgroundSurface(asset, swatch = false) {
  if (!asset) return null;
  const cacheKey = `${swatch ? 'swatch' : 'canvas'}:${asset}`;
  if (backgroundSurfaceCache.has(cacheKey)) return backgroundSurfaceCache.get(cacheKey);

  let file = Gio.File.new_for_uri(import.meta.url)
    .get_parent()
    .get_child('backgrounds');
  if (swatch) file = file.get_child('swatches');
  const path = file.get_child(asset).get_path();

  if (!path || !GLib.file_test(path, GLib.FileTest.EXISTS))
    throw new Error(`The bundled background${swatch ? ' swatch' : ''} ${asset} is missing.`);

  const surface = Cairo.ImageSurface.createFromPNG(path);
  backgroundSurfaceCache.set(cacheKey, surface);
  return surface;
}

function paintBackgroundSurface(cr, surface, width, height) {
  const sourceWidth = surface.getWidth();
  const sourceHeight = surface.getHeight();
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;

  cr.save();
  try {
    cr.translate((width - renderedWidth) / 2, (height - renderedHeight) / 2);
    cr.scale(scale, scale);
    cr.setSourceSurface(surface, 0, 0);
    cr.paint();
  } finally {
    cr.restore();
  }
}

function paintProceduralBackground(cr, width, height, preset) {
  const radians = (preset.angle * Math.PI) / 180;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians));
  const x0 = centerX - (Math.cos(radians) * radius) / 2;
  const y0 = centerY - (Math.sin(radians) * radius) / 2;
  const gradient = new Cairo.LinearGradient(x0, y0, centerX * 2 - x0, centerY * 2 - y0);

  preset.colors.forEach((color, index) => {
    const [red, green, blue] = colorComponents(color);
    gradient.addColorStopRGB(index / (preset.colors.length - 1), red, green, blue);
  });
  cr.setSource(gradient);
  cr.rectangle(0, 0, width, height);
  cr.fill();
  gradient.$dispose?.();
}

export function paintShareBackground(cr, width, height, presetId = 'aurora') {
  const preset = backgroundPreset(presetId);

  if (preset.asset) {
    paintBackgroundSurface(cr, loadBackgroundSurface(preset.asset), width, height);
    return;
  }

  paintProceduralBackground(cr, width, height, preset);
}

export function paintShareBackgroundSwatch(cr, width, height, presetId = 'aurora') {
  const preset = backgroundPreset(presetId);

  if (preset.asset) {
    paintBackgroundSurface(cr, loadBackgroundSurface(preset.asset, true), width, height);
    return;
  }

  paintProceduralBackground(cr, width, height, preset);
}

function paintShadowLayer(cr, x, y, width, height, radius, scale, style, strength) {
  const { blurRadius, color, offsetX, offsetY, opacity, spreadRadius } = style;
  const [red, green, blue] = colorComponents(color);
  const effectiveOpacity = opacity * strength;
  let accumulatedOpacity = 0;

  // Cairo has no native blur primitive. These nested silhouettes approximate the
  // smooth S-curve across a CSS blur radius while keeping preview and export exact.
  for (let step = 1; step <= SHARE_SHADOW_BLUR_STEPS; step++) {
    const progress = step / SHARE_SHADOW_BLUR_STEPS;
    const easedProgress = progress * progress * (3 - 2 * progress);
    const targetOpacity = effectiveOpacity * easedProgress;
    const layerOpacity = (targetOpacity - accumulatedOpacity) / (1 - accumulatedOpacity);
    const blurSpread = blurRadius * (1 - progress * 2);
    const spread = (spreadRadius + blurSpread) * scale;
    const shadowWidth = width + spread * 2;
    const shadowHeight = height + spread * 2;

    if (shadowWidth <= 0 || shadowHeight <= 0) break;

    roundedRectangle(
      cr,
      x + offsetX * scale - spread,
      y + offsetY * scale - spread,
      shadowWidth,
      shadowHeight,
      Math.max(0, radius + spread),
    );
    cr.setSourceRGBA(red, green, blue, layerOpacity);
    cr.fill();
    accumulatedOpacity = targetOpacity;
  }
}

function paintShadow(cr, x, y, width, height, radius, scale, strength) {
  // CSS paints the first declared shadow above the shadows that follow it.
  for (let index = SHARE_SHADOW_STYLES.length - 1; index >= 0; index--)
    paintShadowLayer(cr, x, y, width, height, radius, scale, SHARE_SHADOW_STYLES[index], strength);
}

function paintShareSource(
  cr,
  sourceWidth,
  sourceHeight,
  width,
  height,
  options,
  hasTransparency,
  paintSource,
) {
  const layout = shareImageLayout(sourceWidth, sourceHeight, width, height, options);
  const {
    height: imageHeight,
    normalized,
    outputScale,
    radius,
    scale: imageScale,
    width: imageWidth,
    x: imageX,
    y: imageY,
  } = layout;

  paintShareBackground(cr, width, height, normalized.presetId);
  if (normalized.shadow && normalized.shadowStrength > 0 && !hasTransparency)
    paintShadow(
      cr,
      imageX,
      imageY,
      imageWidth,
      imageHeight,
      radius,
      outputScale,
      normalized.shadowStrength,
    );

  cr.save();
  try {
    if (!hasTransparency) {
      roundedRectangle(cr, imageX, imageY, imageWidth, imageHeight, radius);
      cr.clip();
    }
    cr.translate(imageX, imageY);
    cr.scale(imageScale, imageScale);
    paintSource(cr);
  } finally {
    cr.restore();
  }
  return layout;
}

export function paintShareImage(cr, sourcePixbuf, width, height, options = {}) {
  if (!sourcePixbuf) throw new Error('A source image is required.');
  const hasTransparency =
    typeof options.sourceHasTransparency === 'boolean'
      ? options.sourceHasTransparency
      : pixbufHasTransparency(sourcePixbuf);
  return paintShareSource(
    cr,
    sourcePixbuf.get_width(),
    sourcePixbuf.get_height(),
    width,
    height,
    options,
    hasTransparency,
    (context) => {
      Gdk.cairo_set_source_pixbuf(context, sourcePixbuf, 0, 0);
      context.paint();
    },
  );
}

/**
 * Paint an already-rendered Cairo surface into the share canvas. This keeps
 * editor annotations live while the same background/layout painter remains
 * the source of truth for preview and export.
 */
export function paintShareSurface(cr, sourceSurface, width, height, options = {}) {
  if (!sourceSurface) throw new Error('A source surface is required.');
  const sourceWidth = sourceSurface.getWidth?.() ?? sourceSurface.get_width?.();
  const sourceHeight = sourceSurface.getHeight?.() ?? sourceSurface.get_height?.();
  if (!sourceWidth || !sourceHeight) throw new Error('The source surface size is invalid.');

  return paintShareSource(
    cr,
    sourceWidth,
    sourceHeight,
    width,
    height,
    options,
    Boolean(options.sourceHasTransparency),
    (context) => {
      context.setSourceSurface(sourceSurface, 0, 0);
      context.paint();
    },
  );
}

export function paintShareVideoBackdrop(
  cr,
  sourceWidth,
  sourceHeight,
  width,
  height,
  options = {},
) {
  const layout = shareImageLayout(sourceWidth, sourceHeight, width, height, options);
  paintShareBackground(cr, width, height, layout.normalized.presetId);
  if (layout.normalized.shadow && layout.normalized.shadowStrength > 0)
    paintShadow(
      cr,
      layout.x,
      layout.y,
      layout.width,
      layout.height,
      layout.radius,
      layout.outputScale,
      layout.normalized.shadowStrength,
    );
  return layout;
}

export function renderShareVideoBackdrop(sourceWidth, sourceHeight, options = {}) {
  const normalized = normalizeShareOptions(options);
  const { width, height } = shareCanvasSize(normalized.ratioId);
  const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, width, height);
  const cr = new Cairo.Context(surface);
  try {
    cr.setAntialias(Cairo.Antialias.BEST);
    paintShareVideoBackdrop(cr, sourceWidth, sourceHeight, width, height, normalized);
  } catch (error) {
    surface.finish();
    throw error;
  } finally {
    cr.$dispose();
  }
  surface.flush();
  return surface;
}

export function renderShareVideoMask(width, height, radius) {
  const safeWidth = Math.max(2, Math.round(width));
  const safeHeight = Math.max(2, Math.round(height));
  const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, safeWidth, safeHeight);
  const cr = new Cairo.Context(surface);
  try {
    cr.setSourceRGB(0, 0, 0);
    cr.paint();
    roundedRectangle(cr, 0, 0, safeWidth, safeHeight, radius);
    cr.setSourceRGB(1, 1, 1);
    cr.fill();
  } finally {
    cr.$dispose();
  }
  surface.flush();
  return surface;
}

export function renderShareImage(sourcePixbuf, options = {}) {
  const normalized = normalizeShareOptions(options);
  const { width, height } = shareCanvasSize(normalized.ratioId);
  const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, width, height);

  try {
    const cr = new Cairo.Context(surface);
    try {
      cr.setAntialias(Cairo.Antialias.BEST);
      paintShareImage(cr, sourcePixbuf, width, height, normalized);
    } finally {
      cr.$dispose();
    }
    surface.flush();
    return surface;
  } catch (error) {
    surface.finish();
    throw error;
  }
}

function canonicalPath(path) {
  return GLib.canonicalize_filename(String(path ?? ''), null);
}

export function exportShareImage(
  sourcePixbuf,
  targetPath,
  options = {},
  sourcePath = null,
  { replace = false } = {},
) {
  const outputPath = String(targetPath ?? '').trim();
  if (!outputPath || !GLib.path_is_absolute(outputPath))
    throw new Error('Choose a local export path.');
  if (sourcePath && canonicalPath(sourcePath) === canonicalPath(outputPath))
    throw new Error('Choose a new filename. Bolas never overwrites the original image.');
  if (!replace && GLib.file_test(outputPath, GLib.FileTest.EXISTS))
    throw new Error(`A file named ${GLib.path_get_basename(outputPath)} already exists.`);

  const directory = GLib.path_get_dirname(outputPath);
  if (GLib.mkdir_with_parents(directory, 0o700) !== 0)
    throw new Error(`Could not create the export directory: ${directory}.`);

  const tempPath = GLib.build_filenamev([
    directory,
    `.${GLib.path_get_basename(outputPath)}.${GLib.uuid_string_random()}.tmp`,
  ]);
  const surface = renderShareImage(sourcePixbuf, options);

  try {
    surface.writeToPNG(tempPath);
    if (GLib.chmod(tempPath, 0o600) !== 0) throw new Error('Could not secure the share image.');
    Gio.File.new_for_path(tempPath).move(
      Gio.File.new_for_path(outputPath),
      replace ? Gio.FileCopyFlags.OVERWRITE : Gio.FileCopyFlags.NONE,
      null,
      null,
    );
    if (GLib.chmod(outputPath, 0o600) !== 0) throw new Error('Could not secure the share image.');
  } finally {
    surface.finish();
    if (GLib.file_test(tempPath, GLib.FileTest.EXISTS)) GLib.unlink(tempPath);
  }

  const { width, height } = shareCanvasSize(normalizeShareOptions(options).ratioId);
  return { height, mimeType: 'image/png', path: outputPath, width };
}

export function createManagedSharePath(sourcePath, appId = APP_ID) {
  const directory = GLib.build_filenamev([GLib.get_user_cache_dir(), appId, 'share-images']);
  if (GLib.mkdir_with_parents(directory, 0o700) !== 0)
    throw new Error('Could not create the managed share-image directory.');
  if (GLib.chmod(directory, 0o700) !== 0)
    throw new Error('Could not secure the managed share-image directory.');

  const basename = GLib.path_get_basename(String(sourcePath ?? 'image'));
  const dot = basename.lastIndexOf('.');
  const rawStem = dot > 0 ? basename.slice(0, dot) : basename;
  const stem = rawStem.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'image';
  return GLib.build_filenamev([directory, `${stem}-share-${GLib.uuid_string_random()}.png`]);
}

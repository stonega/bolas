import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Cairo from 'cairo';
import System from 'system';

import {
  BACKGROUND_PRESETS,
  MIN_BACKGROUND_GRID_COLUMNS,
  SHARE_RATIOS,
} from '../src/share/presets.js';
import {
  exportShareImage,
  normalizeShareOptions,
  paintShareBackground,
  paintShareBackgroundSwatch,
  pixbufHasTransparency,
  renderShareImage,
  SHARE_SHADOW_STYLES,
  shareCanvasSize,
  shareImageLayout,
  sharePreviewCanvasLayout,
  sharePreviewSourceSize,
} from '../src/share/renderer.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function approximately(actual, expected, tolerance = 0.001) {
  return Math.abs(actual - expected) <= tolerance;
}

function pngDimensions(path) {
  const [, contents] = GLib.file_get_contents(path);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  assert(
    contents.length >= 24 && signature.every((value, index) => contents[index] === value),
    'exported file is not a PNG',
  );
  const view = new DataView(contents.buffer, contents.byteOffset, contents.byteLength);
  return { height: view.getUint32(20), width: view.getUint32(16) };
}

const root = GLib.build_filenamev([GLib.get_tmp_dir(), `bolas-share-${GLib.uuid_string_random()}`]);
const outputPath = GLib.build_filenamev([root, 'share.png']);
const flatPath = GLib.build_filenamev([root, 'flat.png']);
const shadowPath = GLib.build_filenamev([root, 'shadow.png']);
const zeroShadowPath = GLib.build_filenamev([root, 'zero-shadow.png']);
const transparentPath = GLib.build_filenamev([root, 'transparent.png']);
const transparentShadowPath = GLib.build_filenamev([root, 'transparent-shadow.png']);
const backgroundPath = GLib.build_filenamev([root, 'background.png']);

try {
  GLib.mkdir_with_parents(root, 0o700);
  const source = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 80, 45);
  source.fill(0x193552ff);
  assert(!pixbufHasTransparency(source), 'an opaque alpha channel was treated as transparent');

  for (const ratio of SHARE_RATIOS) {
    const surface = renderShareImage(source, { presetId: 'sunset', ratioId: ratio.id });
    const size = shareCanvasSize(ratio.id);
    assert(surface.getWidth() === size.width, `${ratio.id} width is incorrect`);
    assert(surface.getHeight() === size.height, `${ratio.id} height is incorrect`);
    surface.finish();
  }

  const texturedPresets = BACKGROUND_PRESETS.filter((preset) => preset.asset);
  assert(MIN_BACKGROUND_GRID_COLUMNS === 3, 'background choices must keep at least three columns');
  assert(texturedPresets.length === 10, 'all textured backgrounds must be registered');
  for (const preset of texturedPresets) {
    const surface = renderShareImage(source, { presetId: preset.id, ratioId: 'wide' });
    assert(surface.getWidth() === 1600, `${preset.id} background did not render`);
    surface.finish();
  }

  const swatchSurface = new Cairo.ImageSurface(Cairo.Format.ARGB32, 96, 42);
  const swatchContext = new Cairo.Context(swatchSurface);
  for (const preset of BACKGROUND_PRESETS)
    paintShareBackgroundSwatch(swatchContext, 96, 42, preset.id);
  swatchContext.$dispose();
  swatchSurface.finish();

  const largePreviewSource = sharePreviewSourceSize(3840, 2160);
  assert(
    largePreviewSource.width === 1600 && largePreviewSource.height === 900,
    'large share preview source was not downscaled',
  );
  const portraitPreviewSource = sharePreviewSourceSize(2160, 3840);
  assert(
    portraitPreviewSource.width === 900 && portraitPreviewSource.height === 1600,
    'portrait share preview source was not downscaled',
  );
  const smallPreviewSource = sharePreviewSourceSize(800, 600);
  assert(
    smallPreviewSource.width === 800 && smallPreviewSource.height === 600,
    'small share preview source was unnecessarily resized',
  );

  const normalized = normalizeShareOptions({
    cornerRadius: 999,
    padding: 0,
    presetId: 'missing',
    shadowStrength: 2,
  });
  assert(normalized.cornerRadius === 96, 'corner radius was not clamped');
  assert(normalized.padding === 0.035, 'padding was not clamped');
  assert(normalized.presetId === 'aurora', 'unknown preset did not use the default');
  assert(normalized.shadowStrength === 1, 'shadow strength was not clamped');
  const [navyShadow, blackShadow] = SHARE_SHADOW_STYLES;
  assert(SHARE_SHADOW_STYLES.length === 2, 'shadow must contain two layers');
  assert(navyShadow.color === '#32325d', 'navy shadow color is incorrect');
  assert(navyShadow.opacity === 0.25, 'navy shadow opacity is incorrect');
  assert(navyShadow.offsetX === 0, 'navy shadow horizontal offset is incorrect');
  assert(navyShadow.offsetY === 50, 'navy shadow vertical offset is incorrect');
  assert(navyShadow.blurRadius === 100, 'navy shadow blur radius is incorrect');
  assert(navyShadow.spreadRadius === -20, 'navy shadow spread radius is incorrect');
  assert(blackShadow.color === '#000000', 'black shadow color is incorrect');
  assert(blackShadow.opacity === 0.3, 'black shadow opacity is incorrect');
  assert(blackShadow.offsetX === 0, 'black shadow horizontal offset is incorrect');
  assert(blackShadow.offsetY === 30, 'black shadow vertical offset is incorrect');
  assert(blackShadow.blurRadius === 60, 'black shadow blur radius is incorrect');
  assert(blackShadow.spreadRadius === -30, 'black shadow spread radius is incorrect');

  const previewLayout = sharePreviewCanvasLayout(1000, 700, 'landscape');
  assert(approximately(previewLayout.width, 933.333333), 'preview canvas width is incorrect');
  assert(approximately(previewLayout.height, 700), 'preview canvas height is incorrect');
  assert(approximately(previewLayout.x, 33.333333), 'preview canvas was not centered horizontally');
  assert(approximately(previewLayout.y, 0), 'preview canvas did not use the full stage height');
  const imageLayout = shareImageLayout(80, 45, previewLayout.width, previewLayout.height, {
    padding: 0.1,
    ratioId: 'landscape',
  });
  assert(approximately(imageLayout.width, 793.333333), 'transition image width is incorrect');
  assert(approximately(imageLayout.height, 446.25), 'transition image height is incorrect');
  assert(approximately(imageLayout.x, 70), 'transition image was not centered horizontally');

  const insetPreviewLayout = sharePreviewCanvasLayout(1000, 700, 'landscape', 34);
  assert(
    approximately(insetPreviewLayout.height, 632) && approximately(insetPreviewLayout.y, 34),
    'an explicit preview inspection inset was not preserved',
  );

  const lowPaddingVideoLayout = shareImageLayout(160, 90, 1600, 1200, {
    padding: 0.035,
    ratioId: 'landscape',
  });
  const highPaddingVideoLayout = shareImageLayout(160, 90, 1600, 1200, {
    padding: 0.22,
    ratioId: 'landscape',
  });
  assert(
    highPaddingVideoLayout.width < lowPaddingVideoLayout.width &&
      highPaddingVideoLayout.height < lowPaddingVideoLayout.height,
    'increasing background padding must reduce the fitted video rectangle',
  );

  const flatSurface = renderShareImage(source, {
    presetId: 'paper',
    ratioId: 'landscape',
    shadow: false,
  });
  const shadowSurface = renderShareImage(source, {
    presetId: 'paper',
    ratioId: 'landscape',
    shadow: true,
  });
  const zeroShadowSurface = renderShareImage(source, {
    presetId: 'paper',
    ratioId: 'landscape',
    shadow: true,
    shadowStrength: 0,
  });
  flatSurface.writeToPNG(flatPath);
  shadowSurface.writeToPNG(shadowPath);
  zeroShadowSurface.writeToPNG(zeroShadowPath);
  flatSurface.finish();
  shadowSurface.finish();
  zeroShadowSurface.finish();
  const [, flatPixels] = GLib.file_get_contents(flatPath);
  const [, shadowPixels] = GLib.file_get_contents(shadowPath);
  const [, zeroShadowPixels] = GLib.file_get_contents(zeroShadowPath);
  assert(
    flatPixels.length !== shadowPixels.length ||
      flatPixels.some((value, index) => value !== shadowPixels[index]),
    'enabled shadow did not affect rendered pixels',
  );
  assert(
    flatPixels.length === zeroShadowPixels.length &&
      flatPixels.every((value, index) => value === zeroShadowPixels[index]),
    'zero shadow strength changed rendered pixels',
  );

  const transparentSource = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 80, 45);
  transparentSource.fill(0x19355280);
  assert(pixbufHasTransparency(transparentSource), 'partial source alpha was not detected');
  const transparentFlat = renderShareImage(transparentSource, {
    presetId: 'paper',
    ratioId: 'landscape',
    shadow: false,
  });
  const transparentShadow = renderShareImage(transparentSource, {
    presetId: 'paper',
    ratioId: 'landscape',
    shadow: true,
  });
  transparentFlat.writeToPNG(transparentPath);
  transparentShadow.writeToPNG(transparentShadowPath);
  transparentFlat.finish();
  transparentShadow.finish();
  const [, transparentPixels] = GLib.file_get_contents(transparentPath);
  const [, transparentShadowPixels] = GLib.file_get_contents(transparentShadowPath);
  assert(
    transparentPixels.length === transparentShadowPixels.length &&
      transparentPixels.every((value, index) => value === transparentShadowPixels[index]),
    'a rectangular shadow was added behind a transparent source',
  );

  const emptySource = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 80, 45);
  emptySource.fill(0x00000000);
  const emptyComposite = renderShareImage(emptySource, {
    presetId: 'paper',
    ratioId: 'landscape',
    shadow: false,
  });
  const background = new Cairo.ImageSurface(Cairo.Format.ARGB32, 1600, 1200);
  const backgroundContext = new Cairo.Context(background);
  paintShareBackground(backgroundContext, 1600, 1200, 'paper');
  backgroundContext.$dispose();
  background.flush();
  emptyComposite.writeToPNG(transparentPath);
  background.writeToPNG(backgroundPath);
  emptyComposite.finish();
  background.finish();
  const [, emptyCompositePixels] = GLib.file_get_contents(transparentPath);
  const [, backgroundPixels] = GLib.file_get_contents(backgroundPath);
  assert(
    emptyCompositePixels.length === backgroundPixels.length &&
      emptyCompositePixels.every((value, index) => value === backgroundPixels[index]),
    'transparent bounds added a synthetic outline to the share image',
  );

  const exported = exportShareImage(source, outputPath, {
    padding: 0.1,
    presetId: 'aurora',
    ratioId: 'landscape',
    shadow: true,
  });
  assert(exported.path === outputPath, 'export path is incorrect');
  assert(Gio.File.new_for_path(outputPath).query_exists(null), 'share PNG is missing');
  const { width, height } = pngDimensions(outputPath);
  assert(
    width === 1600 && height === 1200,
    `exported PNG dimensions are incorrect: ${width} × ${height}`,
  );

  let rejectedExisting = false;
  try {
    exportShareImage(source, outputPath, { ratioId: 'wide' });
  } catch {
    rejectedExisting = true;
  }
  assert(rejectedExisting, 'an existing destination was overwritten without confirmation');

  Gio.File.new_for_path(outputPath).delete(null);
  Gio.File.new_for_path(flatPath).delete(null);
  Gio.File.new_for_path(shadowPath).delete(null);
  Gio.File.new_for_path(zeroShadowPath).delete(null);
  Gio.File.new_for_path(transparentPath).delete(null);
  Gio.File.new_for_path(transparentShadowPath).delete(null);
  Gio.File.new_for_path(backgroundPath).delete(null);
  Gio.File.new_for_path(root).delete(null);
  print('share image renderer is valid');
  System.exit(0);
} catch (error) {
  if (GLib.file_test(outputPath, GLib.FileTest.EXISTS)) GLib.unlink(outputPath);
  if (GLib.file_test(flatPath, GLib.FileTest.EXISTS)) GLib.unlink(flatPath);
  if (GLib.file_test(shadowPath, GLib.FileTest.EXISTS)) GLib.unlink(shadowPath);
  if (GLib.file_test(zeroShadowPath, GLib.FileTest.EXISTS)) GLib.unlink(zeroShadowPath);
  if (GLib.file_test(transparentPath, GLib.FileTest.EXISTS)) GLib.unlink(transparentPath);
  if (GLib.file_test(transparentShadowPath, GLib.FileTest.EXISTS))
    GLib.unlink(transparentShadowPath);
  if (GLib.file_test(backgroundPath, GLib.FileTest.EXISTS)) GLib.unlink(backgroundPath);
  if (GLib.file_test(root, GLib.FileTest.IS_DIR)) GLib.rmdir(root);
  printerr(String(error));
  printerr(error.stack ?? error.message);
  System.exit(1);
}

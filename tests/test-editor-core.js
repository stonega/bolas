import System from 'system';

import {
  createAnnotation,
  DEFAULT_FONT_FAMILY,
  editPanelForCompositionTarget,
  getAnnotationBounds,
  hitTestAnnotations,
  ImageDocument,
  pickCompositionTarget,
} from '../src/editor/document.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  const defaultText = createAnnotation('text');
  assert(defaultText.fontFamily === DEFAULT_FONT_FAMILY, 'text must use the default font family');
  const customTextDocument = new ImageDocument({
    height: 600,
    width: 800,
    annotations: [createAnnotation('text', { fontFamily: 'Cantarell', text: 'Custom font' })],
  });
  assert(
    ImageDocument.fromJSON(customTextDocument.toJSON()).annotations[0].fontFamily === 'Cantarell',
    'a selected text font must survive document serialization',
  );

  const document = new ImageDocument({ height: 600, width: 800 });
  const rectangle = document.addAnnotation(
    createAnnotation('rectangle', {
      fillColor: '#3584e4',
      rect: { height: 0.25, width: 0.3, x: 0.1, y: 0.15 },
      strokeColor: '#ffffff',
    }),
  );

  assert(rectangle?.id, 'rectangle annotation was not created');
  assert(
    hitTestAnnotations(document.annotations, { x: 0.2, y: 0.2 })?.id === rectangle.id,
    'filled rectangle hit testing failed',
  );

  const layeredCanvasTarget = pickCompositionTarget({
    canvasAnnotations: document.annotations,
    imagePoint: { x: 0.2, y: 0.2 },
    surfacePoint: { x: 0.2, y: 0.2 },
  });
  assert(
    layeredCanvasTarget.layer === 'canvas' && layeredCanvasTarget.annotation?.id === rectangle.id,
    'canvas annotations must keep selection precedence over the imported image',
  );
  assert(
    editPanelForCompositionTarget(layeredCanvasTarget) === 'draw',
    'clicking an annotation must open the Draw panel',
  );

  const importedImageTarget = pickCompositionTarget({
    imagePoint: { x: 0.5, y: 0.5 },
    surfacePoint: { x: 0.5, y: 0.5 },
  });
  assert(
    importedImageTarget.layer === 'image' && importedImageTarget.annotation === null,
    'the imported image must be selectable when no canvas annotation is hit',
  );
  assert(
    editPanelForCompositionTarget(importedImageTarget) === 'crop',
    'clicking the imported image must open the Crop panel',
  );

  const imageDocument = new ImageDocument({ height: 600, width: 800 });
  const imageRectangle = imageDocument.addAnnotation(
    createAnnotation('rectangle', {
      fillColor: '#e01b24',
      rect: { height: 0.2, width: 0.2, x: 0.4, y: 0.4 },
    }),
  );
  const imageAnnotationTarget = pickCompositionTarget({
    imageAnnotations: imageDocument.annotations,
    imagePoint: { x: 0.5, y: 0.5 },
    surfacePoint: { x: 0.5, y: 0.5 },
  });
  assert(
    imageAnnotationTarget.layer === 'image' &&
      imageAnnotationTarget.annotation?.id === imageRectangle.id,
    'image annotations must be returned before the imported image target',
  );

  const backgroundTarget = pickCompositionTarget({
    imagePoint: { x: -0.1, y: 0.5 },
    surfacePoint: { x: 0.05, y: 0.5 },
  });
  assert(
    backgroundTarget.layer === 'canvas' && backgroundTarget.annotation === null,
    'empty composition space must select the background canvas',
  );
  assert(
    editPanelForCompositionTarget(backgroundTarget) === 'background',
    'clicking empty composition space must open the Background panel',
  );

  const originalBounds = getAnnotationBounds(rectangle);
  document.markSaved();
  document.beginTransaction('Move annotation');
  document.moveAnnotation(rectangle.id, 0.1, 0.05, { clamp: true });
  assert(document.commitTransaction(), 'annotation move did not commit');
  assert(document.dirty, 'annotation move did not mark the document dirty');
  assert(document.undo(), 'annotation move could not be undone');
  assert(
    Math.abs(getAnnotationBounds(document.selectedAnnotation).x - originalBounds.x) < 1e-9,
    'undo did not restore annotation geometry',
  );
  assert(document.redo(), 'annotation move could not be redone');

  document.crop({ height: 0.5, width: 0.5, x: 0, y: 0 });
  assert(document.width === 400 && document.height === 300, 'crop dimensions were not recorded');
  document.rotate(1);
  assert(
    document.width === 300 && document.height === 400,
    'rotation dimensions were not recorded',
  );
  document.flip('horizontal');
  assert(document.transforms.length === 3, 'image transforms were not recorded');

  const restored = ImageDocument.fromJSON(document.toJSON());
  assert(restored.width === 300 && restored.height === 400, 'serialized dimensions were lost');
  assert(restored.annotations.length === document.annotations.length, 'annotations were lost');

  print('image editor document core is valid');
  System.exit(0);
} catch (error) {
  printerr(error.message);
  System.exit(1);
}

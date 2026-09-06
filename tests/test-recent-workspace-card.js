import Gio from 'gi://Gio?version=2.0';
import System from 'system';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sourceText(pathParts) {
  let file = Gio.File.new_for_uri(import.meta.url)
    .get_parent()
    .get_parent();
  for (const part of pathParts) file = file.get_child(part);
  const [loaded, contents] = file.load_contents(null);
  assert(loaded, `${pathParts.join('/')} could not be read`);
  return new TextDecoder().decode(contents);
}

try {
  const windowSource = sourceText(['src', 'window.js']);
  const previewPosition = windowSource.indexOf('card.append(preview);');
  const labelsPosition = windowSource.indexOf('card.append(labels);', previewPosition);

  assert(previewPosition >= 0, 'the recent workspace card must append its preview');
  assert(labelsPosition > previewPosition, 'the recent workspace labels must follow the preview');
  assert(
    windowSource.includes('card._bolasLabels = labels;') &&
      windowSource.includes('const labels = card._bolasLabels;'),
    'the recent workspace text binding must not depend on child position',
  );
  assert(
    windowSource.includes('card._bolasPreview = preview;') &&
      windowSource.includes('const preview = card._bolasPreview;'),
    'the recent workspace preview binding must not depend on child position',
  );
  assert(
    windowSource.includes('this._refreshRecentWorkspacePreviews();') &&
      windowSource.includes('_refreshRecentWorkspacePreviews()'),
    'returning Home must refresh covers created while a workspace was open',
  );

  const videoWindowSource = sourceText(['src', 'video', 'window.js']);
  assert(
    videoWindowSource.includes('generateVideoThumbnail({') &&
      videoWindowSource.includes('writeWorkspacePreviewFromPng(saved.path, thumbnailPath);'),
    'saved video workspaces must publish a cover for the Recents card',
  );

  print('recent workspace cards show saved image and video previews above their labels');
  System.exit(0);
} catch (error) {
  printerr(error.stack ?? error.message);
  System.exit(1);
}

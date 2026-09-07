test(
  'application-config',
  gjs,
  args: ['-m', files('test-config.js')],
  suite: 'unit',
)

test(
  'source-settings',
  gjs,
  args: ['-m', files('test-source-settings.js')],
  suite: 'unit',
)

test(
  'bundled-icons',
  gjs,
  args: ['-m', files('test-bundled-icons.js')],
  suite: 'unit',
)

preferences_test_env = environment()
preferences_test_env.set('GSETTINGS_BACKEND', 'memory')
preferences_test_env.set('GSETTINGS_SCHEMA_DIR', meson.current_build_dir() / '..' / 'data')

test(
  'user-preferences',
  gjs,
  args: ['-m', files('test-preferences.js')],
  depends: preferences_schemas,
  env: preferences_test_env,
  suite: 'unit',
)

test(
  'image-file',
  gjs,
  args: ['-m', files('test-image-file.js')],
  suite: 'unit',
)

test(
  'media-file',
  gjs,
  args: ['-m', files('test-media-file.js')],
  suite: 'unit',
)

test(
  'screenshot-folder',
  gjs,
  args: ['-m', files('test-screenshot-folder.js')],
  suite: 'unit',
)

test(
  'screenshot-capture',
  gjs,
  args: ['-m', files('test-screenshot-capture.js')],
  suite: 'unit',
)

test(
  'video-edit',
  gjs,
  args: ['-m', files('test-video-edit.js')],
  suite: 'unit',
)

test(
  'video-frame-coalescer',
  gjs,
  args: ['-m', files('test-video-frame-coalescer.js')],
  suite: 'unit',
)

test(
  'video-playback-clock',
  gjs,
  args: ['-m', files('test-video-playback-clock.js')],
  suite: 'unit',
)

test(
  'video-workspace',
  gjs,
  args: ['-m', files('test-video-workspace.js')],
  suite: 'unit',
)

test(
  'video-workspace-source',
  gjs,
  args: ['-m', files('test-video-workspace-source.js')],
  suite: 'integration',
)

test(
  'video-preview-widget',
  gjs,
  args: ['-m', files('test-video-preview-widget.js')],
  suite: 'unit',
)

test(
  'recent-workspace-card',
  gjs,
  args: ['-m', files('test-recent-workspace-card.js')],
  suite: 'unit',
)

test(
  'video-auto-focus',
  gjs,
  args: ['-m', files('test-video-auto-focus.js')],
  suite: 'unit',
)

test(
  'video-auto-focus-service',
  gjs,
  args: ['-m', files('test-video-auto-focus-service.js')],
  suite: 'integration',
  timeout: 30,
)

test(
  'video-export',
  gjs,
  args: ['-m', files('test-video-export.js')],
  suite: 'integration',
  timeout: 30,
)

test(
  'image-export',
  gjs,
  args: ['-m', files('test-image-export.js')],
  suite: 'integration',
  timeout: 30,
)

test(
  'video-thumbnail',
  gjs,
  args: ['-m', files('test-video-thumbnail.js')],
  suite: 'integration',
  timeout: 30,
)

test(
  'image-editor-core',
  gjs,
  args: ['-m', files('test-editor-core.js')],
  suite: 'unit',
)

test(
  'image-workspace',
  gjs,
  args: ['-m', files('test-workspace.js')],
  suite: 'unit',
)

test(
  'image-workspace-file',
  gjs,
  args: ['-m', files('test-workspace-file.js')],
  suite: 'integration',
)

test(
  'workspace-library',
  gjs,
  args: ['-m', files('test-workspace-library.js')],
  suite: 'unit',
)

test(
  'workspace-preview',
  gjs,
  args: ['-m', files('test-workspace-preview.js')],
  suite: 'unit',
)

test(
  'image-editor-renderer',
  gjs,
  args: ['-m', files('test-editor-renderer.js')],
  suite: 'unit',
)

test(
  'share-image-renderer',
  gjs,
  args: ['-m', files('test-share-renderer.js')],
  suite: 'unit',
)

pkgdatadir = get_option('prefix') / get_option('datadir') / meson.project_name()

launcher_conf = configuration_data()
launcher_conf.set('MAIN_MODULE_URI', 'file://' + pkgdatadir / 'main.js')

launcher = configure_file(
  input: 'bolas.in',
  output: 'bolas',
  configuration: launcher_conf,
)

install_data(
  launcher,
  install_dir: get_option('bindir'),
  install_mode: 'rwxr-xr-x',
)

install_data(
  files(
    'application.js',
    'bundledIcons.js',
    'config.js',
    'main.js',
    'preferences.js',
    'source-settings.js',
    'style.css',
    'window.js',
  ),
  install_dir: get_option('datadir') / meson.project_name(),
)

install_data(
  files(
    'editor/document.js',
    'editor/renderer.js',
    'editor/workspace.js',
    'editor/window.js',
  ),
  install_dir: pkgdatadir / 'editor',
)

install_data(
  files(
    'icons/tool-arrow-symbolic.svg',
    'icons/tool-ellipse-symbolic.svg',
    'icons/tool-line-symbolic.svg',
    'icons/tool-pencil-symbolic.svg',
    'icons/tool-rectangle-symbolic.svg',
    'icons/tool-select-symbolic.svg',
    'icons/tool-text-symbolic.svg',
  ),
  install_dir: pkgdatadir / 'icons',
)

install_data(
  files(
    'model/image-file.js',
    'model/media-file.js',
    'model/screenshot-folder.js',
    'model/workspace.js',
  ),
  install_dir: pkgdatadir / 'model',
)

install_data(
  files(
    'services/image-share.js',
    'services/media-share.js',
    'services/screenshot-capture.js',
    'services/video-auto-focus.js',
    'services/video-export.js',
    'services/video-thumbnail.js',
    'services/video-workspace-source.js',
    'services/workspace-file.js',
    'services/workspace-library.js',
    'services/workspace-preview.js',
  ),
  install_dir: pkgdatadir / 'services',
)

install_data(
  files(
    'video/auto-focus.js',
    'video/edit.js',
    'video/frame-coalescer.js',
    'video/playback-clock.js',
    'video/timeline.js',
    'video/window.js',
    'video/workspace.js',
  ),
  install_dir: pkgdatadir / 'video',
)

install_data(
  files(
    'share/controls.js',
    'share/presets.js',
    'share/renderer.js',
  ),
  install_dir: pkgdatadir / 'share',
)

install_data(
  files(
    'share/backgrounds/aurora-mesh.png',
    'share/backgrounds/brass-tide.png',
    'share/backgrounds/deep-teal.png',
    'share/backgrounds/eclipse-gold.png',
    'share/backgrounds/ember-mesh.png',
    'share/backgrounds/lagoon-mesh.png',
    'share/backgrounds/midnight-mesh.png',
    'share/backgrounds/mint-bloom.png',
    'share/backgrounds/sunbeam.png',
    'share/backgrounds/violet-bloom.png',
  ),
  install_dir: pkgdatadir / 'share' / 'backgrounds',
)

install_data(
  files(
    'share/backgrounds/swatches/aurora-mesh.png',
    'share/backgrounds/swatches/brass-tide.png',
    'share/backgrounds/swatches/deep-teal.png',
    'share/backgrounds/swatches/eclipse-gold.png',
    'share/backgrounds/swatches/ember-mesh.png',
    'share/backgrounds/swatches/lagoon-mesh.png',
    'share/backgrounds/swatches/midnight-mesh.png',
    'share/backgrounds/swatches/mint-bloom.png',
    'share/backgrounds/swatches/sunbeam.png',
    'share/backgrounds/swatches/violet-bloom.png',
  ),
  install_dir: pkgdatadir / 'share' / 'backgrounds' / 'swatches',
)

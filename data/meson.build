desktop_conf = configuration_data()
desktop_conf.set('APP_ID', app_id)

preferences_schema = files('io.github.stonega.Bolas.gschema.xml')
preferences_schemas = gnome.compile_schemas(
  build_by_default: true,
  depend_files: preferences_schema,
)

install_data(
  preferences_schema,
  install_dir: get_option('datadir') / 'glib-2.0' / 'schemas',
)

desktop_file = configure_file(
  input: 'io.github.stonega.Bolas.desktop.in',
  output: '@BASENAME@',
  configuration: desktop_conf,
)

install_data(
  desktop_file,
  install_dir: get_option('datadir') / 'applications',
)

install_data(
  'io.github.stonega.Bolas-workspace.xml',
  install_dir: get_option('datadir') / 'mime' / 'packages',
)

service_conf = configuration_data()
service_conf.set('APP_ID', app_id)
service_conf.set('BINDIR', get_option('prefix') / get_option('bindir'))

service_file = configure_file(
  input: 'io.github.stonega.Bolas.service.in',
  output: '@BASENAME@',
  configuration: service_conf,
)

install_data(
  service_file,
  install_dir: get_option('datadir') / 'dbus-1' / 'services',
)

install_data(
  'icons/hicolor/scalable/apps/io.github.stonega.Bolas.svg',
  install_dir: get_option('datadir') / 'icons' / 'hicolor' / 'scalable' / 'apps',
)

project(
  'bolas',
  version: '0.1.0',
  meson_version: '>= 1.2.0',
)

app_id = 'io.github.stonega.Bolas'
gjs = find_program('gjs')
gnome = import('gnome')

subdir('data')
subdir('src')
subdir('tests')

gnome.post_install(
  glib_compile_schemas: true,
  update_desktop_database: true,
  update_mime_database: true,
)

summary(
  {
    'Application ID': app_id,
    'Version': meson.project_version(),
    'Prefix': get_option('prefix'),
  },
  section: 'Bolas',
  bool_yn: true,
)

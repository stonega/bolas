Name:           bolas
Version:        0.1.3
Release:        1%{?dist}
Summary:        Native GNOME screenshot and video editor

License:        GPL-3.0-or-later
URL:            https://github.com/stonega/bolas
Source0:        %{url}/archive/refs/tags/v%{version}/%{name}-%{version}.tar.gz
BuildArch:      noarch

BuildRequires:  desktop-file-utils
BuildRequires:  ffmpeg-free
BuildRequires:  gcc
BuildRequires:  gdk-pixbuf2
BuildRequires:  gjs >= 1.80
BuildRequires:  glib2-devel
BuildRequires:  graphene
BuildRequires:  gstreamer1-plugins-base
BuildRequires:  gstreamer1-plugins-good
BuildRequires:  gtk4 >= 4.14
BuildRequires:  libadwaita >= 1.6
BuildRequires:  librsvg2
BuildRequires:  meson >= 1.2
BuildRequires:  shared-mime-info

# GJS imports and subprocesses are not detected by RPM dependency generation.
Requires:       gdk-pixbuf2
Requires:       gjs >= 1.80
Requires:       glib2
Requires:       graphene
Requires:       gstreamer1-plugins-base
Requires:       gstreamer1-plugins-good
Requires:       gtk4 >= 4.14
Requires:       hicolor-icon-theme
Requires:       libadwaita >= 1.6
Requires:       librsvg2
Requires:       pango
Requires:       shared-mime-info
Requires:       /usr/bin/ffmpeg
Recommends:     desktop-file-utils
Recommends:     xdg-desktop-portal
Recommends:     xdg-desktop-portal-gnome

%description
Bolas captures and annotates screenshots, composes share images, and edits
screen recordings with trim, zoom, captions, blur masks, and audio controls.
Save editable workspaces or export PNG, JPEG, WebM, and MP4 files.

%prep
%autosetup -n %{name}-%{version}

%build
%meson
%meson_build

%install
%meson_install
sed -i '1{/^#!/d}' %{buildroot}%{_datadir}/bolas/main.js

%check
%meson_test
desktop-file-validate \
  %{buildroot}%{_datadir}/applications/io.github.stonega.Bolas.desktop
glib-compile-schemas --strict --dry-run \
  %{buildroot}%{_datadir}/glib-2.0/schemas

%files
%license %{_datadir}/licenses/%{name}/
%doc CHANGELOG.md README.md
%{_bindir}/bolas
%{_datadir}/bolas/
%{_datadir}/applications/io.github.stonega.Bolas.desktop
%{_datadir}/dbus-1/services/io.github.stonega.Bolas.service
%{_datadir}/glib-2.0/schemas/io.github.stonega.Bolas.gschema.xml
%{_datadir}/mime/packages/io.github.stonega.Bolas-workspace.xml
%{_datadir}/icons/hicolor/scalable/apps/io.github.stonega.Bolas.svg

%changelog
* Mon Sep 07 2026 Bolas maintainers <noreply@github.com> - 0.1.3-1
- Test missing H.264 support in Fedora's noopenh264 build environment

* Mon Sep 07 2026 Bolas maintainers <noreply@github.com> - 0.1.2-1
- Initial source build for Fedora COPR
- License Bolas under GPL-3.0-or-later and include the license text
- Add JPEG and MP4 export, progress, and background image rendering

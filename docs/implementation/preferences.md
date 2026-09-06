# Editor and share preferences

## Storage boundary

`src/preferences.js` is the only module that maps editor and share option names
to GSettings keys. The schema is `data/io.github.stonega.Bolas.gschema.xml` and
uses the stable application ID so preferences remain associated with Bolas
across upgrades.

Every stored value is normalized before it enters a workspace. Choice controls
accept only values represented by the current UI, while numeric share controls
are constrained to their visible ranges. This prevents removed or malformed
settings from producing an invalid editor state.

## Remembered image-editor options

- annotation tool and preset color;
- stroke width, text font family, and text size, stored independently;
- shape fill state;
- crop aspect ratio and orientation.

Content-specific state is not a preference. Annotation text, selection, crop
rectangle, zoom, undo history, and image transformations remain scoped to the
current image.

## Remembered image-composition options

- background preset and canvas ratio;
- padding and corner radius;
- shadow state and strength.

A source with transparency uses an effective corner radius of zero and disables
the synthetic shadow. Those effective constraints are not written back to
GSettings, so opening an opaque source restores the user's remembered corner and
shadow choices.

## Build and tests

Meson compiles the schema for builds and installs its XML below
`share/glib-2.0/schemas`. The post-install step updates the system schema cache.
The source launcher and GJS entry point compile the schema into `build/data`
before starting the application, so direct source-tree execution does not depend
on a system-installed Bolas schema.

`tests/test-preferences.js` runs with the memory GSettings backend. It verifies
schema defaults, independent persistence of every option, invalid-value
normalization, and transparent-source constraints without changing real user
preferences.

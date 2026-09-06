# AGENTS.md

This document defines how AI agents should work in the Bolas repository.

## 1. Project overview

Bolas is a native GNOME screenshot viewer, editor, and share-image composer. The
application shell uses GJS, GTK 4, and libadwaita. Meson owns native builds and
installation; Bun is used only for repository-level JavaScript quality tooling.

Keep Bolas native to the GNOME platform. Do not introduce Electron, a browser
runtime, or GNOME Shell private APIs. File and application handoff belongs behind
focused service boundaries and should use stable GTK APIs.

## 2. Project structure

```text
bolas/
├── AGENTS.md
├── README.md
├── build-aux/          # Flatpak and distribution build files
├── data/               # desktop integration and icons
├── docs/
│   ├── design/         # architecture and product design
│   ├── implementation/ # technical implementation notes
│   └── user/           # end-user documentation
├── examples/           # focused, runnable integration examples
├── postmortem/         # incident reports and retrospectives
├── scripts/            # idempotent development commands
├── src/                # GJS application source
└── tests/              # deterministic automated tests
```

Preserve this structure. Add a new top-level directory only when its ownership
cannot fit an existing area.

## 3. Development workflow

Before changing behavior:

1. Read the relevant document in `docs/design/` and `docs/implementation/`.
2. Keep UI composition in `src/window.js`, application lifecycle and actions in
   `src/application.js`, and stable metadata in `src/config.js`.
3. Put storage and desktop handoff integrations in focused service modules; do
   not call D-Bus directly from widgets.
4. Add or update deterministic tests in `tests/`.
5. Update architecture, implementation, and user documentation with behavior.

## 4. Coding rules

- Use modern GJS ES modules and explicit `gi://` version imports.
- Prefer GTK and libadwaita widgets over custom-drawn controls.
- Follow GNOME accessibility conventions: labels, keyboard access, semantic
  actions, and visible focus must ship with each interaction.
- Keep functions small, composable, and readable.
- Keep asynchronous desktop operations cancellable and model success,
  cancellation, denial, timeout, and backend failure.
- Never assume a chooser or launcher result is a permanent local path.
- Avoid blocking the GTK main loop.
- Do not add a framework or runtime dependency without documenting the reason.
- Use `apply_patch` for intentional source edits and `git` for version control.

## 5. Commands

```sh
bun install       # install Biome for repository checks
bun run run       # launch directly from the source tree
bun run build     # configure and compile with Meson
bun run test      # run deterministic tests
bun run check     # lint, build, test, and validate desktop metadata
bun run format    # format JavaScript source and tests
```

Run `bun run check` before finishing a code change. If the full command cannot
run because a host dependency is absent, report the exact missing dependency and
run every remaining check that is available.

## 6. Testing requirements

- Add unit tests for domain logic, image inspection, and deterministic rendering.
- Use fakes or temporary directories for filesystem behavior; tests must not
  trigger a real desktop dialog or depend on a live desktop session.
- Add integration tests for complete open, edit, and share workflows when needed.
- Keep UI smoke tests separate from deterministic unit tests.

## 7. Documentation and examples

Update documentation when architecture, public behavior, build commands, desktop
permissions, or packaging changes. New APIs and integration workflows need a
runnable example in `examples/`.

## 8. Postmortems

For a material regression or incident, create `postmortem/<incident>.md` with:

- what happened;
- impact;
- root cause;
- fix;
- prevention and follow-up work.

## 9. Safety and release rules

- Do not remove user screenshots or overwrite an existing destination.
- Treat screenshot contents and paths as sensitive user data.
- Request only the narrowest Flatpak and desktop integration permissions required.
- Keep the application ID stable after public distribution.
- Agent-generated changes must pass tests and include relevant documentation.

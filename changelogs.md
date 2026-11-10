# Changelogs

## 1.0.0 - 2026-11-10

First public release.

### Compiling
- Compile `.pwn`, `.p` and `.inc` files with one tap from the header **▶** button (shown only for Pawn files).
- Built-in `pawncc.wasm` engine, so no Alpine or terminal is needed.
- Alpine (proot) mode with a native `pawncc` as an alternative.
- Automatic `pawncc` setup in an Acode terminal for Alpine mode.
- Auto-save before compile.
- Compile an `.inc` file through the `main` entry in `.acode/task.json`.
- `.amx` is written next to the source, only when the compile succeeds.
- Settings for compiler flags (default `-d3 -;+ -(+`) and extra include folders.

### Result screen
- Success / failed banner with compile time.
- Error and warning list with All / Errors / Warnings filters.
- Tap an item to jump to the line, including files from `#include`.
- Size stats: Header, Code, Data, Stack / Heap and Total.
- Raw log view and one-tap copy.

### Project support
- `.acode/task.json` support: `args`, `includes`, `command` and `main`.
- Variables: `${file}`, `${fileDirname}`, `${fileBasename}`, `${fileBasenameNoExtension}`, `${fileExtname}`, `${relativeFile}`, `${workspaceRoot}`.
- Comments and trailing commas are allowed in `task.json`.

### Editor
- Syntax highlighting for `.pwn` and `.inc`.
- Pawno Night theme.
- Autocomplete and snippets for callbacks, natives, constants and keywords.
- Project-aware suggestions from `.inc` files and `gamemode` / `gamemodes` modules.
- `.pwn` file icon in tabs and sidebar.

### Commands
- `Pawn: Compile active file`
- `Pawn: Setup compiler (install pawncc)`
- `Pawn: Remove setup (pawncc & settings)`
- `Pawn: Use Pawno Night theme`
- `Pawn: Debug .pwn icon`
- `Pawn: Debug autocomplete`

### Known limits
- WASM mode loads up to 1500 files, 40 MB and 3 folder levels.
- Alpine mode needs local storage (`file://`), not SAF folders.

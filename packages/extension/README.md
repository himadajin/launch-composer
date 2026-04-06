# Launch Composer

Launch Composer is a VS Code extension for composing `.vscode/launch.json` from reusable template files and config files.

It adds a dedicated Activity Bar view where you manage templates and configs, edit entries, and generate `launch.json` for the current workspace. The extension requires exactly one workspace folder.

## Workspace Layout

Launch Composer stores its data under `.vscode/launch-composer`:

```text
.vscode/
  launch-composer/
    templates/
      template.json
    configs/
      config.json
  launch.json
```

- `templates/`: JSON array files containing reusable template entries.
- `configs/`: JSON array files containing launch configs that can extend templates.
- `launch.json`: generated output written by the extension.

## How It Works

1. Run `Launch Composer: Initialize` to create the storage directories and default files.
2. Add template entries under `.vscode/launch-composer/templates/*.json`.
3. Add config entries under `.vscode/launch-composer/configs/*.json`.
4. Run `Launch Composer: Generate launch.json` to write `.vscode/launch.json`.

## Install And Build

Install dependencies:

```bash
npm install
```

Build all packages:

```bash
npm run build
```

Create a VSIX package:

```bash
npm run package -w launch-composer
```

Install the VSIX in VS Code:

1. Open the Command Palette.
2. Run `Extensions: Install from VSIX...`.
3. Select `packages/extension/launch-composer.vsix`.

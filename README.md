# Launch Composer

Launch Composer is a VS Code extension for composing `.vscode/launch.json` from reusable profile files and config files.

It adds a dedicated Activity Bar view where you manage profiles and configs, edit entries, and generate `launch.json` for the current workspace. The extension requires exactly one workspace folder.

## Workspace Layout

Launch Composer stores its data under `.vscode/launch-composer`:

```text
.vscode/
  launch-composer/
    profiles/
      profile.json
    configs/
      config.json
  launch.json
```

- `profiles/`: JSON array files containing reusable profile entries.
- `configs/`: JSON array files containing launch configs that can extend profiles.
- `launch.json`: generated output written by the extension.

## How It Works

1. Run `Launch Composer: Initialize` to create the storage directories and default files.
2. Add profile entries under `.vscode/launch-composer/profiles/*.json`.
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

This writes the package to `packages/extension/launch-composer.vsix`.

Package and install the extension in VS Code:

```bash
npm run install:vscode
```

This script packages the extension and runs `code --install-extension packages/extension/launch-composer.vsix --force`.

# pi-model-pin

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
[![npm version](https://img.shields.io/npm/v/pi-model-pin.svg?style=flat)](https://www.npmjs.com/package/pi-model-pin)

A [pi coding agent](https://github.com/earendil-works/pi) extension that keeps the model you pick with
`/model` across `/new` sessions **within the same running pi process**, while a **new pi process**
(like a new terminal tab) always starts on the configured default model — until you pick a different
one.

```
terminal A                                   terminal B (new process)
┌─────────────────────────────────┐          ┌─────────────────────────────┐
│ pi                              │          │ pi                          │
│ /model PROVIDER/MODEL           │          │   (starts on configured      │
│ /new      ← still on that model │          │    default model, as usual)  │
│ /new      ← still on that model │          └─────────────────────────────┘
└─────────────────────────────────┘
```

## Requirements

- A [pi coding agent](https://github.com/earendil-works/pi) installation
- Node.js ≥ 20 for development

## Install

### From npm (recommended)

Install the published package with [pi install](https://github.com/earendil-works/pi/blob/master/docs/packages.md):

```bash
pi install npm:pi-model-pin
```

This installs the package into pi's package directory (personal install) and activates its extension.
Updates are applied with `pi update --extensions`.

### From git

Prefer the npm package, but you can also install directly from this repository:

```bash
pi install git:github.com/DevMolchy/pi-model-pin
```

A git source is cloned and kept in sync with the tracked version; updates are applied on the next
start or with `pi update --extensions`.

### Local development

Copy or symlink `index.ts` into pi's auto-discovery folder:

```bash
mkdir -p ~/.pi/agent/extensions
ln -s "$(pwd)/index.ts" ~/.pi/agent/extensions/pi-model-pin.ts
```

To *disable* (without uninstalling), remove the symlink. Any edit is picked up by `/reload`.

> Wherever the file lives, make sure you edit the copy in this repository and keep the link pointing here.

## Usage

| Action | Result |
|--------|--------|
| `pi` (new terminal) | configured default model |
| `/model <provider>/<model>` | switch to that model (becomes "pinned") |
| `/new` | new session **keeps** the pinned model |
| `Ctrl+P` cycling | last non-default model also gets pinned |
| `/model <default model>` | back on the default → pin cleared |
| `/pin-status` | shows `Pinned: <model>` or `No model pinned` |
| `/unpin` | drop the pinned model → next `/new` uses the default |

The footer shows a `Pinned model` indicator while a non-default model is pinned, and is blank otherwise.

## Development

```bash
npm install        # fetch dev dependencies (type checking + test harness)
npm test           # run the tests
npm run typecheck  # type-check index.ts with tsc
```

CI (`npm ci && npm run typecheck && npm test`) runs on every push with Node 20, 22 and 24.

## License

[MIT](LICENSE) © [DevMolchy](https://github.com/DevMolchy)

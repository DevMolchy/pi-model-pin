# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.0.0] - 2026-11-04

### Added

- Initial public release: keep a `/model` selection across `/new` sessions in
  the same pi process, resetting to the configured default in a new process.
- `pin-status` and `unpin` slash commands. `pin-status` reports
  `Pinned: <provider>/<id>` when pinned, or `No model pinned` otherwise.
- Footer `Pinned model` indicator while a non-default model is pinned, blank
  otherwise.
- Informational notification when `/new` restores the pinned model.
- Warning notification when the pinned model disappears from the model
  catalog.
- Test harness simulating factory re-invocation across `/new` (`npm test`).

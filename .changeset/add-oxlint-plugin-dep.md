---
"react-doctor": patch
---

Add `oxlint-plugin-react-doctor` to `dependencies` so it is installed
alongside the CLI. The bundler correctly externalises the plugin (oxlint
loads it by file path at runtime) but it was missing from the published
dependency list, causing `ERR_MODULE_NOT_FOUND` on `npx react-doctor`.

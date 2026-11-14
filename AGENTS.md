# OrderScraperExtension Agent Guide

- Surface: chrome-extension
- Verify: vgate
- Verify (manual): chrome://extensions -> Load unpacked -> run both scrapes, then export CSV/PDF
- Release: Reload the unpacked extension and verify the manifest before tagging.
- Architecture: ARCHITECTURE.md (stack map + invariants; keep it current)
- Version: manifest.json ("version"); bump it, then tag vX.Y.Z

## Conventions
- Keep diffs minimal; run the verify command before reporting work as done.
- Update this file when the stack or verification command changes.
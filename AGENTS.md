# Instructions for AI agents working in this repo

- Read `docs/PLAN.md`, then `docs/RESEARCH.md`. Where they differ, `RESEARCH.md` wins.
- Work one phase at a time. Record spike observations in `docs/SPIKE-RESULTS.md` with the date and tool version.
- Run `npm test` and `npm run validate` before every commit. CI runs both on Linux, macOS and Windows with Node 18, 20 and 22.
- The plugin has zero runtime dependencies and makes no network calls. Keep it that way.
- Hooks must always exit 0 and fail open. Never trap the user in a blocked turn.

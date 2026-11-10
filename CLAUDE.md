# Studio

Remotion + Electron video editor, target machine 8GB Apple Silicon. Read `README.md` first (decisions, security lessons, setup gotchas),
then `docs/spike-results.md`. Monorepo: `apps/desktop` (Electron app) and `packages/schema` (project schema). Run `pnpm typecheck` before committing. Do not commit fixtures or media. Every new IPC handler must call `assertTrusted`.

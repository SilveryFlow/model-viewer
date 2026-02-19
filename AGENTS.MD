Environment Rule: mise-first toolchain (MANDATORY)

- This machine uses `mise` as the single source of truth for runtimes and global CLIs.
- Never use `npm i -g` or `pnpm add -g` for tool installation.
- Install global CLIs via `mise` only: `mise use -g npm:<package>@<version>`.
- Prefer execution via `mise x ... -- <cmd>` / `mise exec -- <cmd>` when possible.
- Treat `mise` state-changing commands as exclusive/serial:
  - `mise use`, `mise install`, `mise reshim` MUST NOT run in parallel.
- Avoid running `mise reshim` unless explicitly required by the user.
- For Bun package executors, prefer `bun x <pkg>` (do not assume `bunx` command exists).
- If a required CLI is missing, first check `mise which <cmd>` and suggest a `mise use -g npm:<pkg>` fix.

Package Manager Rule: Bun-only project dependencies (MANDATORY)

- This project uses `bun` as the only package manager for workspace dependencies.
- Never use `npm i`, `npm install`, `pnpm add`, or `yarn add` in this project.
- Install or remove project dependencies only with `bun add`, `bun add -d`, `bun remove`, and `bun install`.
- Keep lockfile management on `bun.lock` only; do not generate or commit other lockfiles.

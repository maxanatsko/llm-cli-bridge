# AGENTS

**Project workflows**
- Build: `npm run build` (cleans `dist/`, runs `tsc`, chmods `dist/index.js`).
- Run (prod): `npm run start` (executes `node dist/index.js`).
- Run (dev): `npm run dev` (build then run `dist/index.js`).
- Tests: `npm run test` (Vitest run), `npm run test:watch`, and `npm run test -- tests/codex-backend.test.ts` for Codex backend regressions.
- Typecheck: `npm run lint` (`tsc --noEmit`).
- Docs: `npm run docs:dev`, `npm run docs:build`, `npm run docs:preview` (VitePress).

**Maintenance scripts**
- Wiki deploy: `./scripts/deploy-wiki.sh` (requires `wiki-enhanced.md` at repo root and `gh` installed; pushes to the GitHub wiki).
- Session integration test: `node ./scripts/test-all-sessions.js` (expects `dist/` to be built first).
- Version bump: `npm run bump-version -- <version|major|minor|patch|premajor|preminor|prepatch|prerelease>` (updates `package.json`, syncs `src/index.ts`, regenerates `package-lock.json`, verifies root metadata/bin aliases, and rebuilds committed `dist/`).

**Guardrails from recent commits**
- Tool registry source of truth is `src/tools/index.ts`; keep only stable/public tools registered. Do not leave deprecated aliases (for example `ask-gemini`) or test-only tools (for example `timeout-test`) in the registry.
- `dist/` is intentionally committed for `npx`/GitHub usage; after source changes, run `npm run build` and include matching `dist/` updates in the same change.
- For release/version chores, use `npm run bump-version -- <target>` instead of editing version metadata by hand; it is the expected path for keeping `package.json`, `package-lock.json`, `src/index.ts`, and committed `dist/index.js` synchronized.
- Keep package CLI entrypoint aliases stable during release chores; preserve `gemini-mcp-tool`, `gemini-mcp`, and `llm-cli-bridge` bin mappings unless intentionally making a breaking change.
- After package rename/version changes, verify lockfile root package identity (`name` and `packages[""].name`) matches `package.json`.
- For Codex CLI execution, place global flags (`-m`, `-a`, `-s`, `--config`) before `exec`; resume flows use `codex exec resume <threadId>`.
- For Codex reasoning effort, use `--config model_reasoning_effort="<level>"` (not `--reasoning-effort`).
- Codex JSON parsing must include `item.completed` events with nested `agent_message` payloads, not only legacy event shapes.
- When changing Codex backend argument building or JSON parsing, update/add coverage in `tests/codex-backend.test.ts` and run `npm run test -- tests/codex-backend.test.ts`.
- Sessions are stored under `~/.ai-cli-mcp/sessions/<tool-name>/`; keep legacy read compatibility from `~/.gemini-mcp/sessions/<tool-name>/` during migration.

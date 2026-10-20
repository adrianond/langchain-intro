# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository structure

This directory **is** the project — there's no separate `myapp/` subproject (an earlier version of this file described one; it no longer exists on disk) and this is **not** a git repository (no `.git` here). Everything below is run from this root.

- [package.json](package.json) — scripts and dependencies for the whole app.
- [langgraph.json](langgraph.json) — points to `./src/graph/nodes/factory.ts:graph`, used by the LangGraph CLI / LangGraph Studio / LangSmith.
- [tsconfig.json](tsconfig.json) — type-checking only (`noEmit: true`); the app runs directly via Node's native TS support, there's no separate build step.

## Commands

- `npm run dev` — starts the Fastify HTTP server on port 3000 (`node --env-file .env --inspect --watch src/index.ts`).
- `npm test` — runs the suite once with Node's built-in test runner (`node --env-file .env --test ./tests/**/*.test.ts`). This makes **real Anthropic API calls** (via `identifyIntentNode.ts`) — `ANTHROPIC_API_KEY` must be set in [.env](.env), and runs cost tokens / need network access.
- `npm run test:dev` — same as `npm test` but with `--inspect --watch`. In watch mode, saving a watched file **while a run is in progress aborts that run and counts it as a failure** — that's expected `node --test --watch` behavior (see `Restarted at ...` in the output), not a code bug. Use plain `npm test` when you want a trustworthy pass/fail count.
- `npm run langgraph:server` — `npx @langchain/langgraph-cli@latest dev`, starts the LangGraph Server / Studio locally using [langgraph.json](langgraph.json).

Tests use Node's **native `node:test` runner**, not Jest — there's no `jest.config.js` in this project.

### Windows / PowerShell notes

- The `**` glob in the `test`/`test:dev` scripts relies on Node's own test-runner glob matching, not shell expansion — PowerShell (unlike bash) does not expand `**` for external commands. If a script's glob ever needs changing, prefer pointing `--test` at an explicit file or a directory rather than assuming the shell will expand it.
- VS Code integrated terminal + debugging: if "Auto Attach" (JS Debug) is on for the terminal, it already injects a debug bootloader into every Node process launched there. A script that *also* passes `--inspect` (`dev`, `test:dev`) on top of that can throw `Error in the js-debug bootloader ... initialized without a V8::Inspector`. Fix by turning off Auto Attach for that terminal (`Debug: Toggle Auto Attach`) or by dropping `--inspect` from the script — not both at once.
- To debug via LangGraph Studio: start the studio process with the inspector on, then attach from VS Code:
  ```powershell
  $env:NODE_OPTIONS='--inspect'
  npm run langgraph:server
  ```
  then select **Attach to LangGraph Studio** in the Run/Debug panel ([.vscode/launch.json](.vscode/launch.json), port 9229).
- If `node --version` keeps reverting to an older version after every reboot despite installing a newer one: check `nvm list`. With `nvm4w` (NVM for Windows), `nvm use <version>` must be run in an **elevated (Administrator)** PowerShell — otherwise the symlink at `C:\nvm4w\nodejs` silently fails to update and you stay on the old version.

## Architecture

The whole app is one LangGraph graph plus a thin Fastify HTTP layer:

```
START → identifyIntent → (upperCase | lowerCase | fallback) → chatResponse → END
```

Only `identifyIntent` calls an LLM (to classify intent); the transform nodes themselves are deterministic string ops. LangSmith env vars add tracing on top of whichever entry point is used.

- [src/graph/graph.ts](src/graph/graph.ts) — defines `GraphState` (zod: `messages`, `output`, `command`) and `buildGraph()`, wiring the graph above. The routing function's returned key **must** exist in the `addConditionalEdges` destination map passed alongside it — a mismatch (e.g. a typo) isn't caught by TypeScript, since the map is a plain object literal; it fails at graph-invoke time with `Branch condition returned unknown or null destination`.
- [src/graph/nodes/identifyIntentNode.ts](src/graph/nodes/identifyIntentNode.ts) — calls `ChatAnthropic` (`claude-haiku-4-5`, `temperature: 0`, `maxTokens: 10`) with a system prompt asking for exactly one word (`uppercase` / `lowercase` / `unknown`), then validates the reply manually (`parseCommand`) against `VALID_COMMANDS` rather than trusting it outright. Deliberately **avoids `withStructuredOutput`/tool-calling**: under the `langgraph-cli dev` execution harness the tool-call result came back empty (`OUTPUT_PARSING_FAILURE`), so plain-text output + manual parsing is used instead — don't "fix" this back to structured output without re-testing under `npm run langgraph:server`. Empty input short-circuits to `unknown` without calling the model (Anthropic rejects empty user messages with a 400); a model/API error is caught and also degrades to `unknown` rather than failing the whole graph.
- [src/graph/nodes/upperCaseNode.ts](src/graph/nodes/upperCaseNode.ts) / [lowercaseNode.ts](src/graph/nodes/lowercaseNode.ts) — apply `.toUpperCase()` / `.toLowerCase()` to `state.output`. No LLM involved.
- [src/graph/nodes/fallbackNode.ts](src/graph/nodes/fallbackNode.ts) — used when `command` is `'unknown'`; replaces `output` with a fixed help message.
- [src/graph/nodes/chatResponseNode.ts](src/graph/nodes/chatResponseNode.ts) — appends `state.output` as an `AIMessage` to `messages`.
- [src/graph/nodes/factory.ts](src/graph/nodes/factory.ts) — exports `graph`, the entry point [langgraph.json](langgraph.json) points at.
- [src/server.ts](src/server.ts) — `createServer()` builds a Fastify app with `POST /chat` (body: `{ question: string }`, min length 5), invokes the compiled graph, returns `response.output` as the raw response body. Exported separately from `index.ts` so tests can use `app.inject(...)` without binding a real port.
- [src/index.ts](src/index.ts) — starts the server on port 3000.

### Two independent entry points, same graph

`server.ts`/`index.ts` (Fastify, port 3000, `npm run dev`) and the LangGraph CLI (`npm run langgraph:server`, its own API server on port 2024) never call each other — both just call `buildGraph()` from [src/graph/graph.ts](src/graph/graph.ts) independently. LangGraph Studio (visual graph, "Interact" panel, node-by-node execution) is only available through the second path; LangSmith tracing works identically through either path whenever the tracing env vars are set, since it's driven by global LangChain callbacks, not by which HTTP layer is on top.

Tests: [tests/server.test.ts](tests/server.test.ts) exercises all three branches (uppercase, lowercase, fallback) end-to-end through `createServer()` + `app.inject`, hitting the real `identifyIntent` LLM call each time.

Environment variables ([.env](.env)): `ANTHROPIC_API_KEY` (required — `identifyIntentNode` calls it directly), plus `LANGSMITH_API_KEY` / `LANGCHAIN_TRACING_V2` / `LANGCHAIN_PROJECT` for optional LangSmith tracing.

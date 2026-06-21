# 🔍 Tracelens

**A local-first, zero-backend debugger for AI agent traces.** Drop in a trace — OpenInference, OTel/OTLP, Codex, or Claude Code — and get a readable call tree with timings, tokens, cost, and errors. Search it, flamegraph it, diff two runs, share it by link — like DevTools for a single agent run.

[![live demo](https://img.shields.io/badge/demo-live-3DC9C0)](https://yuleo926.github.io/tracelens/) ![license](https://img.shields.io/badge/license-MIT-E8A23D) ![types](https://img.shields.io/badge/TypeScript-strict-3DC9C0) ![backend](https://img.shields.io/badge/backend-none-8B7CF6) ![status](https://img.shields.io/badge/status-v1-A78BFA)

**▶ [Try it live → yuleo926.github.io/tracelens](https://yuleo926.github.io/tracelens/)** — runs entirely in your browser, no install, nothing uploaded.

---

## Why

Debugging an agent usually means scrolling through deeply nested JSON at midnight, hunting for the one tool call that looped or the step that quietly failed.

The heavyweight observability platforms can show you this — but most of them want you to stand up a backend (ClickHouse, Postgres, Redis, a server) just to look at a run. That is the right tool for production fleets. It is the wrong tool for "I have one trace and I want to understand it _right now_."

**Tracelens is the lightweight companion.** Open a trace, see everything, close the tab. No account, no server, no upload — the file never leaves your browser.

## What it does

- **Reads many formats, auto-detected** — OpenInference / OTel GenAI, raw OpenTelemetry (OTLP) JSON, Codex (`codex exec --json` and saved session rollouts), Claude Code transcripts, and raw Anthropic Messages logs — as JSON or JSONL. Drop the file; Tracelens figures out the format.
- **Call tree with an inline waterfall** — every span is colored by kind (LLM, tool, retriever, agent…) and shows where in the run it happened and how long it took.
- **Search + jump** — filter the tree as you type (`⌘K`) across names, models, input/output, and jump straight to the next error or the slowest span.
- **Flamegraph** — see where the time and the money went, weighted by duration, tokens, or cost.
- **Diff two runs** — load a second trace and compare: a summary delta bar (regressions in red, improvements in green) over a merged tree that flags what changed, was added, or removed.
- **Shareable export** — copy a self-loading link (the trace lives in the URL) or download the JSON; nothing is uploaded.
- **Roll-ups, errors, and a detail panel** — total duration / tokens / cost / errors at a glance; failed spans flagged in red; per-span input, output, model, tokens, and raw attributes.
- **Light & dark**, bundled sample traces, and **100% client-side** — static build, works offline, the file never leaves your browser.

## Quickstart

```bash
npm install
npm run dev
```

Open the printed URL (default `http://localhost:5173`), then **click a sample** or **drop your own trace file**.

```bash
npm run build      # production build to dist/
npm run preview    # serve the built app
npm test           # run the core test suite (Vitest)
npm run typecheck  # strict type check
```

## Deploy

Tracelens is a static single-page app — `npm run build` emits a self-contained bundle in `dist/` that you can host anywhere. No server, no environment variables, no secrets; the trace file never leaves the browser, so any plain static host is enough.

- **Netlify / Vercel / Cloudflare Pages** — point the project at this repo, set the build command to `npm run build` and the publish directory to `dist/`. That's the whole setup.
- **GitHub Pages / any sub-path host** — when the app is served from a sub-path (e.g. `https://you.github.io/tracelens/`), set Vite's [`base`](https://vitejs.dev/config/shared-options.html#base) to that path (`base: '/tracelens/'` in `vite.config.ts`) and rebuild. The bundled sample fetches already go through `import.meta.env.BASE_URL`, so they resolve correctly under any base.
- **Locally** — `npm run preview` serves the built `dist/` so you can sanity-check the production bundle before shipping.

## Loading your own trace

Tracelens accepts a JSON **array of spans**, or an object shaped like `{ "spans": [ … ] }`. Each span looks like:

```json
{
  "span_id": "a3",
  "parent_span_id": "a1",
  "name": "tool.web_search",
  "start_time": "2026-06-18T10:00:01.380Z",
  "end_time": "2026-06-18T10:00:03.120Z",
  "status_code": "OK",
  "attributes": {
    "openinference.span.kind": "TOOL",
    "tool.name": "web_search",
    "input.value": "...",
    "output.value": "..."
  }
}
```

Times may be ISO strings, epoch milliseconds, or OTLP unix-nanoseconds. **The format is auto-detected** — besides the native span array, Tracelens reads OpenTelemetry (OTLP) JSON, Codex `codex exec --json` and saved session rollouts (`~/.codex/sessions/…`), Claude Code transcripts (`~/.claude/projects/…`), and raw Anthropic Messages logs, as JSON or JSONL. Each format is one small file in [`src/core/adapters/`](src/core/adapters) (the per-attribute mapping lives in [`src/core/openinference.ts`](src/core/openinference.ts)); adding another is a few lines. See [`public/samples/`](public/samples) for complete, working examples.

## Architecture

The parsing core is deliberately separate from the UI: it is pure, dependency-free, and unit-tested, so it could ship as a standalone npm package and the React layer is just a renderer over its output.

```mermaid
flowchart LR
  raw["Raw trace<br/>(OpenInference / OTLP / Codex / Claude Code)"] --> adapt["detect + flatten<br/>core/adapters/"]
  adapt --> norm["normalize<br/>openinference.ts"]
  norm --> parse["build tree + summary<br/>parse.ts"]
  parse --> views["Call tree · Flamegraph · Diff · Detail"]
```

```
src/
├─ core/                 # framework-agnostic, no React, fully tested
│  ├─ types.ts           #   canonical span/tree/summary model
│  ├─ adapters/          #   format detection: OTLP, Codex, Claude Code, native…
│  ├─ openinference.ts   #   raw attributes -> canonical model
│  ├─ parse.ts           #   spans -> tree + roll-up (JSON & JSONL aware)
│  ├─ search.ts          #   filter + error/slowest jumps
│  ├─ flame.ts           #   flamegraph aggregates + icicle layout
│  ├─ diff.ts            #   align two runs into a merged diff
│  ├─ share.ts           #   gzip + base64url share links
│  └─ format.ts          #   duration / token / cost formatting
├─ lib/                  # kinds (span kind -> color), view registry
├─ theme/                # light/dark provider (token-driven)
└─ components/           # shell · views (tree / flamegraph / diff) · detail · loader
```

## Roadmap

**v0 — shipped.** Parse a trace, render the tree + inline waterfall, detail panel, bundled samples.

**v1 — make it a debugger. ✅ shipped.**
- ✅ Diff two runs side by side (catch regressions)
- ✅ Token / cost flamegraph — where did the time and money go
- ✅ Search across spans and jump straight to errors / the slowest call
- ✅ Shareable export — a URL-encoded trace (and JSON download), so a teammate can open a failing run with one click
- ✅ Import adapters — OTLP/OpenTelemetry, Codex (`exec --json` **and** saved session rollouts), and Claude (Messages logs **and** Claude Code transcripts), JSON or JSONL

**v2 — make it a layer others build on.**
- Publish the components as a headless, shadcn-style library to drop into any app
- A Tauri desktop build that tails local agent logs live
- Span annotations that export to evaluation datasets

## Renaming the project

The name appears in exactly three places: the `name` field in `package.json`, the wordmark in `src/App.tsx`, and the `<title>` in `index.html`. Change those and you're done. (Check that the name is free on npm and GitHub before you publish.)

## Contributing

PRs welcome — the highest-leverage contributions are **new trace-format adapters** in [`src/core/adapters/`](src/core/adapters) (each is one self-contained file with a `detect` + a `toLooseSpans`) and **sample traces** in `public/samples/`. Please run `npm test` before opening a PR.

## License

MIT © 2026 LiDesheng926

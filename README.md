# GPT Observatory

GPT Observatory is a local factual state system for understanding what GPT/agent work is doing across conversations, tasks, repositories, runs, and other observed entities.

The canonical store is embedded SurrealDB. Observations are append-only evidence; current facts and relations are time-bounded state derived from those observations. Semantic embeddings and Obsidian files are rebuildable projections, not alternate truth sources.

## Product views

- **SUPERVISED TASKS** — Watchdog-owned task supervision and current conversation bindings.
- **FACT EXPLORER** — current factual state grouped by meaning, with source authority plus observation / recorded / valid-from evidence details.
- **TIMELINE** — actual fact-version transitions.
- **KNOWLEDGE GRAPH** — current factual relations.
- **SEMANTIC SEARCH** — local semantic retrieval over factual state. The installed app uses a pinned q8 MiniLM model from local user storage; remote model loading is disabled at runtime, with a deterministic 384-dimensional local-hash fallback if the model is unavailable.
- **Obsidian projection** — generated entity notes, wikilinks, dashboard, and Base definition.

## Install the local app

Development still supports the split Vite/API workflow, but normal use is packaged as one local process: the Node API serves the built frontend from the same `127.0.0.1:4317` origin.

```bash
npm install
npm run app:install
```

On Windows this creates an independent local installation:

```text
%LOCALAPPDATA%\GPTObservatory\
├─ app\current\        compiled UI + server + production dependencies
├─ data\observatory     canonical RocksDB (survives app upgrades)
├─ launcher\            stable start / stop entrypoints
├─ models\              pinned local MiniLM embedding model
├─ runtime\             PID and logs
└─ GPT Observatory.ico
```

It also creates:

- **GPT Observatory** on the Desktop and in the Start Menu.
- A standalone Edge app window when Microsoft Edge is available, with browser fallback otherwise.
- `gpt-observatory-app` and `gpt-observatory-stop` in the user `bin` directory.
- `gpt-observatory` and `gpt-observatory-mcp` backed by the installed compiled JS, not the Git checkout.
- The user `bin` directory on the Windows User PATH when needed.

The installed app does not depend on the source checkout or its `node_modules`. Development and installed runtimes both use the same stable user-data home, so there is only one default canonical RocksDB. The installer also prepares and SHA-256 verifies a pinned `Xenova/all-MiniLM-L6-v2` q8 model before entering the downtime window; later upgrades reuse that verified local model without network access.

After installation:

```bash
npm start
# or
gpt-observatory-app
```

If Observatory is already running, the launcher only opens the UI and does not start a duplicate server.

Stop it with:

```bash
npm stop
# or
gpt-observatory-stop
```

The production UI and API both use `http://127.0.0.1:4317`. The production server returns a signed health response (`service=gpt-observatory`) so launchers do not mistake an unrelated service on the same port for Observatory.

For frontend development:

```bash
npm run dev
```

## Agent access

Any shell-capable local agent can use the stable CLI from any working directory after the user-level launcher is installed:

```bash
gpt-observatory context --recent 20
gpt-observatory now
gpt-observatory timeline
gpt-observatory graph
gpt-observatory search "semantic query"
```

MCP-capable clients can launch the stdio adapter with `gpt-observatory-mcp`. The MCP surface exposes:

- `observatory_context`
- `observatory_now`
- `observatory_timeline`
- `observatory_graph`
- `observatory_search`
- `observatory_observe`
- `observatory_relate`
- `observatory_reindex`

Both adapters call the canonical HTTP API; neither opens RocksDB as another owner.

## Validate

```bash
npm run lint
npm test
npm run build
npm run app:icon
npm run export:obsidian
npm run agent -- context --recent 5
```

The Obsidian export reads the canonical API rather than opening the embedded database as a second owner.

## Core invariant

No observation means **unknown**, not unchanged.

A repeated observation with the same value adds observation coverage but does not fabricate a fact transition. A new fact version is created only when an observed value actually changes.

See [docs/ENGINEERING.md](docs/ENGINEERING.md) for the ontology, residuals, evidence gates, and acceptance scenarios.

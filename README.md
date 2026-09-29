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

### Windows: GitHub Release

For a normal Windows machine, use the GitHub Release artifacts. The target machine does **not** need Git, npm, Node.js, a compiler, or a Hugging Face download at runtime.

Preferred:

```text
GPT-Observatory-Setup-x64.exe
```

Portable / inspectable alternative:

```text
GPT-Observatory-Portable-x64.zip
└─ Install-GPT-Observatory.cmd
```

Both release forms contain the same verified payload:

- compiled frontend and server;
- production-only Node dependencies;
- a bundled Node x64 runtime;
- the pinned q8 MiniLM model;
- launcher / rollback logic;
- CLI and MCP entrypoints;
- a SHA-256 payload manifest.

The bootstrap verifies the payload manifest **before** creating or mutating the installation. User data is never included in the release package.

### Developer/source installation

Development still supports the split Vite/API workflow. A developer can also install directly from a checkout:

```bash
npm install
npm run app:install
```

Both Release and source installation converge on the same independent local installation:

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

Release upgrades keep canonical data outside the application snapshot, stage the replacement before the downtime window, retain one `.previous` snapshot, and automatically restore that snapshot if post-swap startup fails.

### Watchdog integration on another machine

GPT Observatory and Watchdog have separate ownership. Installing Observatory alone gives you the Fact Explorer, Timeline, Knowledge Graph, Semantic Search, CLI, and MCP access. To populate **Supervised Tasks** on another machine, that machine must also run a compatible Watchdog/Browser Relay and register the tasks it should supervise. Observatory deliberately does not discover arbitrary ChatGPT tabs on its own.

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
gpt-observatory tasks
gpt-observatory prompt-get <task-id>
gpt-observatory prompt-set <task-id> --expected-version 0 --step-index 1 --prompt "只推进下一最小可验证步骤" --updated-by agent
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
- `observatory_supervised_tasks`
- `observatory_task_prompt_get`
- `observatory_task_prompt_update`

Both adapters call the canonical HTTP API; neither opens RocksDB as another owner. Adaptive task prompts are also not owned by Observatory: prompt reads/writes are proxied to Watchdog protocol v4, where `expectedVersion` provides CAS protection. Observatory only projects the resulting prompt state into factual history and disables prompt editing when the connected Watchdog does not advertise protocol v4.

### Adaptive prompt loop

For one Watchdog-supervised task, the intended agent loop is:

```text
read task + prompt version
→ execute one observable step
→ inspect the real result
→ decide the next smallest useful step
→ CAS-update that next-step prompt
→ end the current turn
→ Watchdog uses the new prompt on the next continuation tick
```

The adaptive body is deliberately weaker than the Watchdog envelope. The base task identity, `SUPERVISOR_DONE` gate, `[SUPERVISOR_STATE: NEED_INPUT]` gate and completion semantics are rendered by Watchdog and cannot be replaced from the UI, CLI or MCP.

If a prompt update returns HTTP 409 / `prompt_version_conflict`, re-read the task prompt and reconcile the newer version before deciding whether another update is still appropriate. Never blindly retry a stale write.

If the task is complete, do not invent another continuation step. If human input is required, do not write a next-step prompt that assumes the input already happened.

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

# GPT Observatory

GPT Observatory is a local factual state system for understanding what GPT/agent work is doing across conversations, tasks, repositories, runs, and other observed entities.

The canonical store is embedded SurrealDB. Observations are append-only evidence; current facts and relations are time-bounded state derived from those observations. Semantic embeddings and Obsidian files are rebuildable projections, not alternate truth sources.

## V1 views

- **NOW** — current factual state for observed entities.
- **TIMELINE** — actual fact-version transitions.
- **GRAPH** — current factual relations.
- **SEARCH** — local semantic retrieval over factual state.
- **Obsidian projection** — generated entity notes, wikilinks, dashboard, and Base definition.

## Run locally

```bash
npm install
npm run start:server
npm run dev:web -- --host 127.0.0.1 --port 4318
```

The API defaults to `http://127.0.0.1:4317` and the Vite development UI to `http://127.0.0.1:4318`.

## Validate

```bash
npm run lint
npm test
npm run build
npm run export:obsidian
```

The Obsidian export reads the canonical API rather than opening the embedded database as a second owner.

## Core invariant

No observation means **unknown**, not unchanged.

A repeated observation with the same value adds observation coverage but does not fabricate a fact transition. A new fact version is created only when an observed value actually changes.

See [docs/ENGINEERING.md](docs/ENGINEERING.md) for the ontology, residuals, evidence gates, and acceptance scenarios.

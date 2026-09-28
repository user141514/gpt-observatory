# GPT Observatory — engineering contract

## Outcome

A new agent or a human can open one local system and recover the factual state of ongoing GPT work without relying on a previous model's narrative handoff.

The first vertical slice is complete when real persisted data can be:

1. ingested as observations,
2. projected into current facts,
3. traversed as a graph,
4. retrieved semantically through a vector index,
5. inspected in NOW / TIMELINE / GRAPH / SEARCH views,
6. exported into an Obsidian vault that remains a rebuildable projection.

## Authority model

SurrealDB is the canonical store.

- `observation` is append-only evidence that a source actually looked.
- `fact` stores state intervals. A new fact version is created only when the observed value changes.
- `relation` stores time-bounded factual graph edges.
- `semantic_doc` is a derived vector/full-text index and may be rebuilt.
- Obsidian files are a derived human-readable projection and may be rebuilt.

Neither embeddings, graph visualisation, nor Obsidian notes may overwrite canonical observations or facts.

## Composition invariant

A projection may lag or be deleted without changing factual truth. The canonical state is valid iff every displayed current value can be traced to an observation, and absence of an observation is never rendered as "unchanged".

Counterexample: two successful polls report `status=running`. This is two observations but one open fact interval. If the second poll creates another fact, TIMELINE fabricates a transition that did not happen.

## Supervision identity contract

For Watchdog-supervised work, identity is ordered:

```text
Task
  ↓ current execution binding
Conversation
  ↓ transient runtime rendering
Tab
```

- **Task is the stable business identity.** It survives conversation replacement.
- **Conversation is the current execution binding.** A task may move to a replacement conversation without becoming a new task.
- **Tab is runtime-only.** Refreshing, reopening, replacing, or losing a browser tab must not create a new task or durable factual entity.
- **Watchdog Registry owns the supervised-task allowlist and current task→conversation binding.**
- **Observatory owns temporal factual history and projections.** It must not invent supervision membership or become a second task-lifecycle authority.
- Browser Relay may be queried only to resolve the current tab for a conversation already present in the Watchdog supervised set. Unregistered ChatGPT tabs remain invisible to supervision ingestion.

Core invariant:

> Task identity survives conversation replacement; conversation identity survives tab replacement.

## V1 ontology

### Source
Who or what observed reality: user input, ChatGPT connector, Watchdog, Sidecar, Git, filesystem, process observer, DevSpace, or another explicit adapter.

### Entity
A stable object with identity. Initial types:
`conversation`, `task`, `agent`, `agent_session`, `project`, `repo`, `branch`, `worktree`, `experiment`, `run`, `process`, `host`, `file`, `artifact`.

### Observation
One source examining one entity at one time. It records coverage even when no fact changed.

### Fact
One atomic attribute value over a validity interval.

### Relation
A factual edge between two entities, also with a validity interval and observation provenance.

### Semantic document
A canonical textual serialization of factual state or a factual change, with a local 384-dimensional embedding.

## Structured residual

| Residual | Required evidence | Status |
| --- | --- | --- |
| R0 Canonical local persistence | restart retains observations/facts | passed: forced restart preserved the same entity, observation time, and fact |
| R1 unchanged != unknown | same-value observation increments observations, not facts | passed: unit + live observation evidence |
| R2 factual timeline | changed value closes old fact and opens new fact | passed: unit test + live phase transition |
| R3 knowledge graph | current factual relations render as traversable graph | passed: relation de-duplication test + live USES edge |
| R4 vector retrieval | local embedding + SurrealDB HNSW returns semantic neighbours | passed: local MiniLM query returned task/repo neighbours |
| R5 human visual acceptance | NOW / TIMELINE / GRAPH / SEARCH use live API data | ready for human acceptance at local Vite UI on port 4318 |
| R6 Obsidian projection | generated Markdown + .base files contain wikilinks/frontmatter | passed: API-backed export generated vault successfully |
| R7 GPT conversation ingestion | Watchdog registered Task → current Conversation projection; Relay only resolves runtime Tab for registered conversations | passed in source tests; live task-first Watchdog deployment pending |
| R8 Watchdog supervision | task-first registry survives process restart and a real poll cycle with fresh success | source contract passed; live runtime deployment/poll still pending |

## Acceptance scenarios

1. Write `task.status=running` twice under two observations.
   - observations = 2
   - open facts for `task.status` = 1
   - timeline transitions = 0
2. Write `task.status=completed`.
   - observations = 3
   - facts for `task.status` = 2
   - first fact has `valid_to`
   - second fact remains open
   - timeline contains exactly one transition
3. Relate a task to a repo.
   - graph shows two nodes and one factual edge
   - edge has observation provenance
4. Reindex current entity state.
   - a semantic search for a related phrase returns the entity through HNSW
5. Export Obsidian.
   - each entity has a Markdown note with factual frontmatter and wikilinks
   - `Views/Entities.base` opens as an Obsidian Base; Base Graph can render it when installed.

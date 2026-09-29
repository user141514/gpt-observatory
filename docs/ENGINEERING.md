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

Canonical acceptance is never revoked by a rebuildable projection failure. In particular, once an observation/fact write succeeds, semantic indexing may report a degraded projection warning, but must not cause the API to return a canonical-write failure or invite the caller to retry the authoritative write.

Counterexample: two successful polls report `status=running`. This is two observations but one open fact interval. If the second poll creates another fact, TIMELINE fabricates a transition that did not happen.

## Windows release contract

Windows distribution is a packaging layer over the existing installer, not a second installation authority.

```text
Git tag
  ↓
GitHub Actions
  ↓
prebuilt payload
  ├─ compiled dist/server
  ├─ production node_modules
  ├─ bundled Node x64 runtime
  ├─ pinned q8 MiniLM model
  ├─ payload-manifest.json
  └─ existing installer/launcher primitives
        ↓
Setup.exe / Portable.zip
        ↓
%LOCALAPPDATA%\GPTObservatory
```

Release invariants:
- release assets contain program/runtime/model state only; canonical `data/observatory` is never packaged;
- Setup EXE and Portable ZIP invoke the same `install-desktop.mjs` transaction used by source installation;
- payload SHA-256 verification completes before any target installation mutation;
- the target machine does not require Git, npm, Node.js, build tools, or runtime model downloads;
- release-mode installation copies prebuilt production dependencies rather than running npm on the target;
- only Windows x64 native binaries are retained in the Windows x64 payload;
- fresh-machine installation must pass from an empty data directory without an existing RocksDB;
- post-swap startup failure still follows the existing `current → .previous` rollback contract.

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

### Adaptive continuation prompt contract

Watchdog Registry is the sole authority for each supervised Task's continuation prompt state. The state is keyed by `task_id`, versioned with CAS (`expected_version`), persisted in the Watchdog registry, and therefore survives daemon restart and conversation rebind. Watchdog—not Observatory, UI, or an agent—renders the immutable supervision envelope containing task identity, prompt version, `SUPERVISOR_DONE`, and `NEED_INPUT`; callers may only replace the adaptive step body and step index.

Each continuation tick snapshots exactly one prompt generation before transport work. A CAS prompt update commits immediately under the Watchdog Registry authority and does not wait for an already-running tick; that tick may finish with its existing snapshot, while the next eligible tick must use the new version. Protocol-v4 watchers must support prompt injection or fail closed. Observatory is only a proxy/projection: it exposes UI/CLI/MCP access, records observed prompt facts, and disables/rejects prompt operations against pre-v4 Watchdog rather than fabricating version-zero state.

Protocol v4 is fail-closed: a missing prompt payload, task-identity mismatch, or invalid prompt version/step schema invalidates that Watchdog projection instead of being normalized into a plausible default. The `watchdog_prompt_*` fact namespace is Watchdog-owned; generic `/api/observe` and `observatory_observe` callers are forbidden from writing or covering those attributes, so they cannot create, overwrite, or close authoritative prompt fact intervals.

Recommended agent loop after each verified step:
1. read the current Task prompt state;
2. compare the observed result with the task target and identify the highest-leverage residual;
3. CAS-update `expectedVersion=current.version`, increment/choose `stepIndex`, and write only the smallest next discriminating action;
4. let Watchdog render the immutable envelope and deliver that next-step prompt on the next eligible continuation.

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

Embedding backend contract:
- preferred: pinned `Xenova/all-MiniLM-L6-v2@751bff37182d3f1213fa05d7196b954e230abad9#q8`, prepared under stable user storage and verified by SHA-256;
- runtime remote-model access is disabled;
- if the local model is absent or cannot load, semantic search falls back to deterministic `observatory/local-hash-384-v1` rather than failing or reaching the network;
- the semantic index records its embedding model and self-heals when the current backend or source fact set changes.

## Structured residual

| Residual | Required evidence | Status |
| --- | --- | --- |
| R0 Canonical local persistence | restart retains observations/facts | passed: forced restart preserved the same entity, observation time, and fact |
| R1 unchanged != unknown | same-value observation increments observations, not facts | passed: unit + live observation evidence |
| R2 factual timeline | changed value closes old fact and opens new fact | passed: unit test + live phase transition |
| R3 knowledge graph | current factual relations render as traversable graph | passed: relation de-duplication test + live USES edge |
| R4 vector retrieval | local embedding + SurrealDB HNSW returns semantic neighbours | passed: pinned q8 MiniLM local-only embedding works at 384 dimensions; offline fallback + self-healing semantic-index test also passes |
| R5 human visual acceptance | NOW / TIMELINE / GRAPH / SEARCH use live API data | ready for human acceptance at local Vite UI on port 4318 |
| R6 Obsidian projection | generated Markdown + .base files contain wikilinks/frontmatter | passed: API-backed export generated vault successfully |
| R7 GPT conversation ingestion | Watchdog registered Task → current Conversation projection; Relay only resolves runtime Tab for registered conversations | passed: source tests + live protocol-v3 task-first projection |
| R8 Watchdog supervision | task-first registry survives process restart and a real poll cycle with fresh success | passed: live deployed task-first supervision with persisted task identity, real successful poll, and Observatory projection; adaptive prompt rollout advances the control protocol to v4 |

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

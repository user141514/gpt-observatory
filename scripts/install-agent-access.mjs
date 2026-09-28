import { existsSync } from 'node:fs'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = homedir()
const binDir = join(home, 'bin')
const skillDir = join(home, '.agents', 'skills', 'gpt-observatory')
const node = process.execPath

const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
const installedApp = join(localAppData, 'GPTObservatory', 'app', 'current')
const installedCli = join(installedApp, 'server', 'agent-cli.js')
const installedMcp = join(installedApp, 'server', 'agent-mcp.js')
const usingInstalledApp = existsSync(installedCli) && existsSync(installedMcp)

const loader = resolve(root, 'node_modules', 'tsx', 'dist', 'loader.mjs')
const sourceCli = resolve(root, 'server', 'agent-cli.ts')
const sourceMcp = resolve(root, 'server', 'agent-mcp.ts')
const loaderUrl = pathToFileURL(loader).href

const cliArgs = usingInstalledApp
  ? [installedCli]
  : ['--import', loaderUrl, sourceCli]
const mcpArgs = usingInstalledApp
  ? [installedMcp]
  : ['--import', loaderUrl, sourceMcp]

await Promise.all([
  mkdir(binDir, { recursive: true }),
  mkdir(skillDir, { recursive: true }),
])

const slash = value => value.replaceAll('\\', '/')
const shellNode = slash(node)
const shellQuote = value => "'" + slash(value).replaceAll("'", "'\\''") + "'"
const cmdQuote = value => '"' + value.replaceAll('"', '""') + '"'

const bashCli = `#!/usr/bin/env bash
set -euo pipefail
exec '${shellNode}' ${cliArgs.map(shellQuote).join(' ')} "$@"
`

const bashMcp = `#!/usr/bin/env bash
set -euo pipefail
exec '${shellNode}' ${mcpArgs.map(shellQuote).join(' ')}
`

const cmdCli = `@echo off
setlocal
"${node}" ${cliArgs.map(cmdQuote).join(' ')} %*
`

const cmdMcp = `@echo off
setlocal
"${node}" ${mcpArgs.map(cmdQuote).join(' ')}
`

await Promise.all([
  writeFile(join(binDir, 'gpt-observatory'), bashCli, 'utf8'),
  writeFile(join(binDir, 'gpt-observatory-mcp'), bashMcp, 'utf8'),
  writeFile(join(binDir, 'gpt-observatory.cmd'), cmdCli, 'utf8'),
  writeFile(join(binDir, 'gpt-observatory-mcp.cmd'), cmdMcp, 'utf8'),
])
await Promise.all([
  chmod(join(binDir, 'gpt-observatory'), 0o755).catch(() => {}),
  chmod(join(binDir, 'gpt-observatory-mcp'), 0o755).catch(() => {}),
])

const explicitMcpArgs = mcpArgs.map(arg => `  ${arg}`).join('\n')
const modeLabel = usingInstalledApp
  ? 'installed application snapshot'
  : 'source development checkout'

const skill = `---
name: gpt-observatory
description: Use when an agent needs to recover, inspect, search, or append factual state about ongoing GPT/agent work across conversations, tasks, repositories, experiments, runs, processes, or hosts. Prefer Observatory over reconstructing state from chat summaries when authoritative local state is needed.
---

# GPT Observatory

GPT Observatory is the local factual state system at \`http://127.0.0.1:4317\`.

Current launcher mode: **${modeLabel}**.

## Authority

The canonical database is owned by the Observatory API. Do not open or mutate its embedded RocksDB directly.

- Observations are evidence that a source actually looked.
- Facts are time-bounded state intervals.
- Repeated same-value observations add coverage but do not create fake transitions.
- Graph edges are factual observation-backed relations.
- Semantic vectors and Obsidian notes are derived projections.

No observation means **unknown**, not unchanged.

## First action when resuming work

\`\`\`bash
gpt-observatory context --recent 20
\`\`\`

Use this before reconstructing long-running task state from model narrative.

## Read commands

\`\`\`bash
gpt-observatory health
gpt-observatory context --recent 20
gpt-observatory now
gpt-observatory timeline
gpt-observatory graph
gpt-observatory search "semantic query"
\`\`\`

## Write commands

Use \`gpt-observatory observe\` only for directly observed or explicitly sourced factual state.
Use \`gpt-observatory relate\` only for factual relations with a real source.
Do not store speculative causal claims as facts.

## MCP

Shell-backed clients can run:

\`\`\`text
gpt-observatory-mcp
\`\`\`

Explicit MCP process configuration:

\`\`\`text
command: ${node}
args:
${explicitMcpArgs}
\`\`\`

Tools:
- observatory_context
- observatory_now
- observatory_timeline
- observatory_graph
- observatory_search
- observatory_observe
- observatory_relate
- observatory_reindex

If the API is unavailable, report Observatory as unavailable. Do not open RocksDB directly as a fallback.
`

await writeFile(join(skillDir, 'SKILL.md'), skill, 'utf8')

console.log(JSON.stringify({
  root,
  mode: usingInstalledApp ? 'installed-app' : 'source-development',
  binDir,
  skillDir,
  commands: [
    join(binDir, 'gpt-observatory'),
    join(binDir, 'gpt-observatory-mcp'),
    join(binDir, 'gpt-observatory.cmd'),
    join(binDir, 'gpt-observatory-mcp.cmd'),
  ],
  skill: join(skillDir, 'SKILL.md'),
}, null, 2))

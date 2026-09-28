#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { ObservatoryAgentClient } from './agent-client.js'

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (!command || ['-h', '--help', 'help'].includes(command)) {
    printHelp()
    return
  }

  const client = new ObservatoryAgentClient()
  let result: unknown

  switch (command) {
    case 'health':
      result = await client.health()
      break
    case 'context':
      result = await client.context({ recent: numberOption(args, '--recent', 20) })
      break
    case 'now':
      result = await client.now()
      break
    case 'timeline':
      result = await client.timeline()
      break
    case 'graph':
      result = await client.graph()
      break
    case 'search': {
      const query = positional(args).join(' ').trim()
      if (!query) throw new Error('search requires a query')
      result = await client.search(query)
      break
    }
    case 'observe':
      result = await client.observe(await jsonInput(args))
      break
    case 'relate':
      result = await client.relate(await jsonInput(args))
      break
    case 'reindex':
      result = await client.reindex()
      break
    default:
      throw new Error(`unknown command: ${command}`)
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

function positional(args: string[]): string[] {
  return args.filter((value, index) => {
    if (value === '--recent' || value === '--json' || value === '--file') return false
    if (index > 0 && ['--recent', '--json', '--file'].includes(args[index - 1]!)) return false
    return true
  })
}

function numberOption(args: string[], name: string, fallback: number): number {
  const index = args.indexOf(name)
  if (index < 0) return fallback
  const value = Number(args[index + 1])
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} requires a positive integer`)
  return value
}

async function jsonInput(args: string[]): Promise<unknown> {
  const jsonIndex = args.indexOf('--json')
  if (jsonIndex >= 0) {
    const raw = args[jsonIndex + 1]
    if (!raw) throw new Error('--json requires a JSON object')
    return JSON.parse(raw)
  }

  const fileIndex = args.indexOf('--file')
  if (fileIndex >= 0) {
    const path = args[fileIndex + 1]
    if (!path) throw new Error('--file requires a path')
    return JSON.parse(await readFile(path, 'utf8'))
  }

  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
    const raw = Buffer.concat(chunks).toString('utf8').trim()
    if (raw) return JSON.parse(raw)
  }

  throw new Error('provide JSON via --json, --file, or stdin')
}

function printHelp() {
  process.stdout.write(`GPT Observatory agent CLI

Usage:
  npm run agent -- health
  npm run agent -- context [--recent 20]
  npm run agent -- now
  npm run agent -- timeline
  npm run agent -- graph
  npm run agent -- search <query>
  npm run agent -- observe --json '<payload>'
  npm run agent -- relate --json '<payload>'
  npm run agent -- reindex

Environment:
  OBSERVATORY_API=http://127.0.0.1:4317
`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

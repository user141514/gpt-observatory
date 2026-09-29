import { existsSync, openSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const explicitInstallHome = process.env.GPT_OBSERVATORY_INSTALL_HOME
  ? resolve(process.env.GPT_OBSERVATORY_INSTALL_HOME)
  : undefined
const userInstallHome = process.env.LOCALAPPDATA
  ? resolve(process.env.LOCALAPPDATA, 'GPTObservatory')
  : undefined
const installedCandidates = [
  explicitInstallHome
    ? resolve(explicitInstallHome, 'app', 'current')
    : undefined,
  resolve(scriptRoot, 'app', 'current'),
  userInstallHome
    ? resolve(userInstallHome, 'app', 'current')
    : undefined,
].filter(Boolean)
const installedCandidate = installedCandidates.find(candidate =>
  existsSync(resolve(candidate, 'server', 'index.js')),
)
const installedMode = Boolean(installedCandidate)
const appRoot = resolve(
  process.env.GPT_OBSERVATORY_APP_ROOT
    ?? (installedMode ? installedCandidate : scriptRoot),
)
const inferredHome = installedMode
  ? resolve(installedCandidate, '..', '..')
  : appRoot
const homeRoot = resolve(
  process.env.GPT_OBSERVATORY_HOME ?? inferredHome,
)
const url = process.env.OBSERVATORY_URL ?? 'http://127.0.0.1:4317/'
const appUrl = new URL(url)
const healthUrl = new URL('/api/health', appUrl).href
const port = Number(appUrl.port || 4317)
const startupTimeoutMs = Math.max(
  10_000,
  Number(process.env.GPT_OBSERVATORY_START_TIMEOUT_MS ?? 60_000),
)
const maxStartAttempts = Math.max(
  1,
  Number(process.env.GPT_OBSERVATORY_START_ATTEMPTS ?? 3),
)
const runtimeDir = resolve(homeRoot, installedMode ? 'runtime' : '.runtime')
const pidFile = resolve(runtimeDir, 'server.pid')
const logFile = resolve(runtimeDir, 'server.log')
const errFile = resolve(runtimeDir, 'server.err.log')
const distIndex = resolve(appRoot, 'dist', 'index.html')
const installedServerEntry = resolve(appRoot, 'server', 'bootstrap.js')
const sourceServerEntry = resolve(appRoot, 'server', 'bootstrap.ts')
const expectedServerEntry = installedMode ? installedServerEntry : sourceServerEntry
const loader = resolve(appRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs')
const expectedServerArgs = installedMode
  ? [installedServerEntry]
  : ['--import', pathToFileURL(loader).href, sourceServerEntry]

await mkdir(runtimeDir, { recursive: true })

if (await healthy()) {
  const existingPid = discoverServerPid()
  if (!existingPid) {
    console.error(
      `Port ${port} answers as GPT Observatory, but the listener is not the expected process: ${expectedServerEntry}`,
    )
    process.exit(1)
  }
  await writeFile(pidFile, String(existingPid), 'utf8')
  openBrowser(url)
  process.exit(0)
}

if (!existsSync(distIndex)) {
  if (installedMode) {
    console.error(`Installed GPT Observatory is incomplete: missing ${distIndex}`)
    process.exit(1)
  }
  const build = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm run build'], {
        cwd: appRoot,
        stdio: 'inherit',
        windowsHide: true,
      })
    : spawnSync('npm', ['run', 'build'], {
        cwd: appRoot,
        stdio: 'inherit',
      })
  if (build.status !== 0) process.exit(build.status ?? 1)
}

const serverEntry = installedMode ? installedServerEntry : sourceServerEntry
if (!existsSync(serverEntry)) {
  console.error(`GPT Observatory server entry is missing: ${serverEntry}`)
  process.exit(1)
}

const serverArgs = expectedServerArgs

const stdout = openSync(logFile, 'a')
const stderr = openSync(errFile, 'a')
let launchAttempts = 0
let child = await launchServerAttempt()

const startupDeadline = Date.now() + startupTimeoutMs
while (Date.now() < startupDeadline) {
  await delay(500)

  if (await healthy()) {
    const actualPid = discoverServerPid()
    if (actualPid) {
      await writeFile(pidFile, String(actualPid), 'utf8')
      openBrowser(url)
      process.exit(0)
    }
  }

  if (
    child.exitCode !== null
    && launchAttempts < maxStartAttempts
    && !discoverServerPid()
  ) {
    console.error(
      `GPT Observatory server exited before readiness; retrying (${launchAttempts + 1}/${maxStartAttempts}).`,
    )
    await delay(750)
    child = await launchServerAttempt()
  }
}

console.error('GPT Observatory did not become ready. See:')
console.error(logFile)
console.error(errFile)
process.exit(1)

async function launchServerAttempt() {
  launchAttempts += 1
  const launched = spawn(
    process.execPath,
    serverArgs,
    {
      cwd: homeRoot,
      detached: true,
      windowsHide: true,
      env: {
        ...process.env,
        GPT_OBSERVATORY_HOME: homeRoot,
        OBSERVATORY_PORT: process.env.OBSERVATORY_PORT ?? '4317',
      },
      stdio: ['ignore', stdout, stderr],
    },
  )

  await writeFile(pidFile, String(launched.pid), 'utf8')
  launched.unref()
  return launched
}

async function healthy() {
  try {
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(900),
    })
    if (!response.ok) return false
    const body = await response.json()
    return body?.ok === true && body?.service === 'gpt-observatory'
  } catch {
    return false
  }
}

function discoverServerPid() {
  if (process.platform !== 'win32') return undefined
  const script = [
    `$c=Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1`,
    'if(-not $c){exit 3}',
    '$p=Get-CimInstance Win32_Process -Filter ("ProcessId="+$c.OwningProcess) -ErrorAction SilentlyContinue',
    'if(-not $p){exit 4}',
    '[pscustomobject]@{Pid=$p.ProcessId;ExecutablePath=$p.ExecutablePath;CommandLine=$p.CommandLine} | ConvertTo-Json -Compress',
  ].join('; ')
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', script],
    { encoding: 'utf8', windowsHide: true },
  )
  if (result.status !== 0) return undefined

  try {
    const info = JSON.parse(result.stdout.trim())
    return matchesExpectedProcess(info) ? Number(info.Pid) : undefined
  } catch {
    return undefined
  }
}

function matchesExpectedProcess(info) {
  if (!info || typeof info !== 'object') return false
  if (typeof info.ExecutablePath !== 'string' || typeof info.CommandLine !== 'string') {
    return false
  }
  if (info.ExecutablePath.toLocaleLowerCase() !== process.execPath.toLocaleLowerCase()) {
    return false
  }
  return expectedCommandLines().has(info.CommandLine.trim().toLocaleLowerCase())
}

function expectedCommandLines() {
  let forms = [process.execPath, `"${process.execPath}"`]
  for (const argument of expectedServerArgs) {
    const argumentForms = [argument, `"${argument}"`]
    forms = forms.flatMap(prefix =>
      argumentForms.map(value => `${prefix} ${value}`),
    )
  }
  return new Set(forms.map(value => value.toLocaleLowerCase()))
}

function openBrowser(target) {
  if (process.env.GPT_OBSERVATORY_NO_BROWSER === '1') return

  if (process.platform === 'win32') {
    const edge = findEdgeExecutable()
    if (edge) {
      const opener = spawn(edge, [`--app=${target}`, '--start-maximized'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      opener.unref()
      return
    }

    const opener = spawn('cmd.exe', ['/c', 'start', '', target], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    opener.unref()
    return
  }

  const command = process.platform === 'darwin' ? 'open' : 'xdg-open'
  const opener = spawn(command, [target], {
    detached: true,
    stdio: 'ignore',
  })
  opener.unref()
}

function findEdgeExecutable() {
  const candidates = [
    process.env['PROGRAMFILES(X86)'],
    process.env.PROGRAMFILES,
    process.env.LOCALAPPDATA,
  ]
    .filter(Boolean)
    .map(base => resolve(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))

  return candidates.find(candidate => existsSync(candidate))
}

function delay(ms) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
}

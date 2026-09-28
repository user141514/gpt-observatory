import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const userInstallHome = process.env.LOCALAPPDATA
  ? resolve(process.env.LOCALAPPDATA, 'GPTObservatory')
  : undefined
const localInstalled = existsSync(resolve(scriptRoot, 'app', 'current', 'server', 'bootstrap.js'))
const globalInstalled = Boolean(
  userInstallHome
  && existsSync(resolve(userInstallHome, 'app', 'current', 'server', 'bootstrap.js')),
)
const installedMode = localInstalled || globalInstalled
const inferredHome = localInstalled
  ? scriptRoot
  : globalInstalled
    ? userInstallHome
    : scriptRoot
const expectedServerEntry = localInstalled
  ? resolve(scriptRoot, 'app', 'current', 'server', 'bootstrap.js')
  : globalInstalled
    ? resolve(userInstallHome, 'app', 'current', 'server', 'bootstrap.js')
    : resolve(scriptRoot, 'server', 'bootstrap.ts')
const sourceLoader = resolve(scriptRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs')
const expectedServerArgs = installedMode
  ? [expectedServerEntry]
  : ['--import', pathToFileURL(sourceLoader).href, expectedServerEntry]
const homeRoot = resolve(
  process.env.GPT_OBSERVATORY_HOME ?? inferredHome,
)
const runtimeDir = resolve(homeRoot, installedMode ? 'runtime' : '.runtime')
const pidFile = resolve(runtimeDir, 'server.pid')
const port = Number(process.env.OBSERVATORY_PORT ?? 4317)
const url = process.env.OBSERVATORY_URL ?? `http://127.0.0.1:${port}/`
const healthUrl = new URL('/api/health', url).href

const listenerPid = discoverListenerPid()

if (!listenerPid) {
  await rm(pidFile, { force: true })
  console.log('GPT Observatory is not running.')
  process.exit(0)
}

const exactProcess = isObservatoryProcess(listenerPid)
const signedHealth = await healthy()

if (!exactProcess || !signedHealth) {
  console.error(
    `Refusing to stop PID ${listenerPid}: Observatory identity could not be jointly verified (process=${exactProcess}, health=${signedHealth}).`,
  )
  process.exit(1)
}

const pid = listenerPid

if (process.platform === 'win32') {
  spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  })
} else {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {}
}

await rm(pidFile, { force: true })
console.log(`GPT Observatory stopped (PID ${pid}).`)

function isObservatoryProcess(targetPid) {
  if (process.platform !== 'win32') {
    try {
      process.kill(targetPid, 0)
      return true
    } catch {
      return false
    }
  }
  return matchesExpectedProcess(processInfoForPid(targetPid))
}

function discoverListenerPid() {
  if (process.platform !== 'win32') return undefined
  const script = [
    `$c=Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1`,
    'if(-not $c){exit 3}',
    'Write-Output $c.OwningProcess',
  ].join('; ')
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', script],
    { encoding: 'utf8', windowsHide: true },
  )
  if (result.status !== 0) return undefined
  const pid = Number(result.stdout.trim())
  return Number.isInteger(pid) && pid > 0 ? pid : undefined
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

function processInfoForPid(targetPid) {
  if (!Number.isInteger(targetPid) || targetPid <= 0) return undefined
  const script = [
    `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${targetPid}" -ErrorAction SilentlyContinue`,
    'if(-not $p){exit 3}',
    '[pscustomobject]@{Pid=$p.ProcessId;ExecutablePath=$p.ExecutablePath;CommandLine=$p.CommandLine} | ConvertTo-Json -Compress',
  ].join('; ')
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', script],
    { encoding: 'utf8', windowsHide: true },
  )
  if (result.status !== 0) return undefined
  try {
    return JSON.parse(result.stdout.trim())
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

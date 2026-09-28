import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
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

let pid = await readPidFile()
if (!pid || !isObservatoryProcess(pid)) {
  pid = discoverServerPid()
}

if (!pid) {
  await rm(pidFile, { force: true })
  console.log('GPT Observatory is not running.')
  process.exit(0)
}

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

async function readPidFile() {
  try {
    const raw = await readFile(pidFile, 'utf8')
    const value = Number(raw.trim())
    return Number.isInteger(value) && value > 0 ? value : undefined
  } catch {
    return undefined
  }
}

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

function discoverServerPid() {
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
  if (!Number.isInteger(pid) || pid <= 0) return undefined
  return matchesExpectedProcess(processInfoForPid(pid)) ? pid : undefined
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

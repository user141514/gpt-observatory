import { existsSync } from 'node:fs'
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const userHome = homedir()
const localAppData =
  process.env.LOCALAPPDATA ?? join(userHome, 'AppData', 'Local')
const installHome = join(localAppData, 'GPTObservatory')
const appDir = join(installHome, 'app')
const currentDir = join(appDir, 'current')
const stagingDir = join(appDir, `.staging-${process.pid}`)
const previousDir = join(appDir, '.previous')
const failedDir = join(appDir, `.failed-${process.pid}`)
const launcherDir = join(installHome, 'launcher')
const dataDir = join(installHome, 'data')
const canonicalDataDir = join(dataDir, 'observatory')
const runtimeDir = join(installHome, 'runtime')
const iconTarget = join(installHome, 'GPT Observatory.ico')
const binDir = join(userHome, 'bin')
const node = process.execPath

const sourceStart = resolve(root, 'scripts', 'start-observatory.mjs')
const sourceStop = resolve(root, 'scripts', 'stop-observatory.mjs')
const sourceAgentInstall = resolve(root, 'scripts', 'install-agent-access.mjs')
const sourceIcon = resolve(root, 'public', 'gpt-observatory.ico')
const sourceData = resolve(root, 'data', 'observatory')
const sourceDist = resolve(root, 'dist')
const sourceServer = resolve(root, '.release', 'server')
const sourcePackage = resolve(root, 'package.json')
const sourceLock = resolve(root, 'package-lock.json')

await runRequired(process.execPath, ['scripts/build-icon.mjs'], root, 'icon build')
await runNpmBuild()

if (!existsSync(sourceDist) || !existsSync(resolve(sourceServer, 'bootstrap.js'))) {
  throw new Error('Production build artifacts are missing after build.')
}

await Promise.all([
  mkdir(installHome, { recursive: true }),
  mkdir(appDir, { recursive: true }),
  mkdir(dataDir, { recursive: true }),
  mkdir(runtimeDir, { recursive: true }),
  mkdir(launcherDir, { recursive: true }),
  mkdir(binDir, { recursive: true }),
])

// PREPARE PHASE: the currently installed app stays online throughout this phase.
for (const entry of await readdir(appDir, { withFileTypes: true })) {
  if (
    entry.isDirectory()
    && (
      entry.name.startsWith('.staging-')
      || entry.name.startsWith('.failed-')
    )
    && entry.name !== `.staging-${process.pid}`
  ) {
    await rm(join(appDir, entry.name), { recursive: true, force: true })
  }
}
await rm(previousDir, { recursive: true, force: true })
await rm(stagingDir, { recursive: true, force: true })
await rm(failedDir, { recursive: true, force: true })

await mkdir(stagingDir, { recursive: true })
await Promise.all([
  cp(sourceDist, join(stagingDir, 'dist'), { recursive: true }),
  cp(sourceServer, join(stagingDir, 'server'), { recursive: true }),
  cp(sourcePackage, join(stagingDir, 'package.json')),
  cp(sourceLock, join(stagingDir, 'package-lock.json')),
])

console.log('Installing production dependencies into the staging snapshot...')
const offline = runCommand(
  process.platform === 'win32' ? 'cmd.exe' : 'npm',
  process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm ci --omit=dev --offline --no-audit --no-fund']
    : ['ci', '--omit=dev', '--offline', '--no-audit', '--no-fund'],
  stagingDir,
)
if (offline.status !== 0) {
  console.log('Offline cache was incomplete; retrying with prefer-offline...')
  const fallback = runCommand(
    process.platform === 'win32' ? 'cmd.exe' : 'npm',
    process.platform === 'win32'
      ? ['/d', '/s', '/c', 'npm ci --omit=dev --prefer-offline --no-audit --no-fund']
      : ['ci', '--omit=dev', '--prefer-offline', '--no-audit', '--no-fund'],
    stagingDir,
  )
  if (fallback.status !== 0) {
    await rm(stagingDir, { recursive: true, force: true })
    throw new Error('Production dependency installation failed.')
  }
}

if (process.env.GPT_OBSERVATORY_INSTALL_TEST_CANDIDATE_MARKER) {
  await writeFile(
    join(stagingDir, 'INSTALL_CANDIDATE_MARKER.txt'),
    process.env.GPT_OBSERVATORY_INSTALL_TEST_CANDIDATE_MARKER,
    'utf8',
  )
}

// Stable launch surfaces can be prepared before stopping the current app.
await Promise.all([
  cp(sourceStart, join(launcherDir, 'start.mjs')),
  cp(sourceStop, join(launcherDir, 'stop.mjs')),
  cp(sourceIcon, iconTarget),
])

const startScript = join(launcherDir, 'start.mjs')
const stopScript = join(launcherDir, 'stop.mjs')

await Promise.all([
  writeFile(
    join(binDir, 'gpt-observatory-app.cmd'),
    `@echo off\r\n"${node}" "${startScript}" %*\r\n`,
    'utf8',
  ),
  writeFile(
    join(binDir, 'gpt-observatory-stop.cmd'),
    `@echo off\r\n"${node}" "${stopScript}" %*\r\n`,
    'utf8',
  ),
])

if (process.platform === 'win32') {
  await installWindowsShortcuts()
}

const packageMetadata = JSON.parse(await readFile(sourcePackage, 'utf8'))
const gitRevision = spawnSync(
  'git',
  ['rev-parse', 'HEAD'],
  { cwd: root, encoding: 'utf8', windowsHide: true },
)
const metadata = {
  installedAt: new Date().toISOString(),
  version: packageMetadata.version,
  buildCommit: gitRevision.status === 0 ? gitRevision.stdout.trim() : null,
  appDir: currentDir,
  dataDir: canonicalDataDir,
  node,
}

let stopped = false
let previousCreated = false
let swapped = false

try {
  // DOWNTIME WINDOW STARTS HERE.
  await runRequired(node, [sourceStop], root, 'stopping current Observatory')
  stopped = true

  // First installation only: RocksDB must be quiescent before copying.
  if (!existsSync(canonicalDataDir) && existsSync(sourceData)) {
    console.log('Migrating canonical Observatory data to stable user storage...')
    await cp(sourceData, canonicalDataDir, {
      recursive: true,
      force: false,
      errorOnExist: true,
    })
  }

  if (existsSync(currentDir)) {
    await rename(currentDir, previousDir)
    previousCreated = true
  }

  await rename(stagingDir, currentDir)
  swapped = true

  // Restore service immediately after the atomic directory swap.
  await startInstalledOrThrow()

  // DOWNTIME WINDOW ENDS: the new version is live before post-install integration.
  if (process.env.GPT_OBSERVATORY_INSTALL_TEST_FAIL_AFTER_START === '1') {
    throw new Error('Injected post-start failure for rollback verification.')
  }

  await runRequired(
    node,
    [sourceAgentInstall],
    root,
    'agent access installation',
  )

  await writeFile(
    join(installHome, 'install.json'),
    JSON.stringify(metadata, null, 2),
    'utf8',
  )
} catch (error) {
  if (stopped) {
    await rollbackAndRestart(error)
  }
  throw error
}

console.log('GPT Observatory installed as an independent local app.')
console.log(`App  : ${currentDir}`)
console.log(`Data : ${canonicalDataDir}`)
console.log(`Start: ${join(binDir, 'gpt-observatory-app.cmd')}`)
console.log(`Stop : ${join(binDir, 'gpt-observatory-stop.cmd')}`)

async function rollbackAndRestart(cause) {
  console.error(`Install transaction failed; rolling back: ${cause instanceof Error ? cause.message : String(cause)}`)

  // Stop a partially started replacement, if any.
  runCommand(node, [stopScript], installHome)

  if (swapped && existsSync(currentDir)) {
    await rm(failedDir, { recursive: true, force: true })
    await rename(currentDir, failedDir)
  }

  if (previousCreated && existsSync(previousDir)) {
    await rename(previousDir, currentDir)
  }

  const recovery = existsSync(currentDir)
    ? runInstalledStart()
    : runCommand(
        node,
        [sourceStart],
        root,
        {
          ...process.env,
          GPT_OBSERVATORY_NO_BROWSER: '1',
        },
      )

  if (recovery.status !== 0) {
    console.error('Rollback restored files but failed to restart the previous Observatory instance.')
  } else {
    // Best effort: restore global agent surfaces to the recovered current snapshot.
    runCommand(node, [sourceAgentInstall], root)
  }
}

async function startInstalledOrThrow() {
  const result = runInstalledStart()
  if (result.status !== 0) {
    throw new Error(`Installed GPT Observatory failed to start: ${result.error ?? `exit ${result.status}`}`)
  }
}

function runInstalledStart() {
  return runCommand(
    node,
    [startScript],
    installHome,
    {
      ...process.env,
      GPT_OBSERVATORY_NO_BROWSER: '1',
    },
  )
}

async function installWindowsShortcuts() {
  const ps1 = join(runtimeDir, 'install-shortcuts.ps1')
  const script = [
    '$shell = New-Object -ComObject WScript.Shell',
    '$desktop = [Environment]::GetFolderPath("Desktop")',
    '$startMenu = Join-Path $env:APPDATA "Microsoft\\Windows\\Start Menu\\Programs"',
    `$binDir = ${psQuote(binDir)}`,
    '$userPath = [Environment]::GetEnvironmentVariable("Path", "User")',
    '$parts = @($userPath -split ";" | Where-Object { $_ -and $_.Trim() })',
    'if(-not ($parts | Where-Object { $_.TrimEnd("\\") -ieq $binDir.TrimEnd("\\") })) {',
    '  $newPath = (($parts + $binDir) -join ";")',
    '  [Environment]::SetEnvironmentVariable("Path", $newPath, "User")',
    '}',
    `$target = ${psQuote(node)}`,
    `$arguments = ${psQuote('"' + startScript + '"')}`,
    `$working = ${psQuote(installHome)}`,
    `$icon = ${psQuote(iconTarget + ',0')}`,
    'foreach($path in @((Join-Path $desktop "GPT Observatory.lnk"), (Join-Path $startMenu "GPT Observatory.lnk"))) {',
    '  $shortcut = $shell.CreateShortcut($path)',
    '  $shortcut.TargetPath = $target',
    '  $shortcut.Arguments = $arguments',
    '  $shortcut.WorkingDirectory = $working',
    '  $shortcut.IconLocation = $icon',
    '  $shortcut.Description = "GPT Observatory — local factual state system"',
    '  $shortcut.Save()',
    '}',
  ].join('\r\n')
  await writeFile(ps1, script, 'utf8')
  await runRequired(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
    installHome,
    'shortcut installation',
  )
}

function runCommand(command, args, cwd, env = process.env) {
  return spawnSync(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    windowsHide: true,
  })
}

async function runRequired(command, args, cwd, label) {
  const result = runCommand(command, args, cwd)
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${result.error ?? `exit ${result.status}`}`)
  }
}

async function runNpmBuild() {
  await runRequired(
    process.platform === 'win32' ? 'cmd.exe' : 'npm',
    process.platform === 'win32'
      ? ['/d', '/s', '/c', 'npm run build']
      : ['run', 'build'],
    root,
    'application build',
  )
}

function psQuote(value) {
  return "'" + value.replaceAll("'", "''") + "'"
}

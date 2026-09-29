import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseRoot = resolve(
  process.env.GPT_OBSERVATORY_RELEASE_DIR
    ?? join(root, '.release', 'windows-payload'),
)
const releaseStaging = `${releaseRoot}.staging-${process.pid}`
const releasePrevious = `${releaseRoot}.previous`
const modelHome = resolve(
  process.env.GPT_OBSERVATORY_RELEASE_MODEL_HOME
    ?? join(root, '.release', 'release-model-home'),
)
const nodeRuntimeSource = resolve(
  process.env.GPT_OBSERVATORY_NODE_RUNTIME_DIR
    ?? dirname(process.execPath),
)
const productionModulesSource = process.env.GPT_OBSERVATORY_PRODUCTION_MODULES_SOURCE
  ? resolve(process.env.GPT_OBSERVATORY_PRODUCTION_MODULES_SOURCE)
  : undefined

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const commit = process.env.GPT_OBSERVATORY_BUILD_COMMIT
  ?? git(['rev-parse', 'HEAD']).trim()
const nodeVersion = process.version

await runRequired(
  process.platform === 'win32' ? 'cmd.exe' : 'npm',
  process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm run build']
    : ['run', 'build'],
  root,
  'application build',
)

await runRequired(
  process.execPath,
  [join(root, 'scripts', 'prepare-embedding-model.mjs')],
  root,
  'embedding model preparation',
  {
    ...process.env,
    GPT_OBSERVATORY_HOME: modelHome,
  },
)

await rm(releaseStaging, { recursive: true, force: true })
await mkdir(releaseStaging, { recursive: true })

await Promise.all([
  cp(join(root, 'dist'), join(releaseStaging, 'dist'), { recursive: true }),
  cp(join(root, '.release', 'server'), join(releaseStaging, '.release', 'server'), { recursive: true }),
  cp(join(root, 'package.json'), join(releaseStaging, 'package.json')),
  cp(join(root, 'package-lock.json'), join(releaseStaging, 'package-lock.json')),
  cp(
    join(modelHome, 'models'),
    join(releaseStaging, 'models'),
    { recursive: true },
  ),
  cp(
    join(root, 'public', 'gpt-observatory.ico'),
    join(releaseStaging, 'public', 'gpt-observatory.ico'),
  ),
])

const bundledNode = join(nodeRuntimeSource, 'node.exe')
if (!existsSync(bundledNode)) {
  throw new Error(`Node runtime is missing node.exe: ${bundledNode}`)
}
await mkdir(join(releaseStaging, 'runtime', 'node'), { recursive: true })
await cp(
  bundledNode,
  join(releaseStaging, 'runtime', 'node', 'node.exe'),
)

for (const script of [
  'install-desktop.mjs',
  'install-agent-access.mjs',
  'prepare-embedding-model.mjs',
  'start-observatory.mjs',
  'stop-observatory.mjs',
]) {
  await cp(
    join(root, 'scripts', script),
    join(releaseStaging, 'scripts', script),
  )
}

await cp(
  join(root, 'release', 'windows', 'Install-GPT-Observatory.ps1'),
  join(releaseStaging, 'Install-GPT-Observatory.ps1'),
)
await cp(
  join(root, 'release', 'windows', 'Install-GPT-Observatory.cmd'),
  join(releaseStaging, 'Install-GPT-Observatory.cmd'),
)

if (productionModulesSource) {
  if (!existsSync(productionModulesSource)) {
    throw new Error(
      `Production modules source does not exist: ${productionModulesSource}`,
    )
  }
  console.log(`Copying production dependencies from ${productionModulesSource}`)
  const modulesTarget = join(releaseStaging, 'node_modules')
  if (process.platform === 'win32') {
    await mkdir(modulesTarget, { recursive: true })
    const copy = runCommand(
      'robocopy.exe',
      [
        productionModulesSource,
        modulesTarget,
        '/E',
        '/COPY:DAT',
        '/DCOPY:DAT',
        '/R:1',
        '/W:1',
        '/MT:16',
        '/NFL',
        '/NDL',
        '/NJH',
        '/NJS',
        '/NP',
      ],
      root,
    )
    // Robocopy uses 0..7 for successful copy states.
    if (copy.status !== null && copy.status > 7) {
      throw new Error(`Robocopy failed with exit ${copy.status}`)
    }
  } else {
    await cp(
      productionModulesSource,
      modulesTarget,
      { recursive: true },
    )
  }
} else {
  console.log('Installing production dependencies into release payload...')
  const result = runCommand(
    process.platform === 'win32' ? 'cmd.exe' : 'npm',
    process.platform === 'win32'
      ? ['/d', '/s', '/c', 'npm ci --omit=dev --no-audit --no-fund']
      : ['ci', '--omit=dev', '--no-audit', '--no-fund'],
    releaseStaging,
  )
  if (result.status !== 0) {
    throw new Error(
      `Release production dependency install failed: ${result.error ?? `exit ${result.status}`}`,
    )
  }
}

await pruneWindowsX64NativeModules(join(releaseStaging, 'node_modules'))

const releaseMetadata = {
  product: 'GPT Observatory',
  version: packageJson.version,
  commit,
  nodeVersion,
  platform: 'win32',
  arch: 'x64',
  createdAt: new Date().toISOString(),
}
await writeFile(
  join(releaseStaging, 'release.json'),
  JSON.stringify(releaseMetadata, null, 2),
  'utf8',
)

const criticalFiles = [
  'release.json',
  'dist/index.html',
  '.release/server/bootstrap.js',
  '.release/server/index.js',
  '.release/server/agent-cli.js',
  '.release/server/agent-mcp.js',
  'models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx',
  'runtime/node/node.exe',
  'Install-GPT-Observatory.ps1',
  'scripts/install-desktop.mjs',
]
for (const relativePath of criticalFiles) {
  const fullPath = join(releaseStaging, ...relativePath.split('/'))
  if (!existsSync(fullPath)) {
    throw new Error(`Release payload is missing: ${relativePath}`)
  }
}

const manifestFiles = (await listFiles(releaseStaging))
  .map(fullPath => ({
    fullPath,
    path: relative(releaseStaging, fullPath).replaceAll('\\', '/'),
  }))
  .filter(file => file.path !== 'payload-manifest.json')
  .sort((a, b) => a.path.localeCompare(b.path))

const manifest = []
for (const file of manifestFiles) {
  manifest.push({
    path: file.path,
    sha256: await sha256(file.fullPath),
  })
}

await writeFile(
  join(releaseStaging, 'payload-manifest.json'),
  JSON.stringify({
    ...releaseMetadata,
    files: manifest,
  }, null, 2),
  'utf8',
)

await rm(releasePrevious, { recursive: true, force: true })
if (existsSync(releaseRoot)) {
  await rename(releaseRoot, releasePrevious)
}
try {
  await rename(releaseStaging, releaseRoot)
} catch (error) {
  if (!existsSync(releaseRoot) && existsSync(releasePrevious)) {
    await rename(releasePrevious, releaseRoot)
  }
  throw error
}
await rm(releasePrevious, { recursive: true, force: true })

console.log(JSON.stringify({
  ok: true,
  releaseRoot,
  ...releaseMetadata,
  files: manifest.length,
}))

async function listFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath))
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }
  return files
}

async function pruneWindowsX64NativeModules(modulesRoot) {
  const onnxNativeRoot = join(
    modulesRoot,
    'onnxruntime-node',
    'bin',
    'napi-v6',
  )
  for (const relative of [
    ['darwin'],
    ['linux'],
    ['win32', 'arm64'],
  ]) {
    await rm(join(onnxNativeRoot, ...relative), {
      recursive: true,
      force: true,
    })
  }

  const surrealDist = join(
    modulesRoot,
    '@surrealdb',
    'node',
    'dist',
  )
  if (existsSync(surrealDist)) {
    for (const entry of await readdir(surrealDist, { withFileTypes: true })) {
      if (
        entry.isFile()
        && entry.name.endsWith('.node')
        && entry.name !== 'surrealdb-node.win32-x64-msvc.node'
      ) {
        await rm(join(surrealDist, entry.name), { force: true })
      }
    }
  }
}

function runCommand(command, args, cwd, env = process.env) {
  return spawnSync(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    windowsHide: true,
  })
}

async function runRequired(command, args, cwd, label, env = process.env) {
  const result = runCommand(command, args, cwd, env)
  if (result.status !== 0) {
    throw new Error(
      `${label} failed: ${result.error ?? `exit ${result.status}`}`,
    )
  }
}

function git(args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed`)
  }
  return result.stdout
}

function sha256(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('error', reject)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolvePromise(hash.digest('hex').toUpperCase()))
  })
}

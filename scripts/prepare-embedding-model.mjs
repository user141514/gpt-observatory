import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
const REVISION = '751bff37182d3f1213fa05d7196b954e230abad9'
const DTYPE = 'q8'
const FILES = [
  {
    path: 'config.json',
    bytes: 650,
    sha256: '7135149F7CFFA1A573466C6E4D8423ED73B62FD2332C575BF738A0D033F70DF7',
  },
  {
    path: 'special_tokens_map.json',
    bytes: 125,
    sha256: 'B6D346BE366A7D1D48332DBC9FDF3BF8960B5D879522B7799DDBA59E76237EE3',
  },
  {
    path: 'tokenizer.json',
    bytes: 711661,
    sha256: 'DA0E79933B9ED51798A3AE27893D3C5FA4A201126CEF75586296DF9B4D2C62A0',
  },
  {
    path: 'tokenizer_config.json',
    bytes: 366,
    sha256: '9261E7D79B44C8195C1CADA2B453E55B00AEB81E907A6664974B4D7776172AB3',
  },
  {
    path: 'vocab.txt',
    bytes: 231508,
    sha256: '07ECED375CEC144D27C900241F3E339478DEC958F92FDDBC551F295C992038A3',
  },
  {
    path: 'onnx/model_quantized.onnx',
    bytes: 22972370,
    sha256: 'AFDB6F1A0E45B715D0BB9B11772F032C399BABD23BFC31FED1C170AFC848BDB1',
  },
]

const home = resolve(
  process.env.GPT_OBSERVATORY_HOME
    ?? defaultObservatoryHome(),
)
const modelRoot = join(home, 'models', ...MODEL_ID.split('/'))
const manifestPath = join(modelRoot, 'observatory-model-manifest.json')
const baseUrl = `https://huggingface.co/${MODEL_ID}/resolve/${REVISION}`

await mkdir(modelRoot, { recursive: true })

let downloaded = 0
for (const file of FILES) {
  const target = join(modelRoot, ...file.path.split('/'))
  if (await verifyFile(target, file)) continue

  await mkdir(dirname(target), { recursive: true })
  const temp = `${target}.part-${process.pid}`
  await rm(temp, { force: true })

  console.log(`Preparing embedding model: ${file.path}`)
  await downloadFile(`${baseUrl}/${file.path}`, temp)

  if (!(await verifyFile(temp, file))) {
    await rm(temp, { force: true })
    throw new Error(`Embedding model file failed verification: ${file.path}`)
  }

  await rm(target, { force: true })
  await rename(temp, target)
  downloaded += 1
}

const manifest = {
  model: MODEL_ID,
  revision: REVISION,
  dtype: DTYPE,
  preparedAt: new Date().toISOString(),
  files: FILES,
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

console.log(JSON.stringify({
  ok: true,
  model: MODEL_ID,
  revision: REVISION,
  dtype: DTYPE,
  modelRoot,
  downloaded,
  totalBytes: FILES.reduce((sum, file) => sum + file.bytes, 0),
}))

async function verifyFile(path, expected) {
  if (!existsSync(path)) return false

  const fileStat = await stat(path)
  if (fileStat.size !== expected.bytes) return false

  return (await sha256(path)) === expected.sha256
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

async function downloadFile(url, output) {
  if (process.platform === 'win32') {
    const proxy = userHttpsProxy()
    const escapedUrl = psQuote(url)
    const escapedOutput = psQuote(output)
    const proxyClause = proxy ? `; $args.Proxy=${psQuote(proxy)}` : ''
    const command = [
      '$ProgressPreference="SilentlyContinue"',
      `$args=@{Uri=${escapedUrl};OutFile=${escapedOutput};UseBasicParsing=$true;TimeoutSec=300}${proxyClause}`,
      'Invoke-WebRequest @args',
    ].join('; ')

    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-Command', command],
      { stdio: 'inherit', windowsHide: true },
    )
    if (result.status !== 0) {
      throw new Error(`Model download failed for ${url}: ${result.error ?? `exit ${result.status}`}`)
    }
    return
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(300_000) })
  if (!response.ok) {
    throw new Error(`Model download failed: ${response.status} ${response.statusText}`)
  }
  await writeFile(output, Buffer.from(await response.arrayBuffer()))
}

function userHttpsProxy() {
  if (process.env.GPT_OBSERVATORY_MODEL_PROXY) {
    return process.env.GPT_OBSERVATORY_MODEL_PROXY
  }

  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      '[Environment]::GetEnvironmentVariable("HTTPS_PROXY","User")',
    ],
    { encoding: 'utf8', windowsHide: true },
  )
  const userProxy = result.status === 0 ? result.stdout.trim() : ''
  return userProxy
    || process.env.HTTPS_PROXY
    || process.env.HTTP_PROXY
    || ''
}

function defaultObservatoryHome() {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, 'GPTObservatory')
  }
  if (process.env.XDG_DATA_HOME) {
    return join(process.env.XDG_DATA_HOME, 'gpt-observatory')
  }
  return join(homedir(), '.local', 'share', 'gpt-observatory')
}

function psQuote(value) {
  return "'" + value.replaceAll("'", "''") + "'"
}

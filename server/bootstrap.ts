import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const home = resolve(
  process.env.GPT_OBSERVATORY_HOME
    ?? defaultObservatoryHome(),
)

mkdirSync(home, { recursive: true })
process.env.GPT_OBSERVATORY_HOME = home
process.chdir(home)

await import('./index.js')

function defaultObservatoryHome() {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, 'GPTObservatory')
  }
  if (process.env.XDG_DATA_HOME) {
    return join(process.env.XDG_DATA_HOME, 'gpt-observatory')
  }
  return join(homedir(), '.local', 'share', 'gpt-observatory')
}

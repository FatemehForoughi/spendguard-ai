import { cp, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const backendDir = resolve(scriptDir, '..')

const assets = [
  ['src/ai-prompts', 'dist/ai-prompts'],
  ['src/ai-knowledge', 'dist/ai-knowledge'],
]

for (const [source, destination] of assets) {
  const sourcePath = resolve(backendDir, source)
  const destinationPath = resolve(backendDir, destination)

  await mkdir(destinationPath, { recursive: true })
  await cp(sourcePath, destinationPath, { recursive: true, force: true })
  console.log(`[Build] Copied ${source} -> ${destination}`)
}

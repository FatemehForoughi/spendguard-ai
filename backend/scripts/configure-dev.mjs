import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import dotenv from 'dotenv'

const file=resolve('.env')
let contents=existsSync(file)?readFileSync(file,'utf8'):readFileSync(resolve('.env.example'),'utf8')
const config=dotenv.parse(contents)
if (!config.GRANT_ENCRYPTION_KEY) {
  const key=randomBytes(32).toString('hex')
  if (/^GRANT_ENCRYPTION_KEY=.*$/m.test(contents)) contents=contents.replace(/^GRANT_ENCRYPTION_KEY=.*$/m,`GRANT_ENCRYPTION_KEY=${key}`)
  else contents+=`\nGRANT_ENCRYPTION_KEY=${key}\n`
  writeFileSync(file,contents,{mode:0o600})
  console.log('Added a local encryption key for grant storage. Keep backend/.env private and backed up.')
} else console.log('Existing grant encryption key preserved.')
if (!config.ENABLE_LIVE_EXECUTION) {
  contents=contents.replace(/^ENABLE_LIVE_EXECUTION=.*$/m,'ENABLE_LIVE_EXECUTION=false')
  if (!/^ENABLE_LIVE_EXECUTION=/m.test(contents)) contents+='\nENABLE_LIVE_EXECUTION=false\n'
  writeFileSync(file,contents,{mode:0o600})
}
console.log('Development configuration ready. No credentials were displayed.')

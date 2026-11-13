import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
const children=[
  spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','watch','src/server.ts'],{cwd:root+'backend',stdio:'inherit',windowsHide:true}),
  spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1'],{cwd:root+'frontend',stdio:'inherit',windowsHide:true}),
]
let closing=false
function close(code=0){if(closing)return;closing=true;for(const child of children)child.kill();process.exitCode=code}
for(const child of children){child.on('error',()=>close(1));child.on('exit',code=>{if(!closing)close(code??1)})}
process.on('SIGINT',()=>close());process.on('SIGTERM',()=>close())
console.log('SpendGuard frontend: http://localhost:5173 · Backend: http://localhost:3000')

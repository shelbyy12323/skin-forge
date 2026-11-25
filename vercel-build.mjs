import { cp, mkdir, readdir } from 'node:fs/promises'

await mkdir('public', { recursive: true })
for (const name of await readdir('dist')) {
  if (name === 'server') continue
  await cp('dist/' + name, 'public/' + name, { recursive: true })
}
import './worker/build.mjs'

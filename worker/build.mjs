import {readFileSync, writeFileSync, mkdirSync} from 'node:fs'
import {runInNewContext} from 'node:vm'

const assets = {}
for (const [name, type] of Object.entries({
  'index.html': 'text/html',
  'app.js': 'text/javascript',
  'cases.js': 'text/javascript',
  'skins.js': 'text/javascript',
  'charms.js':'text/javascript',
  'profiles.js':'text/javascript',
  'battles.js':'text/javascript',
  'style.css': 'text/css',
})) {
  assets['/' + name] = [readFileSync(new URL('../dist/' + name, import.meta.url), 'utf8'), type]
}
const catalog = runInNewContext(assets['/skins.js'][0] + '\n' + assets['/charms.js'][0] + '\n;({catalogData, legacyIds})')
const prices = Object.fromEntries(catalog.catalogData.map(({id, price}) => [id, price]))
const caseCatalog = runInNewContext(assets['/cases.js'][0] + '\n;caseCatalog')
for (const box of [...caseCatalog, {cover:'covers/stage.png'}, {cover:'covers/shell.png'}]) {
  assets['/' + box.cover] = [readFileSync(new URL('../dist/' + box.cover, import.meta.url)).toString('base64'), 'image/png']
}
const source = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8')
const output = new URL('../dist/server/', import.meta.url)
mkdirSync(output, {recursive:true})
writeFileSync(new URL('index.js', output),
  'const assets = ' + JSON.stringify(assets) + '\n' +
  'const prices = ' + JSON.stringify(prices) + '\n' +
  'const caseCatalog = ' + JSON.stringify(caseCatalog) + '\n' +
  'const legacyIds = ' + JSON.stringify(catalog.legacyIds) + '\n' + source + '\nexport {caseCatalog,prices}\n')

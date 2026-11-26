const bonusBox = caseCatalog[0]
const onlineWindow = 75000
const balanceLimit = 1000000000
const inventoryLimit = 2000
const cents = value => Math.round(value * 100)
const roundMoney = value => cents(value) / 100
const json = (value, status = 200) => Response.json(value, {
  status, headers: {'Cache-Control': 'no-store'},
})
const validSkin = id => typeof id === 'string' && Object.hasOwn(prices, id)

function initialState() { return {balance:0,items:[],history:[],deposits:[]} }

function pickDrop(box, roll) {
  let threshold = roll * 100
  return box.drops.find(drop => (threshold -= drop.chance) < 0)
}

function randomFraction() {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296
}

function mutate(state, action) {
  switch (action.kind) {
    case 'deposit': {
      if (!Number.isSafeInteger(action.amount) || action.amount < 1 ||
        action.amount > 10000000 || typeof action.bonus !== 'boolean') return null
      const credit = action.amount + (action.bonus ? Math.floor(action.amount * .05) : 0)
      if (state.balance + credit > balanceLimit) return null
      state.balance = roundMoney(state.balance + credit)
      state.deposits = [{credit, at: Date.now()}, ...(state.deposits ?? [])].slice(0, 40)
      return {credit}
    }
    case 'buy': {
      if (!validSkin(action.id) || state.balance < prices[action.id] || state.items.length >= inventoryLimit) return null
      state.balance = roundMoney(state.balance - prices[action.id])
      state.items.push(action.id)
      return {}
    }
    case 'case': {
      const box = caseCatalog.find(item => item.id === action.id)
      const free = box?.id === bonusBox.id && (state.freeCases ?? 0) > 0
      if (!box || (!free && state.balance < box.price) || state.items.length >= inventoryLimit) return null
      const drop = pickDrop(box, randomFraction())
      if (free) state.freeCases--
      else state.balance = roundMoney(state.balance - box.price)
      state.items.push(drop.id)
      return {id: drop.id, chance: drop.chance, success: true}
    }
    case 'sell': {
      const {index, id} = action
      if (!Number.isSafeInteger(index) || !validSkin(id) || state.items[index] !== id) return null
      const credit = Math.floor(cents(prices[id]) * 9 / 10) / 100
      if (state.balance + credit > balanceLimit) return null
      state.items.splice(index, 1)
      state.balance = roundMoney(state.balance + credit)
      return {credit}
    }
    case 'upgrade': {
      if (!validSkin(action.id) || !Number.isFinite(action.stake) || action.stake !== roundMoney(action.stake) ||
        action.stake < 0 || action.stake > state.balance || !Array.isArray(action.items) ||
        action.items.length > state.items.length) return null
      const selection = new Set(action.items)
      if (selection.size !== action.items.length ||
        [...selection].some(index => !Number.isSafeInteger(index) || index < 0 || index >= state.items.length)) return null
      const total = [...selection].reduce((sum, index) => sum + cents(prices[state.items[index]]), cents(action.stake))
      const targetPrice = cents(prices[action.id])
      if (total <= 0 || total >= targetPrice || state.items.length - selection.size >= inventoryLimit) return null
      const chance = Math.min(95, total / targetPrice * 90)
      const draw = randomFraction()
      const offset = (draw - .5) * 360
      const success = Math.abs(offset) < chance * 1.8
      state.items = state.items.filter((_, index) => !selection.has(index))
      state.balance = roundMoney(state.balance - action.stake)
      if (success) state.items.push(action.id)
      state.history = [{id: action.id, chance, success}, ...state.history].slice(0, 12)
      const bonus = !success && total > 10000
      if (bonus) state.freeCases = (state.freeCases ?? 0) + 1
      return {chance, offset, success, bonus}
    }
    default: return null
  }
}

function playerResponse(row) {
  const {balance, items, history, freeCases = 0} = JSON.parse(row.state)
  return {version: row.version, state: {balance, items, history, freeCases}}
}

async function handleApi(request, db, path) {
  if (request.method !== 'POST') return json({error: 'Метод недоступен.'}, 405)
  const session = request.headers.get('X-Skin-Forge-Session')
  if (!session || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(session)) {
    return json({error: 'Сессия недоступна.'}, 401)
  }
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(session))
  const id = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2,'0')).join('')
  const queryPlayer = () => db.prepare('SELECT version, state FROM players WHERE id = ?').bind(id).first()
  if (path === '/api/online') {
    const now = Date.now()
    const [, count, stats] = await db.batch([
      db.prepare('UPDATE players SET last_seen = ? WHERE id = ?').bind(now,id),
      db.prepare('SELECT COUNT(*) AS count FROM players WHERE last_seen >= ?').bind(now-onlineWindow),
      db.prepare('SELECT spins FROM site_stats WHERE id = 1'),
    ])
    return json({online: count.results[0].count, spins: stats.results[0].spins, now})
  }
  if (path === '/api/feed') {
    const {results} = await db.prepare(
      'SELECT event_id AS key, player_label AS player, skin_id AS id, chance, success, kind, happened_at AS at FROM upgrade_feed ORDER BY happened_at DESC, event_id DESC LIMIT 12'
    ).all()
    return json({entries: results})
  }
  const raw = await request.text()
  if (raw.length > 250000) return json({error: 'Запрос слишком большой.'}, 413)
  let payload
  try { payload = JSON.parse(raw) } catch { return json({error: 'Некорректный запрос.'}, 400) }
  if (!payload || typeof payload !== 'object') return json({error: 'Некорректный запрос.'}, 400)
  if (path === '/api/player') {
    await db.prepare('INSERT OR IGNORE INTO players (id, version, state) VALUES (?, 0, ?)')
      .bind(id, JSON.stringify(initialState())).run()
    return json(playerResponse(await queryPlayer()))
  }
  if (path !== '/api/action') return json({error: 'Страница не найдена.'}, 404)
  const row = await queryPlayer()
  if (!row) return json({error: 'Сессия ещё не загружена.'}, 409)
  if (row.version !== payload.version) return json({...playerResponse(row), error: 'Данные обновились в другой вкладке. Повтори действие.'}, 409)
  const state = JSON.parse(row.state)
  const result = mutate(state, payload)
  if (!result) return json({error: 'Операция недоступна для текущего баланса или инвентаря.'}, 422)
  const eventId = payload.kind === 'upgrade' || payload.kind === 'case' ? crypto.randomUUID() : null
  if (eventId) state.latestUpgrade = eventId
  const updatePlayer = db.prepare('UPDATE players SET state = ?, version = version + 1 WHERE id = ? AND version = ?')
    .bind(JSON.stringify(state), id, row.version)
  let updated
  if (eventId) {
    const insert = db.prepare('INSERT INTO upgrade_feed (event_id, player_label, skin_id, chance, success, happened_at, kind) ' +
      "SELECT ?, ?, ?, ?, ?, ?, ? FROM players WHERE id = ? AND json_extract(state, '$.latestUpgrade') = ?")
      .bind(eventId, 'Игрок ' + id.slice(0, 6).toUpperCase(), result.id ?? payload.id, result.chance, Number(result.success), Date.now(), payload.kind, id, eventId)
    const countSpin = db.prepare('UPDATE site_stats SET spins = spins + 1 WHERE id = 1 AND EXISTS (SELECT 1 FROM upgrade_feed WHERE event_id = ?)')
      .bind(eventId)
    const trim = db.prepare('DELETE FROM upgrade_feed WHERE event_id IN (SELECT event_id FROM upgrade_feed ORDER BY happened_at DESC, event_id DESC LIMIT -1 OFFSET 100)')
    ;[updated] = await db.batch([updatePlayer, insert, countSpin, trim])
  } else {
    updated = await updatePlayer.run()
  }
  if (!updated.meta.changes) return json({...playerResponse(await queryPlayer()), error: 'Данные обновились в другой вкладке. Повтори действие.'}, 409)
  return json({...playerResponse({state:JSON.stringify(state),version:row.version+1}), result})
}

export default {
  async fetch(request, env) {
    const {pathname} = new URL(request.url)
    if (pathname.startsWith('/api/')) {
      try { return await handleApi(request, env.DB, pathname) }
      catch { return json({error: 'Сервер временно недоступен.'}, 503) }
    }
    const asset = assets[pathname === '/' ? '/index.html' : pathname]
    if (!asset || !Array.isArray(asset)) return new Response('Not found', {status:404})
    const [body,type] = asset
    return new Response(request.method === 'HEAD' ? null : type === 'image/png' ? Uint8Array.from(atob(body), char => char.charCodeAt(0)) : body, {
      headers: {'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options':'nosniff'},
    })
  },
}

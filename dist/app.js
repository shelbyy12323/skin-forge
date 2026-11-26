const skins = Object.fromEntries(catalogData.map(skin => [skin.id, skin]))
const initial = { balance: 0, items: [], history: [] }
const storageKey = 'skin-forge-demo-v1'
let state = structuredClone(initial)
const selected = new Set()
let target = null
let stake = 0
let rolling = false
let pending = false
let loading = false
let version = null
let presencePending = false
let globalFeed = []
let feedPending = false
let activityTimeOffset = 0
let activePlayers = 0
let realSpins = null
let displayedOnline = null

const feedItems = new Map()
const botTick = 650
const activityStart = Date.UTC(2026, 10, 25, 18, 41)
const cheapDrops = catalogData.filter(skin => skin.price >= 4 && skin.price < 8)
const standardDrops = catalogData.filter(skin => skin.price >= 8 && skin.price < 18000)
let angle = 0
let lastRoll = null
let shopPage = 0
const shopPageSize = 24
let view = 'upgrade'
let page = 0
const pageSize = 36
const byId = id => document.getElementById(id)
const units = new Intl.NumberFormat('ru-RU')
const cents = value => Math.round(value * 100)
const coins = new Intl.NumberFormat('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})
const money = value => (Number.isInteger(value) && (value === 0 || value >= 10) ? units : coins).format(value) + ' ◈'
const chanceText = value => value > 0 && value < 0.1
  ? '< 0,1%'
  : value.toLocaleString('ru-RU', {maximumFractionDigits: 1}) + '%'
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)')

const session = (() => {
  const fresh = crypto.randomUUID()
  try {
    const key = 'skin-forge-server-session'
    const stored = localStorage.getItem(key)
    if (stored && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(stored)) return stored
    localStorage.setItem(key, fresh)
  } catch {}
  return fresh
})()


async function request(path, data) {
  const response = await fetch('/api/' + path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-Skin-Forge-Session': session},
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(10000),
  })
  return response.json()
}

function receivePlayer(payload) {
  version = payload.version
  state = payload.state
}

function refreshPlayer() {
  selected.clear()
  stake = 0
  resetWheel()
  renderInventory()
  renderFeed()
  update()
}

async function loadPlayer() {
  if (loading) return
  loading = true
  try {
    const payload = await request('player', {})
    if (!payload.state) throw Error(payload.error)
    receivePlayer(payload)
    refreshPlayer()
    byId('notice').textContent = ''
  } catch {
    byId('notice').textContent = 'Сервер недоступен. Подключение будет проверено снова.'
  } finally {
    loading = false
  }
}

async function perform(action) {
  const expected = version
  try {
    const payload = await request('action', {...action, version: expected})
    if (payload.state) receivePlayer(payload)
    if (payload.error) {
      if (payload.state) refreshPlayer()
      return {error: payload.error}
    }
    return payload.result
  } catch {
    await loadPlayer()
    return {error: version !== expected
      ? 'Баланс и инвентарь синхронизированы. Проверь результат перед повтором.'
      : 'Связь с сервером прервалась. Проверь баланс перед повтором.'}
  }
}

function locked() {
  return rolling || pending || version === null
}

function element(tag, value, className) {
  const node = document.createElement(tag)
  if (value) node.textContent = value
  if (className) node.className = className
  return node
}

function picture(skin) {
  const image = element('img', '', 'skin-image')
  image.src = skin.image
  image.alt = ''
  image.loading = 'lazy'
  image.decoding = 'async'
  image.referrerPolicy = 'no-referrer'
  image.addEventListener('error', () => image.classList.add('image-unavailable'), {once: true})
  return image
}

function investment() {
  return [...selected].reduce((total, index) => total + cents(skins[state.items[index]].price), cents(stake)) / 100
}

function probability(total, price) {
  return total > 0 && price > total ? Math.min(95, total / price * 90) : 0
}

function showSlot(node, skin, detail, emptyText) {
  node.replaceChildren()
  if (skin) {
    node.append(picture(skin), element('strong', detail), element('span', money(node.id === 'source' ? investment() : skin.price), 'item-price'))
  } else {
    const ghost = picture(skins[legacyIds[0]])
    ghost.className = 'ghost'
    node.append(ghost, element('span', emptyText))
  }
}

function syncSelection() {
  for (const card of document.querySelectorAll('.card')) {
    const {kind, index} = card.dataset
    if (!kind) continue
    if (kind === 'inventory' || kind === 'catalog') card.setAttribute('aria-pressed', kind === 'inventory' ? selected.has(Number(index)) : target === index)
    card.disabled = locked() || (kind === 'shop' && state.balance < skins[index].price)
  }
}

function resetWheel() {
  lastRoll = null
  angle = 0
  byId('needle').style.transform = ''
}

function hasFreeCase(id) { return id === caseCatalog[0].id && state.freeCases > 0 }

function update() {
  const total = investment()
  const targetSkin = target === null ? null : skins[target]
  const chance = targetSkin ? probability(total, targetSkin.price) : 0
  const first = selected.values().next()
  byId('wallet').textContent = money(state.balance)
  byId('profile-balance').textContent = money(state.balance)
  byId('stake').max = state.balance
  byId('stake').value = stake
  byId('stake').disabled = locked() || state.balance === 0
  byId('stake-value').textContent = money(stake)
  byId('inventory-count').textContent = state.items.length
  byId('clear').disabled = locked() || !selected.size
  byId('topup').disabled = locked()
  for (const button of document.querySelectorAll('[data-case-price]')) {
    const free = hasFreeCase(button.dataset.caseId)
    const missing = (free ? 0 : Number(button.dataset.casePrice)) - state.balance
    button.disabled = locked() || missing > 0
    if (!pending) button.textContent = free ? 'Открыть бесплатно · ' + state.freeCases : missing > 0 ? 'Не хватает ' + money(missing) : 'Открыть за ' + money(Number(button.dataset.casePrice))
  }
  for (const button of document.querySelectorAll('.presets button')) button.disabled = locked() || !total
  showSlot(byId('source'), first.done ? null : skins[state.items[first.value]],
    selected.size > 1 ? 'Выбрано предметов: ' + selected.size : skins[state.items[first.value]]?.name,
    stake ? 'Баланс ' + money(stake) : 'Выбери предметы из инвентаря')
  showSlot(byId('target'), targetSkin, targetSkin?.name, 'Выбери предмет из каталога')
  const shownChance = lastRoll?.chance ?? chance
  byId('dial').style.setProperty('--arc', shownChance * 3.6 + 'deg')
  byId('dial').dataset.tier = shownChance === 0 ? 'idle' : shownChance <= 25 ? 'low' : shownChance >= 50 ? 'high' : 'medium'
  byId('chance').textContent = chanceText(shownChance)
  byId('chance-note').textContent = rolling ? 'Идёт апгрейд' : lastRoll ? (lastRoll.success ? 'Успех' : 'Неудача') : !total || !targetSkin ? 'Выбери предметы' : !chance ? 'Цель должна стоить дороже' : 'Цель дороже ставки'
  byId('upgrade').disabled = locked() || !chance
  for (const button of speedOptions) button.disabled = rolling
  syncSelection()
}

function card(skin, index, kind) {
  const button = element('button', '', 'card')
  button.type = 'button'
  button.dataset.index = index
  button.dataset.kind = kind
  button.style.setProperty('--tone', skin.color)
  button.title = skin.type + ' · ' + skin.name + ' · ' + money(skin.price)
  button.append(element('span', money(skin.price), 'price'), picture(skin), element('strong', skin.name), element('small', skin.type))
  if (kind === 'shop') button.append(element('span', 'Купить', 'buy-label'))
  if (kind === 'sell') button.append(element('span',
    'Продать за ' + money(Math.floor(cents(skin.price) * 9 / 10) / 100), 'buy-label'))
  button.addEventListener('click', async () => {
    if (locked()) return
    if (kind === 'shop' || kind === 'sell') {
      if (kind === 'shop' && state.balance < skin.price) return
      pending = true
      update()
      const result = await perform(kind === 'sell'
        ? {kind: 'sell', id: skin.id, index}
        : {kind: 'buy', id: skin.id})
      if (kind === 'sell' && !result.error) selected.clear()
      pending = false
      stake = Math.min(stake, state.balance)
      resetWheel()
      renderInventory()
      update()
      byId('notice').textContent = result.error || (kind === 'sell'
        ? skin.name + ' продан за ' + money(result.credit) + '.'
        : skin.name + ' добавлен в инвентарь.')
      return
    }
    byId('notice').textContent = ''
    if (kind === 'inventory') {
      if (selected.has(index)) selected.delete(index)
      else selected.add(index)
    } else target = target === index ? null : index
    resetWheel()
    update()
  })
  return button
}

function renderInventory() {
  byId('inventory').replaceChildren(...state.items.map((id, index) => card(skins[id], index, 'inventory')))
  if (!state.items.length) byId('inventory').append(element('p', 'Инвентарь пуст. Используй демобаланс для следующего апгрейда.', 'empty'))
  if (view === 'profile') renderProfile()
}

function renderProfile() {
  byId('profile-count').textContent = units.format(state.items.length)
  const grid = byId('profile-items')
  grid.replaceChildren(...state.items.map((id, index) => card(skins[id], index, 'sell')))
  if (!state.items.length) grid.append(element('p', 'В инвентаре пока нет скинов.', 'empty'))
  syncSelection()
}

function priceRange(prefix) {
  const min = byId(prefix + 'min').valueAsNumber
  const max = byId(prefix + 'max').valueAsNumber
  return price => !(price < min || price > max)
}

function filteredSkins() {
  const query = byId('search').value.trim().toLowerCase()
  const withinRange = priceRange('')
  const direction = byId('sort').value === 'asc' ? 1 : -1
  const category = byId('category').value
  return catalogData.filter(skin => (!category || skin.category === category) && (skin.name + ' ' + skin.type).toLowerCase().includes(query) &&
    withinRange(skin.price)).sort((a, b) => direction * (a.price - b.price))
}

function renderCatalog() {
  const entries = filteredSkins()
  const pages = Math.max(1, Math.ceil(entries.length / pageSize))
  page = Math.min(Math.max(0, page), pages - 1)
  const visible = entries.slice(page * pageSize, (page + 1) * pageSize)
  byId('catalog').replaceChildren(...visible.map(skin => card(skin, skin.id, 'catalog')))
  byId('page-label').textContent = (page + 1) + ' / ' + pages + ' · ' + units.format(entries.length) + ' скинов'
  byId('prev').disabled = page === 0
  byId('next').disabled = page >= pages - 1
  if (!entries.length) byId('catalog').append(element('p', 'Скины не найдены.', 'empty'))
  syncSelection()
}

function demoDrops(now) {
  const tick = Math.floor(now / botTick)
  return Array.from({length: 6}, (_, index) => {
    const slot = tick - index
    const key = Math.imul(slot ^ (slot >>> 12), 1597334677) >>> 0
    const pool = slot % 4 === 0 ? standardDrops : cheapDrops
    const skin = pool[key % pool.length]
    return {key: 'demo-' + slot, bot: slot % 100 + 1, player: 'Бот ' + (slot % 100 + 1),
      id: skin.id, kind: 'case', success: true, at: slot * botTick}
  })
}

function renderFeed(now = Date.now() + activityTimeOffset) {
  const entries = [...globalFeed.slice(0, 10), ...demoDrops(now)].sort((a, b) => b.at - a.at)
  const keys = new Set(entries.map(entry => entry.key))
  for (const key of feedItems.keys()) {
    if (!keys.has(key)) feedItems.delete(key)
  }
  const items = []
  for (const entry of entries) {
    const skin = skins[entry.id]
    if (!skin) continue
    let item = feedItems.get(entry.key)
    if (!item) {
      item = element('div', '', 'feed-item feed-enter')
      item.style.setProperty('--tone', entry.success ? skin.color : '#c37676')
      const label = entry.kind === 'case' ? 'Кейс' : entry.success ? 'Успех' : 'Неудача'
      item.append(picture(skin), element('small', money(skin.price)), element('strong', skin.name),
        element('small', entry.player), element('small', label))
      if (entry.bot) {
        const profile = element('button', entry.player, 'bot-link')
        profile.onclick = () => inspectBot(entry.bot)
        item.children[3].replaceWith(profile)
      }
      feedItems.set(entry.key, item)
    }
    items.push(item)
  }
  const feed = byId('feed')
  if (feed.children.length !== items.length ||
    items.some((item, index) => item !== feed.children[index])) feed.replaceChildren(...items)
}

byId('stake').addEventListener('input', event => {
  stake = Number(event.target.value)
  resetWheel()
  byId('notice').textContent = ''
  update()
})
byId('clear').addEventListener('click', () => {
  selected.clear()
  resetWheel()
  update()
})
const deposit = byId('deposit')
const details = byId('deposit-details')
const confirmation = byId('deposit-confirm')
let pendingDeposit = null

function randomDemoFields() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const letters = [...crypto.getRandomValues(new Uint8Array(5))].map(value => alphabet[value % alphabet.length]).join('')
  byId('deposit-email').value = 'player-' + letters.toLowerCase() + '@example.test'
  byId('deposit-promo').value = letters
}

function depositCredit() {
  const amount = byId('deposit-amount').valueAsNumber
  const promo = byId('deposit-promo').value.trim()
  return amount + Math.floor(promo ? amount * .05 : 0)
}

function showDepositTotal() {
  const amount = byId('deposit-amount').valueAsNumber
  byId('deposit-total').textContent = byId('deposit-amount').validity.valid ? money(depositCredit()) : '—'
  for (const button of document.querySelectorAll('[data-amount]')) {
    button.setAttribute('aria-pressed', Number(button.dataset.amount) === amount)
  }
}

function depositStep(confirm) {
  deposit.dataset.step = confirm ? 'confirm' : 'details'
  byId('deposit-step').textContent = confirm ? '2 / 2' : '1 / 2'
  details.hidden = confirm
  confirmation.hidden = !confirm
  byId('deposit-title').textContent = confirm ? 'Подтверждение пополнения' : 'Пополнение баланса'
}

byId('topup').addEventListener('click', () => {
  if (locked() || deposit.open) return
  pendingDeposit = null
  byId('deposit-amount').value = 1000
  randomDemoFields()
  showDepositTotal()
  confirmation.reset()
  depositStep(false)
  deposit.showModal()
})
byId('deposit-close').addEventListener('click', () => deposit.close())
byId('deposit-back').addEventListener('click', () => {
  pendingDeposit = null
  depositStep(false)
  byId('deposit-amount').focus()
})
byId('deposit-random').addEventListener('click', () => {
  randomDemoFields()
  showDepositTotal()
})
for (const button of document.querySelectorAll('[data-amount]')) button.addEventListener('click', () => {
  byId('deposit-amount').value = button.dataset.amount
  showDepositTotal()
})
byId('deposit-amount').addEventListener('input', showDepositTotal)
byId('deposit-promo').addEventListener('input', showDepositTotal)
details.addEventListener('submit', event => {
  event.preventDefault()
  pendingDeposit = {
    amount: byId('deposit-amount').valueAsNumber,
    bonus: Boolean(byId('deposit-promo').value.trim()),
  }
  const method = details.querySelector('[name="deposit-method"]:checked').value
  const isSbp = method === 'СБП'
  byId('confirm-method').textContent = method + ' · демо'
  byId('demo-card-fields').hidden = isSbp
  byId('demo-sbp').hidden = !isSbp
  for (const field of byId('demo-card-fields').querySelectorAll('input')) field.disabled = isSbp
  byId('confirm-total').textContent = money(depositCredit())
  depositStep(true)
  if (isSbp) confirmation.querySelector('[type=submit]').focus()
  else byId('demo-card-number').focus()
})
byId('demo-card-expiry').addEventListener('input', event => {
  const field = event.target
  const digits = field.value.replace(/[^0-9]/g, '').slice(0, 4)
  field.value = digits.length > 2 ? digits.slice(0, 2) + '/' + digits.slice(2) : digits
})
confirmation.addEventListener('submit', async event => {
  event.preventDefault()
  if (!deposit.open || !pendingDeposit || locked() || !confirmation.reportValidity()) return
  const submit = confirmation.querySelector('[type=submit]')
  pending = true
  submit.disabled = true
  update()
  const result = await perform({kind: 'deposit', ...pendingDeposit})
  pending = false
  submit.disabled = false
  pendingDeposit = null
  confirmation.reset()
  deposit.close()
  byId('notice').textContent = result.error || 'Демобаланс пополнен на ' + money(result.credit)
  update()
})

function renderShop() {
  const query = byId('shop-search').value.trim().toLowerCase()
  const direction = byId('shop-sort').value === 'asc' ? 1 : -1
  const withinRange = priceRange('shop-')
  const entries = catalogData.filter(skin => withinRange(skin.price) && skin.name.toLowerCase().includes(query))
    .sort((a, b) => direction * (a.price - b.price))
  const pages = Math.max(1, Math.ceil(entries.length / shopPageSize))
  shopPage = Math.min(Math.max(0, shopPage), pages - 1)
  const visible = entries.slice(shopPage * shopPageSize, (shopPage + 1) * shopPageSize)
  byId('shop-cards').replaceChildren(...visible.map(skin => card(skin, skin.id, 'shop')))
  if (!entries.length) byId('shop-cards').append(element('p', 'Скины не найдены.', 'empty'))
  byId('shop-page-label').textContent = (shopPage + 1) + ' / ' + pages + ' · ' + units.format(entries.length) + ' скинов'
  byId('shop-prev').disabled = shopPage === 0
  byId('shop-next').disabled = shopPage >= pages - 1
  syncSelection()
}

function showShop(open) {
  byId('show-shop').setAttribute('aria-pressed', open)
  byId('show-inventory').setAttribute('aria-pressed', !open)
  byId('inventory-title').textContent = open ? 'Магазин' : 'Мои скины'
  byId('inventory-count').hidden = open
  byId('clear').hidden = open
  byId('inventory').hidden = open
  byId('shop').hidden = !open
  if (open) renderShop()
}

byId('show-shop').addEventListener('click', () => showShop(true))
byId('show-inventory').addEventListener('click', () => showShop(false))
for (const id of ['shop-search', 'shop-sort', 'shop-min', 'shop-max']) byId(id).addEventListener('input', () => {
  shopPage = 0
  renderShop()
})
for (const [id, delta] of [['shop-prev', -1], ['shop-next', 1]]) byId(id).addEventListener('click', () => {
  shopPage += delta
  renderShop()
  byId('inventory-title').scrollIntoView({block: 'nearest'})
})
for (const category of [...new Set(catalogData.map(skin => skin.category))].sort()) {
  const option = element('option', category)
  option.value = category
  byId('category').append(option)
}
for (const id of ['search', 'category', 'min', 'max', 'sort']) {
  byId(id).addEventListener('input', () => {
    page = 0
    renderCatalog()
  })
}
for (const [id, delta] of [['prev', -1], ['next', 1]]) {
  byId(id).addEventListener('click', () => {
    page += delta
    renderCatalog()
    byId('catalog-title').scrollIntoView({block: 'nearest'})
  })
}
function crateArt(box) {
  const frame = element('div', '', 'case-cover')
  const model = element('div', '', 'shell-model')
  const theme = caseCatalog.indexOf(box)
  model.style.setProperty('--hue', (theme * 41) + 'deg')
  model.append(element('span', '', 'shell-body'), element('span', '', 'shell-top'))
  if (theme !== 0) {
    const badge = element('span', '', 'shell-badge')
    badge.style.backgroundImage = 'url(' + box.cover + ')'
    model.append(badge)
  }
  const key = element('span', '', 'shell-key')
  model.append(key)
  frame.setAttribute('aria-hidden','true')
  frame.append(model)
  return frame
}

function renderCases() {
  const grid = byId('cases')
  grid.classList.remove('case-detail')
  grid.replaceChildren(...caseCatalog.map(box => {
    const tile = element('button', '', 'case-tile')
    tile.type = 'button'
    tile.style.setProperty('--tone', box.tone)
    const label = element('div', '', 'case-tile-label')
    label.append(element('strong', box.name), element('span', hasFreeCase(box.id) ? 'Бесплатно · ' + state.freeCases : money(box.price)))
    tile.append(crateArt(box), label)
    tile.addEventListener('click', () => renderCase(box))
    return tile
  }))
}

async function rollCase(stage, box, winner) {
  if (reduceMotion.matches || !stage.isConnected) return
  const viewport = element('div', '', 'loot-window')
  const track = element('div', '', 'loot-track')
  const landing = 24
  for (let i = 0; i < landing + 4; i++) {
    const skin = i === landing ? winner : skins[box.drops[Math.floor(Math.random() * box.drops.length)].id]
    const tile = element('div', '', 'loot-tile')
    tile.style.setProperty('--tone', skin.color)
    const image = picture(skin)
    image.loading = 'eager'
    tile.append(image, element('small', skin.name))
    track.append(tile)
  }
  const cover = stage.querySelector('.case-cover')
  const emerging = picture(winner)
  emerging.classList.add('loot-emerging')
  cover.append(emerging)
  try {
    await emerging.animate([{opacity:0, transform:'translate(-50%, 0) scale(.35)'}, {opacity:1, transform:'translate(-50%, -55%) scale(1.05)'}, {opacity:0, transform:'translate(-50%, -75%) scale(.95)'}],
      {duration:400, easing:'ease-out'}).finished
  } finally { emerging.remove() }
  viewport.append(track)
  cover.append(viewport)
  try {
    const target = track.children[landing]
    const distance = target.offsetLeft + target.offsetWidth / 2 - viewport.clientWidth / 2
    const animation = track.animate([{transform:'translateX(0)'}, {transform:'translateX(' + -distance + 'px)'}],
      {duration:wheelSpeed === 'fast' ? 2500 : 5500,easing:'cubic-bezier(.18,.72,.2,1)',fill:'forwards'})
    await animation.finished
    await target.animate([{filter:'brightness(2)', transform:'scale(.96)'},{filter:'brightness(1.12)',transform:'scale(1.06)'}],{duration:400,fill:'forwards'}).finished
  } finally { viewport.remove() }
}

function renderCase(box) {
  const grid = byId('cases')
  grid.classList.add('case-detail')
  const stage = element('article', '', 'case-stage')
  stage.style.setProperty('--tone', box.tone)
  const back = element('button', 'Все кейсы', 'quiet case-back')
  back.type = 'button'
  back.addEventListener('click', renderCases)
  const heading = element('h2', box.name)
  const reveal = element('div', '', 'case-reveal')
  reveal.setAttribute('role', 'status')
  reveal.hidden = true
  const open = element('button', 'Открыть за ' + money(box.price), 'primary')
  open.type = 'button'
  open.dataset.caseId = box.id
  open.dataset.casePrice = box.price
  if (hasFreeCase(box.id)) open.textContent = 'Открыть бесплатно · ' + state.freeCases
  open.disabled = locked() || (!hasFreeCase(box.id) && state.balance < box.price)
  open.addEventListener('click', async () => {
    if (locked() || (!hasFreeCase(box.id) && state.balance < box.price)) return
    pending = true
    reveal.hidden = true
    stage.classList.add('case-opening')
    byId('notice').textContent = 'Открываем ' + box.name + '…'
    update()
    open.textContent = 'Открывается…'
    back.disabled = true
    try {
      const [result] = await Promise.all([perform({kind:'case', id:box.id}),
        new Promise(resolve => setTimeout(resolve, reduceMotion.matches ? 0 : 900))])
      if (!result || result.error) {
        byId('notice').textContent = result?.error || 'Не удалось подтвердить открытие.'
        return
      }
      const skin = skins[result.id]
      try { await rollCase(stage, box, skin) } catch {}
      reveal.style.setProperty('--reward-tone', skin.color)
      reveal.replaceChildren(picture(skin), element('strong', skin.name), element('span', 'Добавлено в инвентарь'))
      reveal.hidden = false
      byId('notice').textContent = 'Выпал ' + skin.name + '.'
      void refreshFeed()
    } finally {
      stage.classList.remove('case-opening')
      pending = false
      back.disabled = false
      open.textContent = 'Открыть за ' + money(box.price)
      stake = Math.min(stake, state.balance)
      renderInventory()
      update()
    }
  })
  stage.append(back, crateArt(box), heading, open, reveal)

  const contents = element('section', '', 'case-contents')
  contents.append(element('h3', 'Содержимое кейса'))
  const prizes = element('div', '', 'cards')
  for (const drop of box.drops) {
    const skin = skins[drop.id]
    const prize = element('article', '', 'card case-prize')
    prize.style.setProperty('--tone', skin.color)
    prize.append(
      picture(skin), element('strong', skin.name), element('small', money(skin.price)))
    prizes.append(prize)
  }
  contents.append(prizes)
  grid.replaceChildren(stage, contents)
  update()
  stage.scrollIntoView({block:'nearest'})
  back.focus({preventScroll:true})
}

const sections = {
  upgrade: ['Skin Upgrade', 'Выбери скины, добавь баланс и попробуй улучшить свой инвентарь.'],
  cases: ['Cases', 'Открой демокейс и получи случайный скин. Шансы видны перед открытием.'],
  profile: ['Профиль', 'Управляй инвентарём и продавай скины за демомонеты.'],
  media: ['Медийка', 'Ролики, обновления и материалы по Counter-Strike 2.'],
}
const tabs = [...document.querySelectorAll('[data-view]')]
for (const tab of tabs) tab.addEventListener('click', () => {
  view = tab.dataset.view
  for (const item of tabs) item.setAttribute('aria-pressed', item === tab)
  const [title, description] = sections[view]
  byId('intro').hidden = view === 'cases'
  byId('intro').querySelector('h1').textContent = title
  byId('intro').querySelector('p').textContent = description
  byId('hero').hidden = view !== 'upgrade'
  byId('lists').hidden = view !== 'upgrade'
  byId('cases').hidden = view !== 'cases'
  if (view === 'cases') renderCases()
  byId('profile').hidden = view !== 'profile'
  if (view === 'profile') renderProfile()
  byId('media').hidden = view !== 'media'
  byId('notice').textContent = ''
  page = 0
  renderCatalog()
})
byId('media-art').append(picture(skins[legacyIds[15]]))
function demoOnline(now) {
  const tick = Math.floor(now / 900)
  const phase = tick / 9000
  return Math.round(5000 + 3700 * Math.sin(phase) + 1150 * Math.sin(phase * 2.3) + 130 * Math.sin(tick / 87) + 3 * Math.sin(tick * 1.7))
}

// Integrate the simulated population over time at one spin per 10 participants per second.
function simulatedSpins(now) {
  const elapsed = Math.max(0, now - activityStart)
  let playerMilliseconds = 5000 * elapsed
  for (const [amplitude, period] of [[3700, 8100000], [1150, 8100000 / 2.3], [130, 78300], [3, 900 / 1.7]]) {
    playerMilliseconds += amplitude * period * (Math.cos(activityStart / period) - Math.cos((activityStart + elapsed) / period))
  }
  return Math.floor(playerMilliseconds / 10000)
}

function updateActivity() {
  if (document.hidden) return
  const now = Date.now() + activityTimeOffset
  if (activePlayers !== null) {
    const online = Math.max(activePlayers, Math.min(10000, activePlayers + demoOnline(now)))
    displayedOnline = displayedOnline === null ? online : displayedOnline + Math.max(-2, Math.min(3, online - displayedOnline))
    const spins = 16836 + realSpins + simulatedSpins(now)
    byId('online').textContent = units.format(displayedOnline)
    byId('spin-total').textContent = units.format(spins)
  }
  renderFeed(now)
}

async function updateOnline() {
  if (document.hidden || presencePending) return
  presencePending = true
  try {
    if (version === null) await loadPlayer()
    if (version === null) return
    const {online, spins, now} = await request('online', {})
    if (![online, spins, now].every(Number.isSafeInteger)) throw Error('Presence unavailable')
    activePlayers = online
    realSpins = spins
    activityTimeOffset = now - Date.now()
    updateActivity()
  } catch {
    updateActivity()
  } finally {
    presencePending = false
  }
}

async function refreshFeed() {
  if (document.hidden || feedPending) return
  feedPending = true
  try {
    const {entries} = await request('feed', {})
    if (!Array.isArray(entries)) return
    globalFeed = entries
    renderFeed()
  } catch {} finally {
    feedPending = false
  }
}
setInterval(updateOnline, 25000)
setInterval(updateActivity, 100)
setInterval(refreshFeed, 5000)
document.addEventListener('visibilitychange', () => {
  updateActivity()
  void updateOnline()
  void refreshFeed()
})

const speedOptions = [...document.querySelectorAll('[data-speed]')]
let wheelSpeed = 'fast'
try {
  if (localStorage.getItem('demon-line-wheel-speed') === 'slow') wheelSpeed = 'slow'
} catch {}
function setWheelSpeed(speed) {
  wheelSpeed = speed
  for (const button of speedOptions) button.setAttribute('aria-pressed', button.dataset.speed === speed)
}
setWheelSpeed(wheelSpeed)
for (const button of speedOptions) button.addEventListener('click', () => {
  if (rolling) return
  setWheelSpeed(button.dataset.speed)
  try { localStorage.setItem('demon-line-wheel-speed', wheelSpeed) } catch {}
})
for (const button of document.querySelectorAll('.presets button')) {
  button.addEventListener('click', () => {
    const total = investment()
    const goal = button.dataset.factor ? total * Number(button.dataset.factor) : total * 90 / Number(button.dataset.chance)
    const closest = filteredSkins().filter(skin => skin.price > total)
      .sort((a, b) => Math.abs(a.price - goal) - Math.abs(b.price - goal))[0]
    byId('notice').textContent = closest ? '' : 'В текущем каталоге нет цели дороже ставки.'
    if (closest) {
      target = closest.id
      resetWheel()
    }
    update()
  })
}

byId('upgrade').addEventListener('click', async () => {
  if (locked() || target === null) return
  const skin = skins[target]
  const chance = probability(investment(), skin.price)
  if (!chance) return
  rolling = true
  byId('notice').textContent = ''
  update()
  const needle = byId('needle')
  const cycle = wheelSpeed === 'fast' ? 330 : 760
  const spin = reduceMotion.matches ? null : needle.animate([
    {transform: 'rotate(' + angle + 'deg)'},
    {transform: 'rotate(' + (angle + 360) + 'deg)'},
  ], {duration: cycle, iterations: Infinity})
  const result = await perform({kind: 'upgrade', id: skin.id, stake, items: [...selected]})
  const start = angle + ((Number(spin?.currentTime) || 0) % cycle) / cycle * 360
  spin?.cancel()
  if (result.error) {
    rolling = false
    update()
    byId('notice').textContent = result.error
    return
  }
  const {offset, success, chance: rolledChance} = result
  lastRoll = {chance: rolledChance, success}
  const advance = ((offset - start) % 360 + 360) % 360 + 360
  const end = start + advance
  if (!reduceMotion.matches) {
    const animation = needle.animate([{transform: 'rotate(' + start + 'deg)'}, {transform: 'rotate(' + end + 'deg)'}],
      {duration: advance * cycle / 180, easing: 'cubic-bezier(.3333,.6667,.6667,1)', fill: 'forwards'})
    try { await animation.finished } catch {}
    animation.cancel()
  }
  angle = end
  needle.style.transform = 'rotate(' + end + 'deg)'
  selected.clear()
  stake = 0
  rolling = false
  renderInventory()
  renderFeed()
  update()
  void refreshFeed()
  byId('notice').textContent = success ? 'Успех! ' + skin.name + ' добавлен в инвентарь.' : result.bonus ? 'Неудача. Во вкладке Cases доступен бесплатный кейс «' + caseCatalog[0].name + '».' : 'Неудача. Предметы и баланс из ставки списаны.'
})
renderInventory()
renderCatalog()
renderFeed()
update()
void updateOnline()
void refreshFeed()

let battleBusy=false, battleRequest=0, battleClock=0, lastBattle='', chosenBattleCase=caseCatalog[0].id
const battleBox=id=>caseCatalog.find(b=>b.id===id)
const battleId=()=>location.hash.match(/^#battle=([a-f0-9-]{36})$/)?.[1]
function battleButton(label,fn,primary=false){
  const button=element('button',label,primary?'primary':'quiet')
  button.onclick=fn
  return button
}
function enterBattle(id){
  history.pushState(null,'',id?'#battle='+id:location.pathname)
  lastBattle=''
  refreshBattles()
}
async function battleAction(action,data){
  if(document.body.classList.contains('guest'))return loginPanel()
  if(battleBusy)return
  battleBusy=true
  try{
    const r=await request('battles',{action,...data})
    if(r.error)throw Error(r.error)
    enterBattle(r.id)
    if(action==='join')void loadPlayer()
  }catch(e){byId('battle-error').textContent=e.message}
  finally{battleBusy=false}
}
function battleLobby(rooms){
  const bar=element('div','','battle-bar')
  const select=element('select')
  select.setAttribute('aria-label','Кейс для батла')
  for(const box of caseCatalog){const o=element('option',box.name+' · '+money(box.price));o.value=box.id;select.append(o)}
  select.value=chosenBattleCase
  select.onchange=()=>{chosenBattleCase=select.value}
  bar.append(select,battleButton('Создать батл +',()=>battleAction('create',{box:select.value}),true))
  const list=element('div','','battle-list')
  for(const room of rooms){
    const box=battleBox(room.box),row=element('article','','battle-row')
    row.style.setProperty('--tone',box.tone)
    row.append(element('small',{waiting:'Открыт',live:'LIVE',done:'Завершён'}[room.status]),crateArt(box),element('strong',box.name),element('span',money(box.price)),element('span',room.host+' / '+(room.guest||'Свободно')),battleButton('Смотреть',()=>enterBattle(room.id)))
    list.append(row)
  }
  if(!rooms.length)list.append(element('p','Пока нет батлов. Выбери кейс и пригласи соперника.'))
  byId('battle-content').replaceChildren(bar,list)
}
function battleRoom(room){
  const box=battleBox(room.box),bar=element('div','','battle-bar')
  bar.append(battleButton('← В лобби',()=>enterBattle(null)),element('strong',box.name+' · '+money(box.price)+' с игрока'),battleButton('Скопировать ссылку',async()=>{try{await navigator.clipboard.writeText(location.href);byId('battle-error').textContent='Ссылка скопирована.'}catch{byId('battle-error').textContent=location.href}}))
  const arena=element('div','','battle-arena')
  const sides=[room.host,room.guest]
  function side(i){
    const panel=element('article','','battle-side side-'+i)
    panel.append(element('h3',sides[i]||'Свободное место'))
    const skin=skins[room.drops?.[i]]
    if(skin)panel.append(picture(skin),element('strong',skin.name),element('span',money(skin.price)))
    else panel.append(crateArt(box))
    if(room.winner===sides[i]&&room.status==='done')panel.append(element('b','Победитель'))
    return panel
  }
  const clock=element('strong','','battle-clock')
  if(room.status==='waiting'||room.status==='live')clock.dataset.until=room.status==='waiting'?room.created+600000:room.reveal
  else clock.textContent=room.status==='done'?'Финиш':'Закрыт'
  arena.append(side(0),clock,side(1))
  const note=element('p',{waiting:'Ожидание второго игрока. Коины спишутся при его входе.',live:'До показа выпадений',done:room.winner+' получает оба скина.',expired:'Время ожидания истекло. Коины не списаны.'}[room.status])
  const nodes=[bar,arena,note]
  if(room.status==='waiting'&&byId('account-name').textContent!==room.host)nodes.push(battleButton('Участвовать · '+money(box.price),()=>battleAction('join',{id:room.id}),true))
  byId('battle-content').replaceChildren(...nodes)
  tickBattle()
}
function tickBattle(){
  const clock=document.querySelector('.battle-clock[data-until]')
  if(!clock||view!=='battles')return
  const sec=Math.max(0,Math.ceil((Number(clock.dataset.until)-Date.now()-battleClock)/1000))
  clock.textContent=sec>=60?Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0'):String(sec)
}
async function refreshBattles(){
  if(view!=='battles'||document.hidden)return
  const id=battleId(),seq=++battleRequest
  try{
    const r=await request('battles',id?{action:'room',id}:{action:'list'})
    if(seq!==battleRequest||view!=='battles'||id!==battleId())return
    if(r.error)throw Error(r.error)
    battleClock=r.now-Date.now()
    const key=JSON.stringify(r.room||r.rooms)
    if(lastBattle===key)return
    lastBattle=key
    byId('battle-error').textContent=''
    if(id){battleRoom(r.room);if(r.room.status==='done')void loadPlayer()}else battleLobby(r.rooms)
  }catch(e){if(seq===battleRequest){byId('battle-error').textContent=e.message;if(id&&!document.querySelector('.battle-bar'))byId('battle-content').replaceChildren(battleButton('← В лобби',()=>enterBattle(null)))}}
}
function openBattleLink(){
  if(battleId())document.querySelector('[data-view="battles"]').click()
  else if(view==='battles')refreshBattles()
}
window.addEventListener('popstate',openBattleLink)
setInterval(tickBattle,250)
setInterval(refreshBattles,2500)
openBattleLink()

async function accountCall(action, data={}) {
  const response = await request('account',{action,...data})
  if(response.error) throw Error(response.error)
  return response
}
function profileDialog(title) {
  const dialog=byId('accounts'), body=byId('accounts-body')
  body.replaceChildren(element('h2',title))
  if(!dialog.open) dialog.showModal()
  return body
}
function profileItems(body, ids) {
  const grid=element('div','','profile-gallery')
  for(const id of ids){
    const skin=skins[id]
    if(!skin) continue
    const tile=element('article','','collection-tile')
    tile.style.setProperty('--tone',skin.color)
    tile.append(picture(skin),element('small',skin.name))
    grid.append(tile)
  }
  body.append(grid.children.length?grid:element('p','Инвентарь пуст.'))
}
function inspectBot(number) {
  const body=profileDialog(botName(number))
  body.append(element('p','Последние 12 предметов симулированного игрока'))
  const tick=Math.floor((Date.now()+activityTimeOffset)/botTick)
  const last=tick-((tick%100-number+101)%100)
  const ids=Array.from({length:12},(_,i)=>{
    const slot=last-i*100
    const key=Math.imul(slot^(slot>>>12),1597334677)>>>0
    const pool=slot%4===0?standardDrops:cheapDrops
    return pool[key%pool.length].id
  })
  profileItems(body,ids)
}
function profileButton(label,fn) {
  const b=element('button',label)
  b.type='button'
  b.onclick=async()=>{b.disabled=true;try{await fn()}catch(e){byId('accounts-body').append(element('p',e.message))}finally{b.disabled=false}}
  return b
}
async function directory(admin=false,after='') {
  const {names,more}=await accountCall(admin?'admin':'list',{after})
  const body=profileDialog(admin?'Администрирование':'Игроки и боты')
  for(const name of names)body.append(profileButton(name,async()=>{
    const result=await accountCall('profile',{name})
    const detail=profileDialog(name)
    if(result.balance!==undefined)detail.append(element('p','Баланс: '+money(result.balance)))
    profileItems(detail,result.items)
    detail.append(profileButton('К списку',()=>directory(admin,after)))
  }))
  if(more)body.append(profileButton('Следующие игроки',()=>directory(admin,names.at(-1))))
  if(!admin){body.append(element('h3','Боты'));for(let n=1;n<=100;n++)body.append(profileButton(botName(n),()=>inspectBot(n)))}
}
function authForm(register=false) {
  const body=profileDialog(register?'Регистрация в Skin Forge':'Войти в Skin Forge')
  const form=document.createElement('form')
  const field=(name,type,placeholder,autocomplete)=>{
    const input=document.createElement('input')
    Object.assign(input,{name,type,placeholder,autocomplete,required:true})
    input.setAttribute('aria-label',placeholder)
    form.append(input)
    return input
  }
  const name=field('name','text','Логин','username')
  const password=field('password','password','Пароль',register?'new-password':'current-password')
  let invite
  if(register){
    invite=field('invite','password','Одноразовый ключ владельца','off')
    invite.hidden=true;invite.required=false
    name.oninput=()=>{invite.hidden=name.value.trim().toLowerCase()!=='shelbyy'}
  }
  const submit=element('button',register?'Зарегистрироваться':'Войти','primary')
  const message=element('p')
  message.setAttribute('role','status')
  form.append(submit,message)
  form.onsubmit=async e=>{
    e.preventDefault();submit.disabled=true
    try{await accountCall(register?'register':'login',{name:name.value,password:password.value,invite:invite?.value});location.reload()}
    catch(err){message.textContent=err.message;submit.disabled=false}
  }
  body.prepend(element('div','SF','forge-sign'))
  body.append(form,profileButton(register?'Уже есть аккаунт':'Создать аккаунт',()=>authForm(!register)))
  if(!register){
    const steam=element("a","Ранее входили через Steam?","steam-continue")
    steam.href="/api/steam"
    body.append(steam)
  }
}
window.addEventListener('DOMContentLoaded',async()=>{
  byId('directory').onclick=()=>directory().catch(e=>profileDialog(e.message))
  byId('admin-directory').onclick=()=>directory(true).catch(e=>profileDialog(e.message))
  byId('account-access').onclick=loginPanel
  for(const b of document.querySelectorAll('.enter-forge'))b.onclick=loginPanel
  rotatePreview()
  if(location.search==='?login=cancelled'){byId('notice').textContent='Вход через Steam не завершён.';history.replaceState(null,'','/')}
  try{
    const me=await accountCall('me')
    if(me.name){
      document.body.classList.remove('guest');update()
      byId('account-name').textContent=me.name
      if(me.name.startsWith('steam:')){const link=element('a','Профиль Steam');link.href='https://steamcommunity.com/profiles/'+me.name.slice(6);byId('account-name').replaceChildren(link)}
      byId('admin-directory').hidden=!me.admin
      const access=byId('account-access')
      access.textContent='Выйти'
      access.onclick=async()=>{await accountCall('logout');location.reload()}
    }
  }catch{}
})
function botName(number){
  const roots=['Luna','Тихий','Kuro','Bruma','Sora','Nube','Север','Nuit','Rayo','Mavi']
  const tails=['Echo','Fox','Orbit','Rune','Volt','Nova','Drift','Pixel','Wave','Flare']
  return roots[Math.floor((number-1)/10)]+'·'+tails[(number-1)%10]
}
function loginPanel(){ authForm(true) }
function rotatePreview(){
  const strip=byId('preview-skins')
  let step=0
  function draw(){
    if(!document.body.classList.contains('guest')||document.hidden)return
    strip.replaceChildren(...[-1,0,1].map((offset)=>{
      const skin=skins[legacyIds[(step+offset+legacyIds.length)%legacyIds.length]]
      const tile=element('div','','preview-tile')
      tile.append(picture(skin),element('small',skin.name));return tile
    }))
    step++
  }
  draw()
  if(!reduceMotion.matches)setInterval(draw,3600)
}

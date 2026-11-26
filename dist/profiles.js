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
  const body=profileDialog('Бот '+number)
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
  if(!admin){body.append(element('h3','Боты'));for(let n=1;n<=100;n++)body.append(profileButton('Бот '+n,()=>inspectBot(n)))}
}
function authForm(register=false) {
  const body=profileDialog(register?'Создать аккаунт':'Войти в Skin Forge')
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
  body.append(form,profileButton(register?'Уже есть аккаунт':'Создать аккаунт',()=>authForm(!register)))
}
window.addEventListener('DOMContentLoaded',async()=>{
  byId('directory').onclick=()=>directory().catch(e=>profileDialog(e.message))
  byId('admin-directory').onclick=()=>directory(true).catch(e=>profileDialog(e.message))
  byId('account-access').onclick=()=>authForm()
  try{
    const me=await accountCall('me')
    if(me.name){
      byId('account-name').textContent=me.name
      byId('admin-directory').hidden=!me.admin
      const access=byId('account-access')
      access.textContent='Выйти'
      access.onclick=async()=>{await accountCall('logout');location.reload()}
    }else if(!localStorage.getItem('forge-welcomed')){
      localStorage.setItem('forge-welcomed','1')
      authForm(true)
    }
  }catch{}
})

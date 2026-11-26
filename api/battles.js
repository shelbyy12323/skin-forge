import {createHash,randomInt,randomUUID} from 'node:crypto'
import {createClient} from '@libsql/client'
import {identity} from '../lib/accounts.js'
import {caseCatalog,prices} from '../dist/server/index.js'

let ready
async function connect(){
  const db=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN})
  await db.batch([
    'CREATE TABLE IF NOT EXISTS battles(id TEXT PRIMARY KEY,box TEXT NOT NULL,host TEXT NOT NULL,guest TEXT,created INTEGER NOT NULL,reveal INTEGER,drops TEXT,winner TEXT)',
    'CREATE INDEX IF NOT EXISTS battles_created ON battles(created DESC)'
  ],'write')
  return db
}
const waiting=10*60*1000
const countdown=10000
const fail=message=>{throw new Error(message,{cause:'game'})}
function roll(box){
  let n=randomInt(1000000)/10000
  return (box.drops.find(drop=>(n-=drop.chance)<0)||box.drops.at(-1)).id
}
function visible(row,now){
  const {drops,winner,...publicData}=row
  if(!row.guest)return {...publicData,status:row.created+waiting>now?'waiting':'expired'}
  return now<row.reveal?{...publicData,status:'live'}:{...publicData,status:'done',drops:JSON.parse(drops),winner}
}
async function player(tx,name,cost){
  const account=(await tx.execute({sql:'SELECT player FROM accounts WHERE name=?',args:[name]})).rows[0]
  if(!account)fail('Аккаунт недоступен.')
  const id=createHash('sha256').update(account.player).digest('hex')
  const row=(await tx.execute({sql:'SELECT state FROM players WHERE id=?',args:[id]})).rows[0]
  if(!row)fail('Сначала открой профиль игрока.')
  const state=JSON.parse(row.state)
  if(state.balance<cost)fail('У участника недостаточно коинов.')
  if(state.items.length>1998)fail('Для батла каждому нужны два свободных места в инвентаре.')
  return {id,state}
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store')
  if(req.method!=='POST'||!req.headers['content-type']?.startsWith('application/json'))return res.status(405).end()
  let tx
  try{
    ready??=connect().catch(e=>{ready=null;throw e})
    const db=await ready
    const {action,id,box:boxId}=req.body||{}
    const now=Date.now()
    if(action==='list'){
      const rows=(await db.execute({sql:'SELECT * FROM battles WHERE created>? AND (guest IS NOT NULL OR created>?) ORDER BY (guest IS NULL OR reveal>?) DESC,created DESC LIMIT 60',args:[now-86400000,now-waiting,now]})).rows
      return res.json({now,rooms:rows.map(r=>visible(r,now))})
    }
    if(action==='room'){
      const row=(await db.execute({sql:'SELECT * FROM battles WHERE id=?',args:[String(id)]})).rows[0]
      if(!row)fail('Комната не найдена.')
      return res.json({now,room:visible(row,now)})
    }
    const me=await identity(req)
    if(!me)return res.status(401).json({error:'Для участия войди в Skin Forge.'})
    tx=await db.transaction('write')
    let roomId=id
    if(action==='create'){
      const box=caseCatalog.find(x=>x.id===boxId)
      if(!box)fail('Выбери существующий кейс.')
      await player(tx,me.name,box.price)
      const open=(await tx.execute({sql:'SELECT id FROM battles WHERE host=? AND guest IS NULL AND created>? LIMIT 1',args:[me.name,now-waiting]})).rows[0]
      roomId=open?.id||randomUUID()
      if(!open)await tx.execute({sql:'INSERT INTO battles(id,box,host,created) VALUES(?,?,?,?)',args:[roomId,box.id,me.name,now]})
    }else if(action==='join'){
      const r=(await tx.execute({sql:'SELECT * FROM battles WHERE id=?',args:[String(id)]})).rows[0]
      if(!r||r.guest||r.host===me.name||r.created+waiting<=now)fail('Присоединение недоступно.')
      const box=caseCatalog.find(x=>x.id===r.box)
      const players=[await player(tx,r.host,box.price),await player(tx,me.name,box.price)]
      const drops=[roll(box),roll(box)]
      const diff=prices[drops[0]]-prices[drops[1]]
      const winner=diff===0?randomInt(2):Number(diff<0)
      for(const [i,p] of players.entries()){
        p.state.balance=Math.round((p.state.balance-box.price)*100)/100
        if(i===winner)p.state.items.push(...drops)
        await tx.execute({sql:'UPDATE players SET state=?,version=version+1 WHERE id=?',args:[JSON.stringify(p.state),p.id]})
      }
      await tx.execute({sql:'UPDATE battles SET guest=?,reveal=?,drops=?,winner=? WHERE id=?',args:[me.name,Date.now()+countdown,JSON.stringify(drops),[r.host,me.name][winner],id]})
    }else fail('Неизвестное действие.')
    await tx.commit()
    return res.json({id:roomId})
  }catch(e){if(tx&&!tx.closed)await tx.rollback().catch(()=>{});return res.status(e.cause==='game'?409:503).json({error:e.cause==='game'?e.message:'Батлы временно недоступны.'})}
  finally{tx?.close()}
}

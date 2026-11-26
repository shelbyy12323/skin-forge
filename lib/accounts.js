import {createHash,randomBytes,randomUUID,scrypt,timingSafeEqual} from 'node:crypto'
import {promisify} from 'node:util'
import {createClient} from '@libsql/client'

const derive=promisify(scrypt)
const hash=s=>createHash('sha256').update(s).digest('hex')
const cookie='__Host-forge'
const lifetime=30*86400
let connection
async function init(){
  const db=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN})
  await db.batch([
    'CREATE TABLE IF NOT EXISTS accounts(name TEXT PRIMARY KEY, salt TEXT NOT NULL, verifier TEXT NOT NULL, player TEXT NOT NULL UNIQUE)',
    'CREATE TABLE IF NOT EXISTS logins(digest TEXT PRIMARY KEY, name TEXT NOT NULL, expires INTEGER NOT NULL)',
    'CREATE INDEX IF NOT EXISTS login_expiry ON logins(expires)',
    'CREATE TABLE IF NOT EXISTS login_limits(bucket TEXT PRIMARY KEY,count INTEGER,expires INTEGER)',
    'CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY,version INTEGER NOT NULL,state TEXT NOT NULL,last_seen INTEGER NOT NULL DEFAULT 0)'
  ],'write')
  return db
}
async function database(){return connection??=init().catch(e=>{connection=null;throw e})}
function token(req){return (req.headers.cookie||'').match(/(?:^|; )__Host-forge=([a-f0-9]{64})(?:;|$)/)?.[1]}
export async function identity(req){
  const value=token(req)
  if(!value)return null
  const db=await database()
  return (await db.execute({sql:'SELECT a.name,a.player FROM logins l JOIN accounts a ON a.name=l.name WHERE digest=? AND expires>?',args:[hash(value),Date.now()]})).rows[0]
}
export async function account(req,res){
  res.setHeader('Cache-Control','private, no-store')
  if(req.method!=='POST'||!req.headers['content-type']?.startsWith('application/json'))return res.status(405).end()
  const {action,name:raw,password,invite}=req.body||{}
  const db=await database()
  const me=await identity(req)
  const fail=(message,status=400)=>res.status(status).json({error:message})
  if(action==='me')return res.json({name:me?.name??null,admin:me?.name==='shelbyy'})
  if(action==='logout'){
    if(token(req))await db.execute({sql:'DELETE FROM logins WHERE digest=?',args:[hash(token(req))]})
    res.setHeader('Set-Cookie',cookie+'=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0')
    return res.json({ok:true})
  }
  const name=String(raw||'').trim().toLowerCase()
  if(action==='list'||action==='admin'){
    if(action==='admin'&&me?.name!=='shelbyy')return fail('Доступ закрыт',403)
    const rows=(await db.execute({sql:'SELECT name FROM accounts WHERE name > ? ORDER BY name LIMIT 51',args:[String(req.body.after||'')]})).rows
    const names=rows.slice(0,50).map(x=>x.name)
    return res.json({names,more:rows.length>50})
  }
  if(action==='profile'){
    const found=(await db.execute({sql:'SELECT player FROM accounts WHERE name=?',args:[name]})).rows[0]
    if(!found)return fail('Профиль не найден',404)
    const row=(await db.execute({sql:'SELECT state FROM players WHERE id=?',args:[hash(found.player)]})).rows[0]
    const state=JSON.parse(row?.state||'{}')
    return res.json({items:state.items||[],...(me?.name==='shelbyy'?{balance:state.balance||0}:{})})
  }
  if(!['login','register'].includes(action)||!/^([a-z0-9_]){3,24}$/.test(name)||typeof password!=='string'||password.length<8||password.length>128)return fail('Логин: 3–24 латинские буквы, цифры или _. Пароль: 8–128 символов.')
  const now=Date.now(),expires=now+600000
  const ip=String(req.headers['x-vercel-forwarded-for']||req.socket?.remoteAddress||'unknown')
  const bucket=hash(ip+':'+Math.floor(now/600000))
  const limits=await db.batch([{sql:'DELETE FROM login_limits WHERE expires<?',args:[now]},{sql:'INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count',args:[bucket,expires]}],'write')
  if(limits[1].rows[0].count>30)return fail('Слишком много попыток. Повтори позже.',429)
  if(action==='register'){
    if(me)return fail('Сначала выйди из аккаунта.')
    if(name==='shelbyy'&&hash(String(invite||''))!=='9af4ff3f35c8e1e9134249397ff49ce394b7722669610c71cd94c2d34f0de1ea')return fail('Нужен ключ владельца.',403)
    const player=randomUUID(),salt=randomBytes(16).toString('hex'),verifier=(await derive(password,salt,64)).toString('hex')
    const guest=String(req.headers['x-skin-forge-session']||'')
    const statements=[{sql:'INSERT INTO accounts VALUES(?,?,?,?)',args:[name,salt,verifier,player]}]
    if(/^[a-f0-9-]{36}$/.test(guest))statements.push({sql:'UPDATE players SET id=? WHERE id=?',args:[hash(player),hash(guest)]})
    try{await db.batch(statements,'write')}catch(e){if(String(e).includes('UNIQUE'))return fail('Логин занят.',409);throw e}
  }else{
    const row=(await db.execute({sql:'SELECT salt,verifier FROM accounts WHERE name=?',args:[name]})).rows[0]
    const key=await derive(password,row?.salt||'unknown',64)
    if(!row||!timingSafeEqual(key,Buffer.from(row.verifier,'hex')))return fail('Неверный логин или пароль.',401)
  }
  const value=randomBytes(32).toString('hex')
  await db.batch([{sql:'DELETE FROM logins WHERE expires<=?',args:[now]},{sql:'INSERT INTO logins VALUES(?,?,?)',args:[hash(value),name,now+lifetime*1000]}],'write')
  res.setHeader('Set-Cookie',cookie+'='+value+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+lifetime)
  return res.json({name})
}
export async function steamSession(res,id,state){
  const db=await database(),name='steam:'+id,value=randomBytes(32).toString('hex'),now=Date.now()
  await db.batch([
    'CREATE TABLE IF NOT EXISTS steam_callbacks(state TEXT PRIMARY KEY,expires INTEGER NOT NULL)',
    {sql:'DELETE FROM steam_callbacks WHERE expires < ?',args:[now]},
    {sql:'INSERT INTO steam_callbacks VALUES(?,?)',args:[hash(state),now+600000]},
    {sql:'INSERT OR IGNORE INTO accounts VALUES(?,?,?,?)',args:[name,'steam','steam',randomUUID()]},
    {sql:'INSERT INTO logins VALUES(?,?,?)',args:[hash(value),name,now+lifetime*1000]}
  ],'write')
  res.setHeader('Set-Cookie',[cookie+'='+value+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+lifetime,'__Host-forge-steam=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'])
}

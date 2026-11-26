import {createClient} from '@libsql/client'
import {identity} from '../lib/accounts.js'
import worker from '../dist/server/index.js'

let ready
async function connect() {
  const client = createClient({url:process.env.TURSO_DATABASE_URL, authToken:process.env.TURSO_AUTH_TOKEN})
  await client.batch([
    'CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY,version INTEGER NOT NULL,state TEXT NOT NULL,last_seen INTEGER NOT NULL DEFAULT 0)',
    'CREATE INDEX IF NOT EXISTS players_seen ON players(last_seen)',
    "CREATE TABLE IF NOT EXISTS upgrade_feed(event_id TEXT PRIMARY KEY,player_label TEXT NOT NULL,skin_id TEXT NOT NULL,chance REAL NOT NULL,success INTEGER NOT NULL,happened_at INTEGER NOT NULL,kind TEXT NOT NULL DEFAULT 'upgrade')",
    'CREATE INDEX IF NOT EXISTS upgrade_feed_recent ON upgrade_feed(happened_at DESC)',
    'CREATE TABLE IF NOT EXISTS site_stats(id INTEGER PRIMARY KEY,spins INTEGER NOT NULL)',
    'INSERT OR IGNORE INTO site_stats VALUES(1,0)'
  ], 'write')
  const wrap = r => ({results:r.rows,meta:{changes:r.rowsAffected}})
  function prepare(sql,args=[]) {
    const statement={sql,args}
    const run=async()=>wrap(await client.execute(statement))
    return {statement, bind:(...values)=>prepare(sql,values), run,all:run,first:async()=>(await run()).results[0]}
  }
  return {prepare,batch:async queries=>(await client.batch(queries.map(q=>q.statement),'write')).map(wrap)}
}

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store')
  try {
    ready ??= connect().catch(error=>{ready=undefined;throw error})
    const db=await ready
    const me=await identity(req)
    const request=new Request('https://localhost/api/'+req.query.operation,{method:req.method,headers:{'X-Skin-Forge-Session':me?.player??req.headers['x-skin-forge-session']??''},body:req.method==='POST'?JSON.stringify(req.body??{}):undefined})
    const result=await worker.fetch(request,{DB:db})
    res.status(result.status).json(await result.json())
  } catch {
    res.status(503).json({error:'База данных временно недоступна.'})
  }
}

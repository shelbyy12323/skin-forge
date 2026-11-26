import {randomBytes} from 'node:crypto'
import {steamSession} from '../lib/accounts.js'

const origin='https://skin-forge-rho.vercel.app'
const endpoint='https://steamcommunity.com/openid/login'
const ns='http://specs.openid.net/auth/2.0'
const cookie='__Host-forge-steam'
const callback=state=>origin+'/api/steam?state='+state
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store')
  res.setHeader('Referrer-Policy','no-referrer')
  if(req.method!=='GET')return res.status(405).end()
  const q=new URL(req.url,origin).searchParams
  if(!q.has('state')){
    const state=randomBytes(32).toString('hex')
    res.setHeader('Set-Cookie',cookie+'='+state+'; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax')
    const start=new URL(endpoint)
    for(const [k,v] of Object.entries({ns,mode:'checkid_setup',realm:origin+'/',return_to:callback(state),claimed_id:ns+'/identifier_select',identity:ns+'/identifier_select'}))start.searchParams.set('openid.'+k,v)
    return res.redirect(302,start.href)
  }
  const state=q.get('state'),get=k=>q.get('openid.'+k)
  const id=get('claimed_id')?.match(/^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/)?.[1]
  const signed=new Set((get('signed')||'').split(','))
  const nonceTime=Date.parse((get('response_nonce')||'').slice(0,20))
  const reject=()=>res.redirect(303,origin+'/?login=cancelled')
  if(!/^[a-f0-9]{64}$/.test(state)||!(req.headers.cookie||'').split('; ').includes(cookie+'='+state)||!id||get('mode')!=='id_res'||get('ns')!==ns||get('identity')!==get('claimed_id')||get('return_to')!==callback(state)||get('op_endpoint')!==endpoint||!['claimed_id','identity','return_to','op_endpoint','response_nonce','assoc_handle'].every(x=>signed.has(x))||!Number.isFinite(nonceTime)||Math.abs(Date.now()-nonceTime)>600000)return reject()
  try{
    const body=new URLSearchParams([...q].filter(([k])=>k.startsWith('openid.')))
    body.set('openid.mode','check_authentication')
    const response=await fetch(endpoint,{method:'POST',body,redirect:'error',signal:AbortSignal.timeout(8000)})
    if(!response.ok||!/^is_valid:true\r?$/m.test(await response.text()))return reject()
    await steamSession(res,id,state)
    return res.redirect(303,origin+'/')
  }catch{return reject()}
}

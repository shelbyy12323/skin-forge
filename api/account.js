import {account} from '../lib/accounts.js'
export default async function handler(req,res){
  try {await account(req,res)} catch {res.status(503).json({error:'Сервис аккаунтов временно недоступен.'})}
}

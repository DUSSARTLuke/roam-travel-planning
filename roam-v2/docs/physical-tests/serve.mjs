import http from 'node:http'
import { readFileSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stage, testOrigin, verifyStage } from './prepare.mjs'
export function makeServer(folder=stage,expectedHost=new URL(testOrigin).host){
 return http.createServer((req,res)=>{
  if(req.headers.host!==expectedHost){res.writeHead(421);res.end('Host de test inattendu');return}
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return}
  let path;try{path=decodeURIComponent(new URL(req.url,testOrigin).pathname)}catch{res.writeHead(400);res.end();return}
  if(path.includes('\\')||path.split('/').some(part=>part==='..'||part.startsWith('.'))){res.writeHead(400);res.end();return}
  const target=resolve(folder,'.'+path+(path.endsWith('/')?'index.html':''))
  if(!target.startsWith(resolve(folder)+sep)){res.writeHead(403);res.end();return}
  try{if(!statSync(target).isFile())throw Error();const mime={html:'text/html; charset=utf-8',js:'text/javascript',css:'text/css',json:'application/json',webmanifest:'application/manifest+json',svg:'image/svg+xml',png:'image/png',zip:'application/zip',pdf:'application/pdf'}[target.split('.').pop()]??'application/octet-stream'
   res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin',...(target.endsWith('.zip')?{'Content-Disposition':'attachment; filename="roam-test-fiction.zip"'}:{})});res.end(req.method==='HEAD'?undefined:readFileSync(target))
  }catch{res.writeHead(404);res.end('Fichier de test introuvable')}
 })
}
if(process.argv[1]===fileURLToPath(import.meta.url)){verifyStage();const server=makeServer();server.on('error',error=>{console.error(error.message);process.exitCode=1});server.listen(48621,'127.0.0.1',()=>console.log(`${testOrigin}/test-tools/ — serveur local uniquement, Ctrl+C pour arrêter`))}

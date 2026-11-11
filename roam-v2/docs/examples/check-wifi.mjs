// Adresse fictive : le serveur de ce test écoute uniquement sur loopback.
import assert from 'node:assert/strict'
import http from 'node:http'
import { wifiServer } from '../physical-tests/serve-wifi.mjs'
import { verifyStage } from '../physical-tests/prepare.mjs'
verifyStage();assert.throws(()=>wifiServer('8.8.8.8'))
const server=wifiServer('192.168.50.10');await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const get=(path,host)=>new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port:server.address().port,path,headers:{Host:host}},response=>{let body='';response.on('data',chunk=>body+=chunk);response.on('end',()=>resolve({status:response.statusCode,body}))}).on('error',reject)})
try{const page=await get('/wifi-test/','192.168.50.10:48622');assert.equal(page.status,200);for(const path of ['/wifi-test','/wifi-test?test=1','/wifi-test/?test=1'])assert.equal((await get(path,'192.168.50.10:48622')).status,200,path);assert(page.body.includes('sans validation PWA'));assert.equal((await get('/','evil.example')).status,421);assert.equal((await get('/test-fixtures/roam-test-fiction.zip','192.168.50.10:48622')).status,200);assert.equal((await get('/','192.168.50.10:48622')).status,200);assert.equal((await get('/%2e%2e%2fpackage.json','192.168.50.10:48622')).status,400);console.log('PASS Wi-Fi : page dédiée, candidat/ZIP accessibles, Host et traversée refusés, IPv4 publique refusée ; serveur privé temporaire arrêté.')}finally{await new Promise(resolve=>server.close(resolve))}

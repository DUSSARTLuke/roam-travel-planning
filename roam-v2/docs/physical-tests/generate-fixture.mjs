import { spawn, execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import net from 'node:net'
import { root,stage,hash,files,verifyStage } from './prepare.mjs'
import { readFileSync } from 'node:fs'
import { openBrowser,pause } from './browser.mjs'
execFileSync(process.execPath,[join(root,'tests/verify-candidate.mjs')],{cwd:root,stdio:'inherit'});verifyStage()
if(existsSync(join(stage,'test-fixtures/roam-test-fiction.zip'))){console.log('Fixture existante vérifiée, aucun remplacement.');process.exit(0)}
const port=await new Promise(resolve=>{const socket=net.createServer();socket.listen(0,'127.0.0.1',()=>{const port=socket.address().port;socket.close(()=>resolve(port))})})
const vite=spawn(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'--config',join(root,'tests/vite.isolated.config.ts'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:'ignore',windowsHide:true});let browser
try{
 for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/docs/physical-tests/fixture.html`)).ok)break}catch{}await pause(100)}
 browser=await openBrowser();await browser.command('Page.navigate',{url:`http://127.0.0.1:${port}/docs/physical-tests/fixture.html`});await browser.wait('document.readyState==="complete"')
 const result=await browser.evaluate(`(async()=>{const module=await import('/docs/physical-tests/seed-fixture.ts');return module.generateFiction()})()`)
 mkdirSync(join(stage,'test-fixtures'));writeFileSync(join(stage,'test-fixtures/roam-test-fiction.zip'),Buffer.from(result.base64,'base64'));writeFileSync(join(stage,'test-fixtures/summary.json'),JSON.stringify(result.summary,null,2)+'\n')
 const info=JSON.parse(readFileSync(join(stage,'preview-info.json')));info.fixture=result.summary;info.added.push('test-fixtures/roam-test-fiction.zip','test-fixtures/summary.json');info.inventory=files(stage).filter(path=>path!=='preview-info.json').map(path=>({path,sha256:hash(readFileSync(join(stage,path)))}));writeFileSync(join(stage,'preview-info.json'),JSON.stringify(info,null,2)+'\n');verifyStage();console.log('Fixture ZIP2 fictive générée et restaurée sur base temporaire :',JSON.stringify(result.summary))
}finally{browser?.close();try{execFileSync('taskkill',['/PID',String(vite.pid),'/T','/F'],{stdio:'ignore',windowsHide:true})}catch{}}

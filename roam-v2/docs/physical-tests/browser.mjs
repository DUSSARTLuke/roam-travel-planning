import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
export const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
export async function openBrowser(){
 const profile=mkdtempSync(join(tmpdir(),'roam-physical-prep-')),chrome=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true})
 let socket
 try{
  const active=join(profile,'DevToolsActivePort');for(let i=0;i<100&&!existsSync(active);i++)await pause(100);if(!existsSync(active))throw Error('Chrome temporaire indisponible')
  const port=Number(readFileSync(active,'utf8').split('\n')[0]),tabs=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();socket=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
  let id=0;const pending=new Map();socket.onmessage=({data})=>{const message=JSON.parse(data);const request=pending.get(message.id);if(request){pending.delete(message.id);if(message.error)request.reject(Error(JSON.stringify(message.error)));else request.resolve(message.result)}}
  const command=(method,params={})=>new Promise((resolve,reject)=>{const current=++id;pending.set(current,{resolve,reject});socket.send(JSON.stringify({id:current,method,params}))})
  const evaluate=async expression=>{const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result?.value}
  await command('Page.enable');await command('Runtime.enable')
  return {command,evaluate,async wait(expression){for(let i=0;i<150;i++){if(await evaluate(expression))return;await pause(100)}throw Error('État attendu absent : '+expression)},close(){socket.close();try{execFileSync('taskkill',['/PID',String(chrome.pid),'/T','/F'],{stdio:'ignore',windowsHide:true})}catch{}try{rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200})}catch{console.log('Profil de test temporaire conservé :',profile)}}}
 }catch(error){socket?.close();try{execFileSync('taskkill',['/PID',String(chrome.pid),'/T','/F'],{stdio:'ignore',windowsHide:true})}catch{}throw error}
}

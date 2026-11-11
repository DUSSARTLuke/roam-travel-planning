// Retain immutable, hashed public V2 assets for clients deferring the PWA update.
import { readFileSync,writeFileSync,existsSync,mkdirSync } from 'node:fs'
import { join,dirname } from 'node:path'
import { root,hash } from '../physical-tests/prepare.mjs'
const folder=join(root,'node_modules/.tmp/v21-final-rc'),old=join(folder,'public-v2'),site=join(folder,'site'),capture=JSON.parse(readFileSync(join(old,'capture.json'))),manifest=JSON.parse(readFileSync(join(old,'precache-manifest.json')))
const pending=manifest.entries.filter(entry=>/^assets\/.*\.(js|css)$/.test(entry.path)).map(entry=>entry.path),seen=new Set(),retained=[]
while(pending.length){const path=pending.shift();if(seen.has(path))continue;seen.add(path);if(!/^assets\/[A-Za-z0-9_-]+\.(js|css)$/.test(path))throw Error('Chemin historique inattendu')
 let bytes;if(existsSync(join(old,path)))bytes=readFileSync(join(old,path));else{const response=await fetch(capture.origin+path,{cache:'no-store'});if(!response.ok)throw Error(path+' HTTP '+response.status);bytes=Buffer.from(await response.arrayBuffer());mkdirSync(dirname(join(old,path)),{recursive:true});writeFileSync(join(old,path),bytes);capture.inventory.push({path,sha256:hash(bytes)})}
 const expected=capture.inventory.find(entry=>entry.path===path);if(!expected||expected.sha256!==hash(bytes))throw Error('Capture historique altérée')
 if(path.endsWith('.js'))for(const match of bytes.toString().matchAll(/(?:assets\/|\.\/)?(maplibre(?:Preview|-gl-worker)-[A-Za-z0-9_-]+\.(?:js|css))/g))pending.push('assets/'+match[1])
 const target=join(site,path);if(existsSync(target)){if(hash(readFileSync(target))!==hash(bytes))throw Error('Collision asset V2/V2.1 '+path)}else{mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes)}retained.push({path,sha256:hash(bytes)})
}
writeFileSync(join(old,'capture.json'),JSON.stringify(capture,null,2)+'\n');writeFileSync(join(root,'docs/release/grace-results.json'),JSON.stringify({purpose:'Immutable V2 assets retained outside V2.1 precache for deferred-update clients',previousBuild:capture.buildId,retained},null,2)+'\n');console.log('PASS assets V2 de transition conservés sans collision',retained.map(item=>item.path).join(', '))

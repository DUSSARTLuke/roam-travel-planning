import { mkdirSync,writeFileSync,existsSync,readFileSync } from 'node:fs'
import { join,dirname } from 'node:path'
import { root,hash } from '../physical-tests/prepare.mjs'
const origin='https://dussartluke.github.io/roam-travel-planning/',folder=join(root,'node_modules/.tmp/v21-final-rc/public-v2')
if(existsSync(join(folder,'capture.json')))throw Error('Capture existante : aucune substitution automatique')
const get=async path=>{if(path.includes('..')||path.startsWith('/')||path.includes('\\'))throw Error('Chemin refusé');const response=await fetch(origin+path,{cache:'no-store'});if(!response.ok)throw Error(path+' HTTP '+response.status);return Buffer.from(await response.arrayBuffer())}
const release=await get('release-info.json'),manifestBytes=await get('precache-manifest.json'),manifest=JSON.parse(manifestBytes)
if(JSON.parse(release).source!=='65857661eba878a6636362cf061ceff1e2f1591e')throw Error('Source publique différente : réauditer')
mkdirSync(folder,{recursive:true});const inventory=[]
for(const path of [...new Set([...manifest.entries.map(entry=>entry.path),'sw.js','precache-manifest.json','release-info.json'])]){const bytes=path==='precache-manifest.json'?manifestBytes:path==='release-info.json'?release:await get(path);const expected=manifest.entries.find(entry=>entry.path===path)?.sha256;if(expected&&hash(bytes)!==expected)throw Error('Intégrité publique invalide '+path);mkdirSync(dirname(join(folder,path)),{recursive:true});writeFileSync(join(folder,path),bytes);inventory.push({path,sha256:hash(bytes)})}
const sw=readFileSync(join(folder,'sw.js'),'utf8');if(!sw.includes(manifest.buildId))throw Error('Worker public différent du précache')
writeFileSync(join(folder,'capture.json'),JSON.stringify({origin,source:JSON.parse(release).source,buildId:manifest.buildId,capturedAt:new Date().toISOString(),inventory},null,2)+'\n')
console.log('PASS capture publique en lecture seule',manifest.buildId,inventory.length,'fichiers vérifiés ; aucun navigateur public ouvert')

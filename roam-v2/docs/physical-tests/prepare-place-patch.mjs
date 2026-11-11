// Deliberately derived build: keep the original frozen preview untouched.
import { cpSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { root,stage,files,hash,verifyStage } from './prepare.mjs'
const destination=join(root,'node_modules/.tmp/v21f2-place-preview')
verifyStage()
const previous=existsSync(destination)?verifyStage(destination):null;
if(existsSync(destination))verifyStage(destination) // Only previously verified generated files may be replaced.
cpSync(stage,destination,{recursive:true})
const original=JSON.parse(readFileSync(join(destination,'preview-info.json')))
cpSync(join(root,'dist'),destination,{recursive:true})
cpSync(join(stage,'manifest.webmanifest'),join(destination,'manifest.webmanifest'))
const precache=JSON.parse(readFileSync(join(destination,'precache-manifest.json')))
const entries=precache.entries.map(entry=>({...entry,sha256:hash(readFileSync(join(destination,entry.path)))}))
const template=readFileSync(join(root,'pwa/service-worker.js'),'utf8')
const buildId=hash(JSON.stringify(entries)+template).slice(0,24)
writeFileSync(join(destination,'precache-manifest.json'),JSON.stringify({buildId,entries},null,2))
writeFileSync(join(destination,'sw.js'),template.replace('const PRECACHE = []',`const PRECACHE = ${JSON.stringify(entries)}`).replace("const BUILD_ID = ''",`const BUILD_ID = ${JSON.stringify(buildId)}`))
const info={...original,previousTestToken:original.baseCandidate+':'+original.previewBuildId,previousTestTokens:[original.baseCandidate+':'+original.previewBuildId,...(previous?[previous.baseCandidate+':'+previous.previewBuildId,...(previous.previousTestTokens??[])]:[])],patch:'Correctif recherche de lieux déplacements/hébergements et diagnostic GPS — dérivé du candidat, code applicatif modifié',previewBuildId:buildId,patchSource:files(join(root,'src')).map(path=>({path,sha256:hash(readFileSync(join(root,'src',path)))})),inventory:files(destination).filter(path=>path!=='preview-info.json').map(path=>({path,sha256:hash(readFileSync(join(destination,path)))}))}
writeFileSync(join(destination,'preview-info.json'),JSON.stringify(info,null,2)+'\n');verifyStage(destination)
console.log('Copie TEST corrigée préparée :',destination,'build',buildId,'; original conservé.')

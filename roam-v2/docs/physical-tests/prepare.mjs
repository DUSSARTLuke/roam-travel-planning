import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
export const root=fileURLToPath(new URL('../../',import.meta.url))
export const stage=join(root,'node_modules/.tmp/v21f2-preview')
export const testOrigin='http://localhost:48621'
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
export function files(folder){return readdirSync(folder,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(folder,entry.name)).map(path=>`${entry.name}/${path}`):entry.isFile()?[entry.name]:[]).sort()}
export function verifyStage(folder=stage){
 const info=JSON.parse(readFileSync(join(folder,'preview-info.json')))
 if(info.origin!==testOrigin||info.baseCandidate!=='V2.1f.1-RC-ff65f37f336f')throw Error('Préversion inattendue')
 const actual=files(folder).filter(path=>path!=='preview-info.json');if(JSON.stringify(actual)!==JSON.stringify(info.inventory.map(entry=>entry.path)))throw Error('Inventaire de préversion différent : arrêt sans suppression')
 for(const entry of info.inventory)if(hash(readFileSync(join(folder,entry.path)))!==entry.sha256)throw Error(`Préversion altérée : ${entry.path}`)
 const candidate=JSON.parse(readFileSync(join(root,'docs/v21f1-candidate.json')))
 if(info.candidateFingerprint!==candidate.source.sha256)throw Error('Empreinte de candidat différente')
 return info
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 execFileSync(process.execPath,[join(root,'tests/verify-candidate.mjs')],{cwd:root,stdio:'inherit'})
 if(existsSync(stage)){console.log('Préversion existante vérifiée :',verifyStage().previewBuildId);process.exit(0)}
 mkdirSync(stage,{recursive:true});cpSync(join(root,'dist'),stage,{recursive:true})
 const manifestPath=join(stage,'manifest.webmanifest'),manifest=JSON.parse(readFileSync(manifestPath))
 manifest.name='Roam TEST V2.1';manifest.short_name='Roam TEST';manifest.description='Préversion isolée — voyages et documents fictifs uniquement.'
 writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n')
 const original=JSON.parse(readFileSync(join(stage,'precache-manifest.json')))
 const entries=original.entries.map(entry=>({...entry,sha256:hash(readFileSync(join(stage,entry.path)))}))
 const template=readFileSync(join(root,'pwa/service-worker.js'),'utf8')
 const buildId=createHash('sha256').update(JSON.stringify(entries)).update(template).digest('hex').slice(0,24)
 writeFileSync(join(stage,'sw.js'),template.replace('const PRECACHE = []',`const PRECACHE = ${JSON.stringify(entries)}`).replace("const BUILD_ID = ''",`const BUILD_ID = ${JSON.stringify(buildId)}`))
 writeFileSync(join(stage,'precache-manifest.json'),JSON.stringify({buildId,entries},null,2))
 mkdirSync(join(stage,'test-tools'));for(const name of ['index.html','landing.js'])cpSync(join(root,'docs/physical-tests',name),join(stage,'test-tools',name))
 const changed=files(join(root,'dist')).filter(path=>hash(readFileSync(join(root,'dist',path)))!==hash(readFileSync(join(stage,path))))
 if(JSON.stringify(changed)!==JSON.stringify(['manifest.webmanifest','precache-manifest.json','sw.js']))throw Error('Différences applicatives inattendues : '+changed.join(','))
 const candidate=JSON.parse(readFileSync(join(root,'docs/v21f1-candidate.json')))
 const info={baseCandidate:candidate.id,candidateFingerprint:candidate.source.sha256,origin:testOrigin,previewBuildId:buildId,originalBuildId:original.buildId,changed,added:['preview-info.json','test-tools/index.html','test-tools/landing.js'],inventory:files(stage).map(path=>({path,sha256:hash(readFileSync(join(stage,path)))}))}
 writeFileSync(join(stage,'preview-info.json'),JSON.stringify(info,null,2)+'\n');verifyStage()
 console.log('Préversion préparée, serveur non lancé :',stage);console.log('Origine réservée :',testOrigin);console.log('Différences documentées :',changed.join(', '))
}

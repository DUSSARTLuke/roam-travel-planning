import { readFileSync, readdirSync } from 'node:fs'
import { resolve, relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const root=fileURLToPath(new URL('../',import.meta.url)),hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const candidate=JSON.parse(readFileSync(join(root,'docs/v21f1-candidate.json'),'utf8'))
function files(directory){return readdirSync(join(root,directory),{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(`${directory}/${entry.name}`):entry.isFile()?[`${directory}/${entry.name}`]:[])}
function verify(group){const actual=[...group.roots.flatMap(files),...group.files].sort();assert.deepEqual(actual,group.inventory.map(entry=>entry.path),'Candidate file inventory changed');for(const entry of group.inventory){const absolute=resolve(root,entry.path);assert(!relative(root,absolute).startsWith('..'),'Path outside project');assert.equal(hash(readFileSync(absolute)),entry.sha256,`Candidate changed: ${entry.path}`)}assert.equal(hash(JSON.stringify(group.inventory)),group.sha256,'Candidate inventory fingerprint mismatch')}
verify(candidate.source);verify(candidate.tests)
for(const build of candidate.builds){const path=join(root,build.directory,'precache-manifest.json');assert.equal(hash(readFileSync(path)),build.manifestSha256,`Build changed: ${build.directory}`);const manifest=JSON.parse(readFileSync(path));assert.equal(manifest.buildId,build.buildId);for(const entry of manifest.entries)assert.equal(hash(readFileSync(join(root,build.directory,entry.path))),entry.sha256,`Asset changed: ${entry.path}`);assert.equal(hash(readFileSync(join(root,build.directory,'sw.js'))),build.workerSha256,'Worker changed')}
console.log(`PASS : ${candidate.id} — sources/tests exacts, builds racine/sous-chemin et ressources précachées intacts. Aucune donnée IndexedDB ouverte.`)

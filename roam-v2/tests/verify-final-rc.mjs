import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { root,files,hash } from '../docs/physical-tests/prepare.mjs'
import { inputs } from '../docs/release/seal-final-rc.mjs'
const candidate=JSON.parse(readFileSync(join(root,'docs/v21-final-rc.json')))
assert.deepEqual(inputs(),candidate.source,'Sources/tests du candidat modifiés');assert.equal(hash(JSON.stringify(candidate.source)),candidate.sourceSha256)
for(const folder of [candidate.artifactDirectory,join(root,candidate.workspaceArtifact)]){const inventory=files(folder).map(path=>({path,sha256:hash(readFileSync(join(folder,path)))}));assert.deepEqual(inventory,candidate.artifact);assert.equal(hash(JSON.stringify(inventory)),candidate.artifactSha256)}
for(const archive of [candidate.archive,candidate.sourceArchive,candidate.rollbackArchive])assert.equal(hash(readFileSync(archive.path)),archive.sha256)
assert.equal(JSON.parse(readFileSync(join(candidate.artifactDirectory,'release-info.json'))).candidate,candidate.id)
console.log('PASS',candidate.id,'sources/tests, deux copies artefact, archives production/source/référence publique SHA-256 intacts ; aucune base ouverte')

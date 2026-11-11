import { readFileSync,writeFileSync,mkdirSync,cpSync,existsSync } from 'node:fs'
import { join,relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import { root,files,hash } from '../physical-tests/prepare.mjs'
export function inputs(){const config=JSON.parse(readFileSync(join(root,'docs/v21f1-candidate.json'))).source.files;return [...['src','public','pwa','tests'].flatMap(dir=>files(join(root,dir)).map(path=>dir+'/'+path)),...['docs/physical-tests','docs/release'].flatMap(dir=>files(join(root,dir)).filter(path=>/\.(?:mjs|ts|html|css)$/.test(path)).map(path=>dir+'/'+path)),...config].sort().map(path=>({path,sha256:hash(readFileSync(join(root,path)))}))}
if(process.argv.includes('--seal')){
 const branch=execFileSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8'}).trim();if(branch!=='develop-v2')throw Error('Branche inattendue')
 const source=inputs(),sourceSha256=hash(JSON.stringify(source)),id='Roam-V2.1-RC-'+sourceSha256.slice(0,12),directory=join(process.env.USERPROFILE,'Roam-release-candidates',id)
 if(existsSync(directory))throw Error('Candidat durable déjà présent : aucun remplacement')
 const site=join(root,'node_modules/.tmp/v21-final-rc/site'),baseCommit='65857661eba878a6636362cf061ceff1e2f1591e',head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()
 writeFileSync(join(site,'release-info.json'),JSON.stringify({version:'2.1',candidate:id,sourceSha256,baseCommit,gitAnchor:head,databaseVersion:6,zipFormat:2},null,2)+'\n');writeFileSync(join(site,'.nojekyll'),'')
 const artifact=files(site).map(path=>({path,sha256:hash(readFileSync(join(site,path)))}))
 if(artifact.some(entry=>/\.(zip|pdf|map)$/.test(entry.path)||entry.path.startsWith('test-')||entry.path.includes('node_modules')))throw Error('Fichier non public dans artefact')
 mkdirSync(directory,{recursive:true});cpSync(site,join(directory,'site'),{recursive:true});cpSync(join(root,'node_modules/.tmp/v21-final-rc/public-v2'),join(directory,'public-v2'),{recursive:true})
 for(const entry of source){const target=join(directory,'source',entry.path);mkdirSync(join(target,'..'),{recursive:true});cpSync(join(root,entry.path),target)}
 const ps=value=>"'"+value.replaceAll("'","''")+"'"
 function zip(folder,name){const output=join(directory,name);execFileSync('powershell.exe',['-NoProfile','-Command',`Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory(${ps(folder)},${ps(output)})`],{stdio:'inherit'});return {path:output,sha256:hash(readFileSync(output))}}
 const archive=zip(join(directory,'site'),id+'-site.zip'),sourceArchive=zip(join(directory,'source'),id+'-source.zip'),rollbackArchive=zip(join(directory,'public-v2'),'public-v2-reference.zip')
 writeFileSync(join(directory,'changes-vs-public.patch'),execFileSync('git',['diff','--binary',baseCommit,'--','roam-v2/'],{cwd:join(root,'..'),maxBuffer:20*1024*1024,stdio:['ignore','pipe','pipe']}))
 const status=execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:join(root,'..'),encoding:'utf8'});writeFileSync(join(directory,'git-status.txt'),status)
 const manifest={id,createdAt:new Date().toISOString(),branch,gitAnchor:head,baseCommit,uncommitted:true,sourceSha256,source,artifactSha256:hash(JSON.stringify(artifact)),artifact,artifactDirectory:join(directory,'site'),workspaceArtifact:relative(root,site).replaceAll('\\','/'),archive,sourceArchive,rollbackArchive,directory,databaseVersion:6,zipFormat:2,buildId:JSON.parse(readFileSync(join(site,'precache-manifest.json'))).buildId}
 writeFileSync(join(directory,'candidate.json'),JSON.stringify(manifest,null,2)+'\n');writeFileSync(join(root,'docs/v21-final-rc.json'),JSON.stringify(manifest,null,2)+'\n');console.log(id);console.log('Site ZIP SHA-256',archive.sha256);console.log('Durable',directory)
}

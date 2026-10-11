const fs=require('node:fs/promises');
const syncFs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {run,get}=require('./app-db');
const templates=require('../../frontend/js/monthly-designer/templates');
const engine=require('../../frontend/js/monthly-designer/document-engine');
const projectRoot=path.resolve(__dirname,'../..');
const templatePath=root=>path.join(root,'backend/builtin-templates/monthly-report.json');
async function ensureReady(){await run('CREATE TABLE IF NOT EXISTS monthly_default_template (id INTEGER PRIMARY KEY CHECK(id=1),payload_json TEXT NOT NULL,updated_at TEXT NOT NULL)');}
async function readBundled(root=projectRoot){
    try{return templates.normalize(JSON.parse(await fs.readFile(templatePath(root),'utf8')));}catch(error){if(error.code==='ENOENT')return templates.capture(engine.defaults());throw error;}
}
async function getDefault(){
    await ensureReady();const row=await get('SELECT * FROM monthly_default_template WHERE id=1');
    return row?{source:'tenant',template:templates.normalize(JSON.parse(row.payload_json)),updatedAt:row.updated_at}:{source:'bundled',template:await readBundled(),updatedAt:null};
}
async function saveDefault(input){
    let template;try{template=templates.normalize(input);}catch(error){error.status=400;throw error;}
    await ensureReady();const now=new Date().toISOString();
    await run('INSERT INTO monthly_default_template (id,payload_json,updated_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at',[JSON.stringify(template),now]);
    return {source:'tenant',template,updatedAt:now};
}
function canSyncRepository(root=projectRoot){
    if(process.platform!=='darwin'||root.includes('.asar'))return false;
    let directory=root;
    for(let level=0;level<4;level++){if(syncFs.existsSync(path.join(directory,'.git')))return true;const parent=path.dirname(directory);if(parent===directory)break;directory=parent;}
    return false;
}
function localRequest(req){
    const peer=req.socket?.remoteAddress,host=req.hostname;
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer)||!['localhost','127.0.0.1','[::1]','::1'].includes(host))return false;
    if(req.get('origin')){try{if(new URL(req.get('origin')).host!==req.get('host'))return false;}catch(_){return false;}}
    return true;
}
async function writeBundled(input,{root=projectRoot,loadLogo=id=>require('./import-source-repository').getLogo(id)}={}){
    const template=templates.normalize(input),logo=template.document.logo;
    const match=logo.match(/^\/api\/upload\/monthly-logos\/([\w-]+)\/image$/);
    const files=[];
    if(match){
        const stored=await loadLogo(match[1]);if(!stored?.image_blob){const error=new Error('Template logo is missing');error.status=400;throw error;}
        const digest=crypto.createHash('sha256').update(stored.image_blob).digest('hex');
        const relative='frontend/assets/monthly-template/'+digest+'.png',destination=path.join(root,relative);
        await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,stored.image_blob);
        template.document.logo='/assets/monthly-template/'+digest+'.png';files.push(relative);
    }else if(logo.startsWith('/assets/')){
        const asset=path.resolve(root,'frontend',logo.slice(1));
        if(!asset.startsWith(path.join(root,'frontend/assets')+path.sep))throw new Error('Invalid template logo path');
        await fs.access(asset);
        if(root===projectRoot)files.push(path.relative(root,asset));
    }else if(logo){const error=new Error('Choose a built-in or uploaded logo before syncing the template');error.status=400;throw error;}
    const destination=templatePath(root);await fs.mkdir(path.dirname(destination),{recursive:true});
    const temporary=destination+'.'+crypto.randomUUID()+'.tmp';
    try{await fs.writeFile(temporary,JSON.stringify(template,null,2)+'\n');await fs.rename(temporary,destination);}finally{await fs.rm(temporary,{force:true});}
    files.unshift('backend/builtin-templates/monthly-report.json');return {success:true,files};
}
async function syncRepository(req){
    if(!canSyncRepository()||!localRequest(req)){const error=new Error('Repository sync is only available on the local Mac development server');error.status=403;throw error;}
    return writeBundled((await getDefault()).template);
}
module.exports={getDefault,saveDefault,readBundled,canSyncRepository,localRequest,writeBundled,syncRepository};

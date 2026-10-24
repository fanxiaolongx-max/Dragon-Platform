const images = require('./ai-report-images');

async function list() {
    const legacy=await require('./import-source-repository').listLogos();
    const runtime=require('./platform-logo-runtime'),fs=require('node:fs');
    const platform=[['logo.png','平台标识（当前）'],['logo-raw.png','平台标识原图']]
        .filter(([name])=>fs.existsSync(runtime.resolveLogoAsset(name)))
        .map(([name,label])=>({id:`platform-${name}`,name:label,mime:'image/png',source:'platform-logo',prompt:'',url:`/assets/${name}`,createdAt:''}));
    return images.visible([...platform,...await images.list(legacy)]);
}
function page(items,number=1,size=8) {
    const pageSize=Math.max(1,Math.min(24,Math.trunc(Number(size))||8));
    const totalPages=Math.max(1,Math.ceil(items.length/pageSize));
    const current=Math.max(1,Math.min(totalPages,Math.trunc(Number(number))||1));
    return {items:items.slice((current-1)*pageSize,current*pageSize),page:current,pageSize,total:items.length,totalPages};
}
module.exports={list,page};

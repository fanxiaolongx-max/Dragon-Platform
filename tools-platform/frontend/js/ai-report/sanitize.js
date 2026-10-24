/* Recipe output is stored and shown as static HTML: no scripts, handlers, embeds or external resources. */
(function(){
    'use strict';
    const BLOCKED='script,iframe,frame,frameset,object,embed,link,meta,base,form,input,button,textarea,select,option,style,noscript,template,audio,video,source,track,portal,foreignObject';
    const URL_ATTRIBUTES=['href','src','xlink:href','action','formaction','srcset','poster','background','ping'];
    const safeUrl=(name,value)=>{const text=String(value||'').trim();return text.startsWith('#')||(name!=='href'&&/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(text));};
    // No scrolling inside report content: scroll containers become plain boxes and height caps go, so everything shows.
    const cleanStyle=value=>String(value||'').replace(/url\s*\(\s*(['"]?)(?!data:image\/)[^)]*\)/gi,'none').replace(/expression\s*\(|@import|behavior\s*:|-moz-binding/gi,'')
        .replace(/(overflow(?:-x|-y)?\s*:\s*)(auto|scroll|overlay)/gi,'$1visible').replace(/max-height\s*:[^;]*/gi,'max-height:none');
    function clean(html){
        const doc=new DOMParser().parseFromString(`<!doctype html><body>${String(html||'')}</body>`,'text/html');
        doc.body.querySelectorAll(BLOCKED).forEach(node=>node.remove());
        for(const element of doc.body.querySelectorAll('*')){
            for(const attribute of [...element.attributes]){
                const name=attribute.name.toLowerCase();
                if(name.startsWith('on')||name==='contenteditable'||name==='id'&&/^(air|navbar)/i.test(attribute.value))element.removeAttribute(attribute.name);
                else if(URL_ATTRIBUTES.includes(name)&&!safeUrl(name,attribute.value))element.removeAttribute(attribute.name);
                else if(name==='style')element.setAttribute('style',cleanStyle(attribute.value));
            }
        }
        return doc.body.innerHTML;
    }
    window.AiReportSanitize={clean};
})();

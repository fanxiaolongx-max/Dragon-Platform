const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../backend/builtin-tools/network_safety_meeting_summary');
async function moduleFrom(file) {
    const source = fs.readFileSync(path.join(root, 'js', file), 'utf8')
        .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.join(root, 'js', file)).href));
    return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('vision retains independent, editable labels and all frozen image assets without signed URLs', async () => {
    const { createVisionSlide, visionElements } = await moduleFrom('vision-template.js');
    const data = createVisionSlide('test-content');
    assert.equal(data.layout, 'custom');
    const text = visionElements.filter(el => el.kind === 'text');
    for (const label of ['风险与整改','响应与恢复','收入与利润','能力与履职','机关','地区部','监督指导']) {
        assert.ok(text.some(el => el.text === label), label);
    }
    assert.equal((data.html.match(/data-vision-kind="text"/g) || []).length, text.length);
    assert.equal((data.html.match(/contenteditable="true"/g) || []).length, text.length);
    assert.doesNotMatch(data.html, /csig=|token=|media\.canva|data:image/);
    for (const el of visionElements) {
        assert.ok(el.left >= 0 && el.top >= 0 && el.width > 0 && el.height > 0);
        assert.ok(el.left + el.width <= 1672.1 && el.top + el.height <= 941.1, el.name);
        if (el.kind === 'image') {
            const bytes = fs.readFileSync(path.join(root,'assets/vision',el.asset));
            assert.equal(bytes.subarray(1,4).toString(), 'PNG', el.name);
            assert.ok(bytes.readUInt32BE(16) >= el.width * 1920 / 1672, `${el.name} must not use a thumbnail`);
            assert.ok(bytes.readUInt32BE(20) >= el.height * 1080 / 941, `${el.name} must have sufficient vertical resolution`);
        }
    }
});

test('new project and new content page use vision while saved projects keep their stored deck', () => {
    const app = fs.readFileSync(path.join(root,'js/app.js'),'utf8');
    const defaults = fs.readFileSync(path.join(root,'js/default-slides.js'),'utf8');
    assert.match(defaults, /export const defaultSlides = \[createVisionSlide\(\)\]/);
    assert.match(app, /if \(savedHtml\) \{\s*deck.innerHTML = savedHtml/);
    assert.match(app, /getNewProjectDeckHtml: createDefaultProjectDeckHtml/);
    const handler = app.slice(app.indexOf("document.getElementById('addBlankBtn').addEventListener"));
    assert.ok(handler.includes('deck.appendChild(renderSlide(createVisionSlide()));'));
});

test('new and saved vision pictures bypass old caches without changing user replacements', async () => {
    const {createVisionSlide, refreshVisionAssetUrls, VISION_ASSET_VERSION} = await moduleFrom('vision-template.js');
    const assetPath = path.join(root, 'assets/vision/MAHXOLuwbZY.png');
    const encodedAssetPath = pathToFileURL(assetPath).pathname;
    const picture = src => ({src, getAttribute: function() {return this.src;}, setAttribute: function(key,value) {this.src=value;}});
    const old = picture(assetPath);
    const previousVersion = picture(`${assetPath}?v=old&custom=keep#position`);
    const current = picture(`${assetPath}?v=${VISION_ASSET_VERSION}`);
    const uploaded = picture('/api/slide-design/assets/user-picture.png');
    const external = picture('https://example.com'+assetPath);
    const inline = picture('data:image/png;base64,AAAA');
    const pictures = [old, previousVersion, current, uploaded, external, inline];
    assert.equal(refreshVisionAssetUrls({querySelectorAll:()=>pictures}),2);
    assert.equal(old.src, `${encodedAssetPath}?v=${VISION_ASSET_VERSION}`);
    assert.equal(previousVersion.src, `${encodedAssetPath}?v=${VISION_ASSET_VERSION}&custom=keep#position`);
    assert.equal(uploaded.src,'/api/slide-design/assets/user-picture.png');
    assert.equal(external.src,'https://example.com'+assetPath);
    assert.equal(inline.src,'data:image/png;base64,AAAA');
    assert.equal(refreshVisionAssetUrls({querySelectorAll:()=>pictures}),0);
    assert.equal((createVisionSlide().html.match(new RegExp(`\\?v=${VISION_ASSET_VERSION}`,'g'))||[]).length,41);
});

test('native export skips hidden parent groups and preserves literal text, style and position', async () => {
    const { addVisionObjects, visibleForExport, rgbHex } = await moduleFrom('vision-pptx.js');
    const style = {opacity:'1',visibility:'visible',display:'block',zIndex:'100',fontFamily:'"PingFang SC", Arial',fontSize:'24px',fontWeight:'700',fontStyle:'normal',textAlign:'center',lineHeight:'28.8px',color:'rgb(48, 72, 91)'};
    const rootNode = { getBoundingClientRect: () => ({left:0,top:0,width:1920,height:1080}) };
    const group = {parentElement:rootNode,dataset:{},style:{},matches:()=>false};
    const node = {parentElement:group,dataset:{},style:{},classList:{contains:()=>false},querySelector:()=>null,
        closest:()=>null,matches:()=>true,isSameNode:other=>other===node,
        innerText:'风险与整改\n=1+2',offsetWidth:240,offsetHeight:96,
        getBoundingClientRect:()=>({left:192,top:108,width:240,height:96})};
    rootNode.querySelectorAll=()=>[node];
    const previous = global.getComputedStyle;
    global.getComputedStyle = () => style;
    try {
        const calls=[];
        await addVisionObjects({addText:(text,options)=>calls.push({text,options})},rootNode,()=>assert.fail('Text must not be rasterized'));
        assert.equal(calls.length,1);
        assert.equal(calls[0].text,'风险与整改\n=1+2');
        assert.equal(calls[0].options.x,1);
        assert.equal(calls[0].options.y,0.5625);
        assert.equal(calls[0].options.fontSize,9);
        assert.equal(calls[0].options.color,'30485b');
        assert.equal(calls[0].options.bold,true);
        group.dataset.pptHidden='true';
        assert.equal(visibleForExport(node,rootNode),false);
        calls.length=0;
        await addVisionObjects({addText:(text,options)=>calls.push({text,options})},rootNode,()=>assert.fail());
        assert.equal(calls.length,0);
        assert.equal(rgbHex('#C7000B'),'C7000B');
    } finally { global.getComputedStyle=previous; }
});

test('ppt copilot text transformations use dedicated in-place transform instead of regenerating large DOMs', () => {
    const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
    const aiRoute = fs.readFileSync(path.resolve(__dirname, '../backend/routes/ai.js'), 'utf8');

    assert.match(aiRoute, /router\.post\('\/ppt-transform-text'/, 'ai.js must define POST /ppt-transform-text');
    assert.match(aiRoute, /result\.finishReason === 'MAX_TOKENS'/, 'ai.js must detect MAX_TOKENS truncation on ppt-copilot');
    assert.match(app, /transformSlideTexts\('translate_en'/, 'app.js must route translate_en to transformSlideTexts');
    assert.match(app, /transformSlideTexts\('translate_zh'/, 'app.js must route translate_zh to transformSlideTexts');
    assert.match(app, /transformSlideTexts\('polish'/, 'app.js must route polish to transformSlideTexts');
    assert.match(app, /!activeWrap\.querySelector\('\.vision-template'\)/, 'app.js must not inject vision-template into AI reference templates');
});

const test=require('node:test'),assert=require('node:assert/strict');
const {injectPlatformTheme,toolThemeForPath}=require('../backend/models/asset-versioning');
test('ordinary tool pages are light and only native dark designs are dark',()=>{
 for(const p of ['pages/requirements.html','pages/sla.html','pages/ai-report.html','custom-tools/picture-island','custom-tools/datacom-protocol-expert','custom-tools/unknown'])assert.equal(toolThemeForPath(p),'light');
 for(const p of ['pages/bigscreen.html','pages/project-evolution.html','custom-tools/particle-effects','custom-tools/particle-effects/frame.html','custom-tools/tool-msh8aro4'])assert.equal(toolThemeForPath(p),'dark');
 assert.equal(toolThemeForPath('custom-tools/particle-effects-copy'),'light');
});
test('explicit native tool metadata overrides the default without affecting another tool',()=>{
 assert.equal(toolThemeForPath('custom-tools/new','<meta name="tools-tool-theme" content="dark">'),'dark');
 assert.equal(toolThemeForPath('custom-tools/new',"<meta content = 'DARK' name = 'tools-tool-theme'>"),'dark');
 assert.equal(toolThemeForPath('pages/bigscreen.html','<meta name="tools-tool-theme" content="light">'),'light');
 assert.equal(toolThemeForPath('custom-tools/new','<meta name="tools-tool-theme" content="auto">'),'light');
});
test('injection comes before tool initialization, deduplicates itself and retains unrelated scripts',()=>{
 const src='<html><head><script>window.init=1</script><script src="/js/shared/platform-theme.js?v=old"></script></head><body></body></html>';
 const once=injectPlatformTheme(src,{toolPath:'pages/bigscreen.html'}),twice=injectPlatformTheme(once,{toolPath:'pages/bigscreen.html'});
 assert.equal(twice,once);assert.equal((once.match(/platform-theme\.js/g)||[]).length,1);
 assert.ok(once.indexOf('data-tool-theme="dark"')<once.indexOf('window.init=1'));
 assert.match(injectPlatformTheme(src),/data-tool-theme="light"/);
});

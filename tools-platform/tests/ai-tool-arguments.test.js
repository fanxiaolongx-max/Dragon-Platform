const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseToolArgs,requireToolArgs}=require('../backend/models/ai-tool-arguments');

test('strict JSON wrappers decode without changing file bytes or Windows/macOS paths',()=>{
 for(const filename of ['docs/中文 result.html','C:\\Users\\Admin\\Desktop\\result.html','C:/项目/result.html','\\\\server\\share\\项目\\result.html','/Users/dragon/项目/result.html']){
  const fields={path:filename,content:'<html>"quoted"\nC:\\temp\\x\t</html>'};
  for(const input of [fields,JSON.stringify(fields),JSON.stringify(JSON.stringify(fields)),{__raw:JSON.stringify(fields)},{_raw:JSON.stringify(fields)},'```json\n'+JSON.stringify(fields)+'\n```'])assert.deepEqual(requireToolArgs(input),fields);
 }
 assert.deepEqual(parseToolArgs(''),{});assert.deepEqual(parseToolArgs(null),{});
});

test('malformed, ambiguous, truncated and non-object arguments fail without guessing or leaking contents',()=>{
 for(const input of ['{"path":"C:\\Users\\x.html","content":"PRIVATE-PAYLOAD"}', '{"path":"x","content":"unfinished', '[{"path":"x"}]', 'null','true',{__raw:'bad',path:'x',content:'PRIVATE-PAYLOAD'},{_raw:'bad'},{__raw:{__raw:{__raw:{__raw:{__raw:{__raw:{path:'x'}}}}}}}]){
  assert.ok(Object.hasOwn(parseToolArgs(input),'__raw'));
  assert.throws(()=>requireToolArgs(input),e=>e.code==='AGENT_TOOL_ARGS_PARSE'&&!e.message.includes('PRIVATE-PAYLOAD')&&e.message.includes('未执行'));
 }
});

function guardFor(platform,pathApi,realpath=p=>p){
 const file=path.join(__dirname,'../backend/models/agent-path-guard.js');const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,process:{platform},Buffer,require:n=>n==='path'?pathApi:n==='fs'?{existsSync:()=>true,realpathSync:realpath}:require(n)},{filename:file});
 return module.exports;
}

test('Windows path guard handles drives, slashes, case, UNC and Chinese paths without weakening containment',()=>{
 const g=guardFor('win32',path.win32),root='C:\\Users\\Alice\\项目';
 for(const relative of ['docs/result.html','docs\\result.html'])assert.equal(g.resolveInsideRoot(root,relative),root+'\\docs\\result.html');
 assert.equal(g.resolveInsideRoot(root,'c:/users/alice/项目/result.html'),'c:\\users\\alice\\项目\\result.html');
 const unc='\\\\server\\share\\项目';assert.equal(g.resolveInsideRoot(unc,'out/report.html'),unc+'\\out\\report.html');
 for(const bad of ['C:result.html','D:/other/result.html','../outside.html','\\\\other\\share\\result.html'])assert.throws(()=>g.resolveInsideRoot(root,bad));
 assert.throws(()=>guardFor('win32',path.win32,()=> 'D:\\outside').resolveInsideRoot(root,'link/result.html'),/链接/);
});

test('macOS keeps POSIX paths and rejects foreign absolute paths and JSON escape control characters',()=>{
 const g=guardFor('darwin',path.posix),root='/Users/dragon/项目';
 assert.equal(g.resolveInsideRoot(root,'docs/result.html'),root+'/docs/result.html');
 assert.equal(g.resolveInsideRoot(root,root+'/result.html'),root+'/result.html');
 assert.equal(g.resolveInsideRoot(root,'literal\\name.txt'),root+'/literal\\name.txt','valid Unix backslash filenames are not rewritten');
 for(const bad of ['C:\\Users\\x.txt','C:/Users/x.txt','C:x.txt','\\\\server\\share\\x.txt','../outside.txt','docs/\tbad.txt',42])assert.throws(()=>g.resolveInsideRoot(root,bad));
 const win=guardFor('win32',path.win32);
 assert.throws(()=>win.resolveInsideRoot('C:\\temp',JSON.parse('"C:\\temp\\new.txt"')),/非法字符/,'JSON-valid but wrongly escaped Windows paths contain control characters');
});

'use strict';
// Configure ONLY local timing exports; never replace an existing telemetry target.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
async function write(file,text){const stat=await fs.stat(file);const temporary=file+'.dragon-timing.tmp';await fs.writeFile(temporary,text,{mode:stat.mode&0o777});await fs.rename(temporary,file);}
async function configure({home=os.homedir(),port=4319}={}){
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid collector port');
 const endpoint=`http://127.0.0.1:${port}`,results=[];
 for(const [agent,folder]of [['claudecode','.claude'],['workbuddy','.workbuddy']]){
  const file=path.join(home,folder,'settings.json');let data;
  try{data=JSON.parse(await fs.readFile(file,'utf8'));}catch{results.push({agent,changed:false,reason:'settings-not-found'});continue;}
  const env=data.env||{};
  if(Object.keys(env).some(k=>/OTEL_(?:EXPORTER|TRACES|METRICS|LOGS)/.test(k))){results.push({agent,changed:false,reason:env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT===endpoint+'/v1/traces'?'already-configured':'existing-telemetry-preserved'});continue;}
  const extra={OTEL_TRACES_EXPORTER:'otlp',OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:endpoint+'/v1/traces',OTEL_EXPORTER_OTLP_TRACES_PROTOCOL:agent==='claudecode'?'http/json':'http/protobuf',OTEL_LOG_USER_PROMPTS:'0',OTEL_LOG_ASSISTANT_RESPONSES:'0',OTEL_LOG_TOOL_DETAILS:'0',OTEL_LOG_TOOL_CONTENT:'0',OTEL_LOG_RAW_API_BODIES:'0'};
  if(agent==='claudecode')Object.assign(extra,{CLAUDE_CODE_ENABLE_TELEMETRY:'1',CLAUDE_CODE_ENHANCED_TELEMETRY_BETA:'1',OTEL_METRICS_EXPORTER:'none',OTEL_LOGS_EXPORTER:'none'});
  else extra.CODEBUDDY_CODE_ENABLE_TELEMETRY='1';
  data.env={...env,...extra};await write(file,JSON.stringify(data,null,2)+'\n');results.push({agent,changed:true,reason:'applies-to-new-agent-processes'});
 }
 const file=path.join(home,'.codex/config.toml');let text;
 try{text=await fs.readFile(file,'utf8');}catch{results.push({agent:'codex',changed:false,reason:'settings-not-found'});return results;}
 if(/^\s*\[otel(?:\.|\])/m.test(text)||/^\s*otel\s*[.=]/m.test(text)){results.push({agent:'codex',changed:false,reason:text.includes('# Dragon Platform local timing collector')?'already-configured':'existing-telemetry-preserved'});return results;}
 text+=`\n# Dragon Platform local timing collector\n[otel]\nenvironment = "dragon-platform-local"\nlog_user_prompt = false\nlog_agent_responses = false\nlog_guardian_assessments = false\nexporter = { otlp-http = { endpoint = "${endpoint}/v1/logs", protocol = "json" } }\ntrace_exporter = { otlp-http = { endpoint = "${endpoint}/v1/traces", protocol = "json" } }\n[otel.tool_result]\nmax_bytes = 0\n`;
 await write(file,text);results.push({agent:'codex',changed:true,reason:'applies-to-new-agent-processes'});return results;
}
if(require.main===module)(async()=>{const port=Number(process.env.TOOLS_DESKTOP_TELEMETRY_PORT)||4319;const response=await fetch(`http://127.0.0.1:${port}/v1/traces`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(2000)});if(!response.ok||response.headers.get('X-Dragon-Timing-Collector')!=='1')throw Error('collector unavailable');return configure({home:process.env.TOOLS_DESKTOP_AGENT_HOME||os.homedir(),port});})().then(x=>console.log(JSON.stringify(x))).catch(()=>{console.error('Local timing configuration failed: start the Dragon timing collector first');process.exitCode=1;});
module.exports={configure};

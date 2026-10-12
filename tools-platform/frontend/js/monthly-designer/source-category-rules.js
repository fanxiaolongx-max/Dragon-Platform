(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MonthlySourceCategories=api;})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 const categories=['tickets','metrics','raw','topic','meeting'];
 function identity(file){
  const kind=['original','structured'].includes(file.kind||'original')?'table':file.kind;
  const name=kind==='table'?file.name:file.source_key||file.name;
  const series=String(name||'').replace(/\.(csv|xlsx|xls)$/i,'').replace(/\s*\(\d+\)$/,'').replace(/^PBI_自动抓取[\s_-]*/i,'').replace(/(^|[\s_-])latest(?=$|[\s_-])/gi,'$1').replace(/20\d{2}年\d{1,2}月/g,'').replace(/(^|[\s_-])20\d{2}[-_]\d{1,2}(?:[-_]\d{1,2})?(?=$|[\s_-])/g,'$1').replace(/(^|[\s_-])(?:0?[1-9]|1[0-2])月(?=$|[\s_-])/g,'$1').replace(/[\s_-]+/g,'_').replace(/^_+|_+$/g,'').toLowerCase();
  return {key:JSON.stringify([kind,series]),series};
 }
 function builtin(file){const {series}=identity(file);return ['original','structured'].includes(file.kind||'original')&&['红线人员工单统计_维护红线资源','红线人员工单统计'].includes(series)?'metrics':null;}
 function automatic(file){
  if(builtin(file))return builtin(file);
  if(file.kind==='topic_monthly')return 'topic';if(file.kind==='meeting_attendance')return 'meeting';if(file.kind==='duty_roster'||file.source_key==='夜间运维值班表')return 'metrics';
  const text=String(file.name||'')+' '+(file.metricLabels||[]).join(' ');
  if(!text.includes('值班')&&/(整改详单|风险详单|巡检详单|详单|详表|工单|临期|超期|逾期|待办|清单|ticket|expir)/i.test(text))return 'tickets';
  return file.metricLabels?.length?'metrics':'raw';
 }
 const category=file=>categories.includes(file.library_category)?file.library_category:automatic(file);
 return {categories,identity,builtin,automatic,category};
});

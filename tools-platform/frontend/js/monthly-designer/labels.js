/* Display-only terminology. Source identities and user-defined translations stay intact. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MonthlyLabels=api;})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 const terms={
  '埃及代表处交付与服务维护月报':'Egypt Representative Office Monthly Delivery & Maintenance Report',
  '报告时间':'Report date','整体情况':'Overview','网络变更':'Network changes','SR与事件':'SR & incidents','风险治理':'Risk management','License管理':'License management','EOS退网收编':'EOS retirement & consolidation','第三方软件':'Third-party software','内控与稽查':'Internal controls & audits','网络安全例会':'Network security meetings',
  '整改':'Remediation','TOPN 风险':'TOPN risks','专项风险':'Special risks','风险':'Risks','高危命令拦截':'High-risk command interception','高危命令拦截次数':'High-risk command interception count','GUI拦截次数':'GUI interception count','夜间运维值班表':'Night maintenance duty roster','值班人次':'Duty assignments','临期详单':'Expiring ticket details','地区部':'Regional office','代表处':'Representative office','首次_拦截次数2024年':'Initial interception count (2024)','会议考勤':'Meeting attendance','专题分析':'Topic analysis','漏洞':'Vulnerabilities','巡检':'Inspections','逃生演练':'Escape drills','iLab 应急演练':'iLab emergency drills','拓扑':'Topology','预案':'Contingency plans','事故':'Incidents','软件MM':'Software MM','维护红线岗':'Critical maintenance positions','任职/任命不满足人数':'Unqualified or unappointed personnel','高风险人员':'High-risk personnel','超高风险人员':'Very high-risk personnel',
  '客户':'Customer','客户名称':'Customer name','客户名':'Customer name','网络':'Network','类别':'Category','金额':'Amount','日期':'Date','来源':'Source','月份':'Month','本月':'This month','上月':'Previous month','去年同月':'Same month last year','今年':'This year','去年':'Last year','总计':'Total','【总计】':'Total','[总计]':'Total','合计':'Total','求和':'Sum','计数':'Count','平均值':'Average','最小值':'Minimum','最大值':'Maximum','记录数':'Record count','整改完成率':'Remediation completion rate','总完成率':'Overall completion rate',
  '现场签到':'On-site check-in','在线参会':'Online attendance','临期详单':'Expiring ticket details','指标与关键数据表':'Metrics & key data','原始表':'Source table','工作表':'Worksheet','星期':'Day of week','时间段':'Period','部门':'Department','报告编号':'Report number','审核人':'Reviewer','报告目标':'Report objectives','数据月份':'Data month','密级':'Classification','内部公开':'Internal'
 };
 const obsolete={
  '埃及代表处交付与服务维护月报':['Network protection & cyber security monthly report'],
  '报告时间':['Reporting period'], 'License管理':['Risk governance'],
  '整体情况':['Overall situation'],'SR与事件':['SR, major issues & recovery'],'EOS退网收编':['EOS retirement'],'第三方软件':['Third-party software inventory'],'内控与稽查':['Internal controls, PR checks & audits'],'网络安全例会':['Security meetings & action tracking']
 };
 function translate(value,mapping={}){const text=String(value??''),key=text.trim();if(mapping[key])return mapping[key];if(terms[key])return terms[key];return text.split(/(\s+\/\s+|、| · )/).map(part=>mapping[part.trim()]||terms[part.trim()]||part).join('');}
 function pair(value,language,mapping={}){if(language!=='en')return value?.zh||'';const zh=value?.zh||'',en=value?.en||'';return obsolete[zh]?.includes(en)?terms[zh]:en||translate(zh,mapping);}
 return {translate,pair,terms};
});

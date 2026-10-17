/* NetCare extraction settings: the one schema shared by the page, the settings relay, the background and backups.
 * The relay stores netcareNormalizeSettings output, so a field normalized here is persisted without further edits. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.createNetcareSettings=factory;})(typeof globalThis!=='undefined'?globalThis:this,function createNetcareSettings(){
// strict: text and attachments are audited in full; standard (default) and lenient audit section text only.
const NETCARE_AUDIT_LEVELS=['strict','standard','lenient'];
// Optional boolean preferences; each must also get its default in netcareNormalizeSettings.
const NETCARE_FLAG_SETTINGS=['closeAfterAudit','titleFallbackEnabled','pipBetaEnabled','autoSelectSanitizedPlan','disableLocalRules','embedScreenshotsInExcel'];
const NETCARE_ATTACHMENT_AUDIT_TYPES=['txt','word','excel','msg'];
function netcareDefaultLocalRules() {
  return [
    { id: 'rule-1.1', name: '1.1 变更目的与背景检查 / Change Purpose Check', sectionNumber: '1.1', sectionTitle: 'Change Purpose', kind: 'text', pattern: '(?:变更目的|变更原因|影响范围|Purpose|Objective|Scope)', passCondition: 'match', passSummary: '变更目的已明确 / Change purpose specified', failSummary: '缺少变更目的或影响范围说明 / Missing change purpose or scope', enabled: true },
    { id: 'rule-1.2', name: '1.2 方案与计划检查 / Change Plan Check', sectionNumber: '1.2', sectionTitle: 'Basic Information and Change Plan', kind: 'text', pattern: '(?:拓扑|Topology|计划|Batch|外设|Peripheral|窗口|Window)', passCondition: 'match', passSummary: '变更计划与环境信息完整 / Change plan complete', failSummary: '缺少变更计划或拓扑外设说明 / Missing change plan or topology', enabled: true },
    { id: 'rule-3.2', name: '3.2 准备工作与Checklist检查 / Preparation & Checklist', sectionNumber: '3.2', sectionTitle: 'Preparation for Change Implementation', kind: 'all', pattern: '(?:Checklist|检查项|准备工作|健康检查|Health Check|Pre-check|环境确认)', passCondition: 'match', passSummary: '准备工作与Checklist齐全 / Preparation and checklist complete', failSummary: '缺少实施前准备或Checklist检查项 / Missing preparation or checklist', enabled: true },
    { id: 'rule-3.3', name: '3.3 实施操作步骤检查 / Operation Steps Check', sectionNumber: '3.3', sectionTitle: 'Operation Steps for Change', kind: 'text', pattern: '(?:操作步骤|Step|命令|Command|配置|Configuration|执行脚本|脚本)', passCondition: 'match', passSummary: '包含明确操作步骤与命令 / Contains operation steps and commands', failSummary: '缺少具体操作步骤或执行命令 / Missing operation steps or commands', enabled: true },
    { id: 'rule-3.4', name: '3.4 测试验证与KPI检查 / Test & Verification Check', sectionNumber: '3.4', sectionTitle: 'Test and Verification', kind: 'text', pattern: '(?:测试|验证|KPI|Verification|Test|指标|业务恢复)', passCondition: 'match', passSummary: '包含测试验证方案或KPI指标 / Contains test verification or KPI', failSummary: '缺少测试验证步骤或业务指标 / Missing test steps or KPIs', enabled: true },
    { id: 'rule-3.5', name: '3.5 失败回退方案检查 / Changeback Solution Check', sectionNumber: '3.5', sectionTitle: 'Solution for Changeback In the Case of Failure', kind: 'text', pattern: '(?:回退|Changeback|Rollback|应急预案|失败判定|恢复原状)', passCondition: 'match', passSummary: '包含回退方案与应急步骤 / Contains rollback plan and steps', failSummary: '缺少回退步骤或应急预案 / Missing rollback steps', enabled: true }
  ];
}
const NETCARE_SECTION_TEMPLATE = [["1", "Description of Change and Change Influence"], ["1.1", "Change Purpose"], ["1.2", "Basic Information and Change Plan"], ["1.2.1", "Network Topology"], ["1.2.2", "Change Batches"], ["1.2.3", "Peripherals"], ["1.3", "Change Influence"], ["1.4", "Severity Information"], ["2", "Preparations for Change"], ["2.1", "Composition of Change Team and Responsibility of Team Members"], ["2.1.1", "Change Team of Orange Company"], ["2.1.2", "Huawei On-site Change Team"], ["2.1.3", "Huawei Support & Guarantee Team"], ["2.2", "Remote Access"], ["2.3", "Tool and Software Preparation"], ["2.4", "Check of Equipment Running"], ["2.5", "Change Risks and Countermeasures"], ["2.6", "Confirm Work Before Change"], ["3", "Operation Steps for Change"], ["3.1", "Overall Description of Change Steps"], ["3.2", "Preparation for Change Implementation"], ["3.3", "Operation Steps for Change"], ["3.3.1", "Operation Scripts"], ["3.4", "Test and Verification"], ["3.5", "Solution for Changeback In the Case of Failure"], ["3.5.1", "Definition of Change Failure"], ["3.5.2", "Overall Description of Changeback"], ["3.5.3", "Changeback Steps"], ["3.5.4", "Tests After Changeback"], ["3.5.5", "Changeback Risk Analysis"], ["3.6", "Change of Spare Parts and Emergency Workstation"], ["4", "Work After Change"], ["4.1", "Observation"], ["4.2", "Other work"]];
function netcareDefaultSettings() {
  return { autoSelectSanitizedPlan: true, aiAuditEnabled: true, disableLocalRules: true, concurrency: 3, openOnline: true, closeAfterAudit: true, titleFallbackEnabled: false, pipBetaEnabled: true, auditLevel: 'standard', panelCloseAction: 'ask', attachmentsEnabled: true, textEnabled: true, screenshotsEnabled: true, embedScreenshotsInExcel: false, intervalMs: 1500,
    attachmentAuditTypes: [...NETCARE_ATTACHMENT_AUDIT_TYPES],
    sections: netcareBuiltinRuleSets().standard.sections,
    localRules: netcareDefaultLocalRules() };
}
function netcareAuditLevel(settings){return NETCARE_AUDIT_LEVELS.includes(settings?.auditLevel)?settings.auditLevel:'standard';}
function netcareAttachmentAuditOn(settings){return netcareAuditLevel(settings)==='strict';}
// Built-in rule sets are defined here only: backups and imports never store or change them, and updates refresh them.
function netcareBuiltinRuleSets() {
  const prompts = {
    strict: {
      '3.3': { text: '操作步骤和数据是否清晰详细，增删改操作前后是否有查询确认步骤以确保变更预期正确（若正文步骤不清晰但提及操作步骤在附件中，可判断为通过）。', attachments: '操作步骤和数据是否清晰详细（含具体网元、命令及参数），增删改操作前后是否有查询确认步骤以确保变更预期正确。无具体细节则不通过。' },
      '3.4': { text: '验证方案和数据是否清晰详细，是否包含具体的指标 KPI 及正常判断标准（若正文未写明细但提到具体指标 KPI 在附件中，可判断为通过）。', attachments: '验证方案和数据是否清晰详细，是否包含具体的指标 KPI 名称、监控方法及明确的通过标准/阈值（拒绝仅写“检查业务正常”等模糊描述）。' },
      '3.5': { text: '回退方案和数据是否清晰详细，是否有具体的逆向回退操作步骤及回退后确认步骤（若正文简略但提及详细回退步骤在附件中，可判断为通过）。', attachments: '回退方案和数据是否清晰详细，是否包含具体的逆向操作命令/参数或明确的备份恢复步骤，以及回退后的状态与业务验证步骤。' }
    },
    standard: {
      '3.3': { text: '操作步骤是否清晰可执行：应说明涉及的网元和主要操作步骤，并在增删改操作前后安排查询确认。正文注明详细步骤、脚本或命令见附件且本节有附件时判定通过；本节无附件且正文缺少可执行步骤或前后确认时不通过。' },
      '3.4': { text: '验证方案是否明确：应说明验证项目、关键 KPI 或业务指标及判断正常的标准。正文注明具体指标或验证清单见附件且本节有附件时判定通过；本节无附件且正文只有“业务正常”等笼统描述时不通过。' },
      '3.5': { text: '回退方案是否明确：应包含失败判定条件、回退步骤和回退后的确认。正文注明回退脚本或步骤见附件且本节或子章节有附件时判定通过；无附件且正文缺少回退步骤时不通过。' }
    },
    lenient: {
      '3.3': { text: '本节是否填写了与本次变更相关的操作步骤或操作说明（可引用附件）。仅当为空、占位符或与本次变更无关时不通过。' },
      '3.4': { text: '本节是否填写了变更后的测试或验证内容（可引用附件）。仅当为空、占位符或与本次变更无关时不通过。' },
      '3.5': { text: '本节是否填写了失败回退的方案或说明（可引用附件）。仅当为空、占位符或与本次变更无关时不通过。' }
    }
  };
  const names = { strict: '严格 / Strict', standard: '中等 / Standard', lenient: '宽松 / Lenient' };
  return Object.fromEntries(NETCARE_AUDIT_LEVELS.map(level => [level, { id: 'builtin:' + level, name: names[level], level, builtin: true,
    sections: NETCARE_SECTION_TEMPLATE.map(([number, title]) => { const p = prompts[level][number]; return { number, title, attachments: !!p, text: !!p, attachmentsPrompt: p?.attachments || '', textPrompt: p?.text || '' }; }) }]));
}
function netcareNormalizeSections(rows) {
  if (!Array.isArray(rows) || rows.length > 100) throw new Error('章节模板最多 100 项 / Maximum 100 sections');
  const seen = new Set();
  return rows.map(row => {
    const number = String(row.number || '').trim(), title = String(row.title || '').trim();
    if (!/^\d+(\.\d+)*$/.test(number) || number.length > 40 || !title || title.length > 200 || seen.has(number)) throw new Error('章节序号须为数字点号且不能重复，名称不能为空 / Invalid or duplicate section');
    const attachmentsPrompt = netcareRedactText(String(row.attachmentsPrompt || '').trim()), textPrompt = netcareRedactText(String(row.textPrompt || '').trim());
    if (attachmentsPrompt.length > 4000 || textPrompt.length > 4000) throw new Error('单条提示词最多4000字符');
    seen.add(number); return { number, title, attachments: row.attachments === true || !!attachmentsPrompt, text: row.text === true || !!textPrompt, attachmentsPrompt, textPrompt };
  });
}
// Resolve the active rule set into effective sections and level. Settings saved before rule sets existed
// map to built-in Standard when their sections were never edited; edited sections become a custom set.
function netcareResolveRuleSets(value) {
  const builtins = netcareBuiltinRuleSets(), ids = new Set();
  const ruleSets = (Array.isArray(value.ruleSets) ? value.ruleSets : []).slice(0, 20).map(set => {
    const id = String(set?.id || '');
    if (!/^custom-[a-z0-9-]{4,40}$/.test(id) || ids.has(id)) throw new Error('自定义规则集无效 / Invalid custom rule set');
    ids.add(id);
    return { id, name: netcareRedactText(String(set.name || '').trim()).slice(0, 60) || '自定义规则 / Custom rules', level: NETCARE_AUDIT_LEVELS.includes(set.level) ? set.level : 'standard', sections: netcareNormalizeSections(set.sections) };
  });
  let active = String(value.activeRuleSet || '');
  if (!active || !(builtins[active.replace(/^builtin:/, '')] && active.startsWith('builtin:') || ids.has(active))) {
    const legacy = netcareNormalizeSections(value.sections), level = netcareAuditLevel(value);
    if (Object.values(builtins).some(set => JSON.stringify(set.sections) === JSON.stringify(legacy))) active = 'builtin:' + level;
    else if (ids.has('custom-migrated')) active = 'custom-migrated';
    else { ruleSets.push({ id: 'custom-migrated', name: '原章节规则 / Previous rules', level, sections: legacy }); active = 'custom-migrated'; }
  }
  const set = active.startsWith('builtin:') ? builtins[active.slice(8)] : ruleSets.find(item => item.id === active);
  return { ruleSets, activeRuleSet: active, auditLevel: set.level, sections: set.builtin ? netcareNormalizeSections(set.sections) : set.sections };
}
function netcareNormalizeSettings(value) {
  if (!value || !Array.isArray(value.sections) || value.sections.length > 100) throw new Error('章节模板最多 100 项 / Maximum 100 sections');
  if (value.ruleSets != null && (!Array.isArray(value.ruleSets) || value.ruleSets.length > 20)) throw new Error('自定义规则集最多 20 个 / Maximum 20 custom rule sets');
  if (value.concurrency != null && (!Number.isInteger(value.concurrency) || value.concurrency < 1 || value.concurrency > 10) || value.openOnline != null && typeof value.openOnline !== 'boolean' || value.screenshotsEnabled != null && typeof value.screenshotsEnabled !== 'boolean') throw new Error('下载全局设置无效 / Invalid preferences');
  if (NETCARE_FLAG_SETTINGS.some(k=>value[k]!=null&&typeof value[k]!=='boolean') || value.auditLevel != null && !NETCARE_AUDIT_LEVELS.includes(value.auditLevel) || value.panelCloseAction != null && !['ask', 'minimize', 'close'].includes(value.panelCloseAction)) throw new Error('提取设置无效 / Invalid extraction preferences');
  const attachmentAuditTypes = Array.isArray(value.attachmentAuditTypes)
    ? [...new Set(value.attachmentAuditTypes.filter(t => NETCARE_ATTACHMENT_AUDIT_TYPES.includes(t)))]
    : [...NETCARE_ATTACHMENT_AUDIT_TYPES];
  const { ruleSets, activeRuleSet, auditLevel, sections } = netcareResolveRuleSets(value);
  if (value.attachmentsEnabled === true && !sections.some(row => row.attachments) || value.textEnabled === true && !sections.some(row => row.text)) throw new Error('请为已开启的提取类型选择至少一个章节 / Select a section');
  if (value.aiAuditEnabled === true && !sections.some(row => row.textPrompt || row.attachmentsPrompt)) throw new Error('开启AI审计需要至少一条章节提示词 / Add an audit rule');
  const aiAuditEnabled = value.aiAuditEnabled === true;
  const attachmentsEnabled = value.attachmentsEnabled === true || aiAuditEnabled && sections.some(row => row.attachmentsPrompt);
  const textEnabled = value.textEnabled === true || aiAuditEnabled && sections.some(row => row.textPrompt);
  const screenshotsEnabled = (attachmentsEnabled || textEnabled) ? value.screenshotsEnabled !== false : false;
  const embedScreenshotsInExcel = screenshotsEnabled && value.embedScreenshotsInExcel === true;
  const closeAfterAudit = aiAuditEnabled && value.closeAfterAudit === true;
  const localRules = Array.isArray(value.localRules) ? value.localRules.slice(0, 100).map((r, i) => {
    const id = String(r.id || `local_rule_${i + 1}`).trim().slice(0, 60);
    const name = netcareRedactText(String(r.name || `规则 ${i + 1}`).trim().slice(0, 100));
    const sectionNumber = String(r.sectionNumber || '').trim().slice(0, 40);
    const sectionTitle = netcareRedactText(String(r.sectionTitle || '').trim().slice(0, 200));
    const kind = ['text', 'attachments'].includes(r.kind) ? r.kind : 'all';
    const pattern = String(r.pattern || '').trim().slice(0, 1000);
    if (pattern) {
      try { new RegExp(pattern, 'i'); }
      catch (e) { throw new Error(`本地审计规则【${name}】正则表达式无效: ${e.message}`); }
    }
    const passCondition = r.passCondition === 'not_match' ? 'not_match' : 'match';
    const passSummary = netcareRedactText(String(r.passSummary || '符合要求 / Compliant').trim().slice(0, 500));
    const failSummary = netcareRedactText(String(r.failSummary || '不符合要求，需人工核查 / Non-compliant').trim().slice(0, 500));
    const enabled = r.enabled !== false;
    return { id, name, sectionNumber, sectionTitle, kind, pattern, passCondition, passSummary, failSummary, enabled };
  }) : netcareDefaultLocalRules();
  return { autoSelectSanitizedPlan: value.autoSelectSanitizedPlan !== false, pipBetaEnabled:value.pipBetaEnabled!==false, panelCloseAction:['minimize','close'].includes(value.panelCloseAction)?value.panelCloseAction:'ask', auditLevel, activeRuleSet, ruleSets, closeAfterAudit, titleFallbackEnabled:value.titleFallbackEnabled===true, aiAuditEnabled, disableLocalRules: aiAuditEnabled && value.disableLocalRules !== false, concurrency: Number.isInteger(value.concurrency) && value.concurrency >= 1 && value.concurrency <= 10 ? value.concurrency : 3, openOnline: value.openOnline !== false, screenshotsEnabled, embedScreenshotsInExcel,
    attachmentsEnabled, textEnabled,
    intervalMs: Math.max(1000, Math.min(30000, Number(value.intervalMs) || 1500)),
    attachmentAuditTypes, sections, localRules };
}
// Preserve explicit child drafts; inherited values are computed rather than persisted.
function netcareEffectiveSection(settings, number) {
  const rows=settings.sections||[], own=rows.find(r=>r.number===number);
  const ancestors=rows.filter(r=>number.startsWith(r.number+'.')).sort((a,b)=>a.number.split('.').length-b.number.split('.').length);
  const result={number,title:own?.title||'',...own};
  for(const kind of ['attachments','text']) {
    const source=ancestors.find(r=>r[kind+'Prompt']?.trim());
    result[kind+'Prompt']=source?.[kind+'Prompt']||own?.[kind+'Prompt']||'';
    result[kind]=!!result[kind+'Prompt']||!!own?.[kind]||ancestors.some(r=>r[kind]||r[kind+'Prompt']?.trim());
  }
  return result;
}
function netcareAuditOwner(settings, number, kind) {
  return settings.sections.filter(r=>(number===r.number||number.startsWith(r.number+'.'))&&(r[kind]||r[kind+'Prompt']?.trim())).sort((a,b)=>a.number.split('.').length-b.number.split('.').length)[0]?.number||number;
}
function netcareAuditRule(settings, number, kind) {
  const own=netcareEffectiveSection(settings,number)[kind+'Prompt'];if(own)return own;
  const seen=new Set();return settings.sections.filter(r=>r.number.startsWith(number+'.')).map(r=>({number:r.number,rule:netcareEffectiveSection(settings,r.number)[kind+'Prompt']})).filter(r=>r.rule&&!seen.has(r.rule)&&seen.add(r.rule)).map(r=>r.number+': '+r.rule).join('\n');
}
function netcareRedactText(value) {
  return String(value).replace(/Bearer\s+[^\s]+/gi,'Bearer [REDACTED]').replace(/(["']?(?:password|passwd|token|api[_ -]?key|secret|authorization|cookie)["']?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,&;]+)/gi,'$1[REDACTED]')
    .replace(/Bearer\s+[^\s]+/gi,'Bearer [REDACTED]')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'[REDACTED PRIVATE KEY]');
}
// Rejects malformed input before normalization; normalization decides what is stored.
function netcareValidSettings(value) { return value && typeof value.attachmentsEnabled === 'boolean' && typeof value.textEnabled === 'boolean'
        && (!value.aiAuditEnabled || value.sections?.some(r=>r.textPrompt?.trim()||r.attachmentsPrompt?.trim()))
        && (value.aiAuditEnabled == null || typeof value.aiAuditEnabled === 'boolean')
        && (value.concurrency == null || Number.isInteger(value.concurrency) && value.concurrency >= 1 && value.concurrency <= 10)
        && (value.openOnline == null || typeof value.openOnline === 'boolean')
        && NETCARE_FLAG_SETTINGS.every(k=>value[k]==null||typeof value[k]==='boolean')
        && (value.auditLevel == null || NETCARE_AUDIT_LEVELS.includes(value.auditLevel))
        && (value.panelCloseAction == null || ['ask', 'minimize', 'close'].includes(value.panelCloseAction))
        && (value.activeRuleSet == null || typeof value.activeRuleSet === 'string' && /^(builtin:(strict|standard|lenient)|custom-[a-z0-9-]{4,40})$/.test(value.activeRuleSet))
        && (value.ruleSets == null || Array.isArray(value.ruleSets) && value.ruleSets.length <= 20 && value.ruleSets.every(set => set && /^custom-[a-z0-9-]{4,40}$/.test(set.id || '') && Array.isArray(set.sections) && set.sections.length <= 100))
        && (value.screenshotsEnabled == null || typeof value.screenshotsEnabled === 'boolean')
        && (value.attachmentAuditTypes == null || Array.isArray(value.attachmentAuditTypes) && value.attachmentAuditTypes.every(t => NETCARE_ATTACHMENT_AUDIT_TYPES.includes(t)))
        && Number.isFinite(value.intervalMs) && value.intervalMs >= 1000 && value.intervalMs <= 30000
        && Array.isArray(value.sections) && value.sections.length <= 100 && new Set(value.sections.map(row => row.number)).size === value.sections.length
        && (!value.attachmentsEnabled || value.sections.some(row => row.attachments)) && (!value.textEnabled || value.sections.some(row => row.text))
        && value.sections.every(row => typeof row.number === 'string' && /^\d+(\.\d+)*$/.test(row.number) && row.number.length <= 40
          && ['textPrompt','attachmentsPrompt'].every(k=>row[k]==null||typeof row[k]==='string'&&row[k].length<=4000)
          && typeof row.title === 'string' && row.title.trim() && row.title.length <= 200 && typeof row.attachments === 'boolean' && typeof row.text === 'boolean')
        && (value.localRules == null || Array.isArray(value.localRules) && value.localRules.length <= 100 && value.localRules.every(r => typeof r === 'object' && r && typeof (r.name || '') === 'string' && (r.name || '').length <= 100)); }
return {netcareDefaultLocalRules,netcareDefaultSettings,netcareAuditLevel,netcareAttachmentAuditOn,netcareBuiltinRuleSets,netcareNormalizeSections,netcareResolveRuleSets,netcareNormalizeSettings,netcareEffectiveSection,netcareAuditOwner,netcareAuditRule,netcareRedactText,netcareValidSettings};
});

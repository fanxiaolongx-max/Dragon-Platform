/**
 * sla/config.js - SLA 全局配置持久化模块
 * 负责：全量配置（偏好+目标）的导出、导入（与服务端交互）
 */

async function exportConfig() {
    try {
        const data = await API.get('/api/sla/config');
        const keysCount = Object.keys(data.prefs || {}).length + (data.targets ? 1 : 0);
        if (keysCount === 0) { AppDialog.alert(SLAT('sla.config.empty'), { title: SLAT('sla.dialog.notice'), tone: 'warning' }); return; }
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `SLA_Monitor_Config_${new Date().getTime()}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        showToast(SLAT('sla.config.exported'));
        API.logHistory('sla', '导出全量配置');
    } catch (e) {
        showToast(SLAT('sla.config.exportFail'), 'error');
    }
}

function formatConfigImportImpact(impact) {
    const before = impact && impact.before ? impact.before : {};
    const after = impact && impact.after ? impact.after : {};
    const removed = Array.isArray(impact && impact.removedLabels) ? impact.removedLabels : [];
    const added = Array.isArray(impact && impact.addedLabels) ? impact.addedLabels : [];
    const lines = [
        '本次导入会明显减少已保存的 SLA 指标规则：',
        '',
        `主指标：${before.mainMetricCount ?? '-'} -> ${after.mainMetricCount ?? '-'}`,
        `子指标：${before.subMetricCount ?? '-'} -> ${after.subMetricCount ?? '-'}`,
        `规则配置表：${before.schemaPrefCount ?? '-'} -> ${after.schemaPrefCount ?? '-'}`,
        `目标配置：${before.targetCount ?? '-'} -> ${after.targetCount ?? '-'}`,
        ''
    ];
    if (removed.length) {
        lines.push(`将移除的规则（${removed.length}）：`);
        removed.slice(0, 40).forEach(label => lines.push(`- ${label}`));
        if (removed.length > 40) lines.push(`... 还有 ${removed.length - 40} 个`);
        lines.push('');
    }
    if (added.length) {
        lines.push(`将新增的规则（${added.length}）：${added.slice(0, 20).join('、')}${added.length > 20 ? ' ...' : ''}`);
        lines.push('');
    }
    lines.push('确认继续导入并覆盖当前配置吗？');
    return lines.join('\n');
}

async function importConfig(event) {
    const file = event.target.files[0];
    if (!file) return;

    // 步骤1：读取文件
    let rawText;
    try {
        rawText = await file.text();
    } catch (readErr) {
        AppDialog.alert(SLAT('sla.config.readFail', { message: readErr.message }), { title: SLAT('sla.dialog.error'), tone: 'error' });
        event.target.value = '';
        return;
    }

    // 步骤2：JSON 解析
    let config;
    try {
        config = JSON.parse(rawText);
    } catch (parseErr) {
        AppDialog.alert(SLAT('sla.config.parseFail', { message: parseErr.message }), { title: SLAT('sla.dialog.error'), tone: 'error' });
        event.target.value = '';
        return;
    }

    if (typeof config !== 'object' || config === null) {
        AppDialog.alert(SLAT('sla.config.badRoot'), { title: SLAT('sla.dialog.error'), tone: 'error' });
        event.target.value = '';
        return;
    }

    // 步骤3：自动识别格式并统一转换
    // 新格式：{ targets: {}, prefs: {} }
    // 旧格式：{ "sla_global_targets": "...", "sla_prefs_xxx": "..." }
    let normalized = { targets: null, prefs: null };
    const keys = Object.keys(config);
    const isOldFormat = keys.some(k => k.startsWith('sla_'));

    if (isOldFormat) {
        // 旧版 localStorage 格式 → 转换
        console.log('[importConfig] 检测到旧版 localStorage 格式，自动转换中...');
        try {
            normalized.targets = config['sla_global_targets']
                ? JSON.parse(config['sla_global_targets']) : {};
        } catch (e) { normalized.targets = {}; }

        normalized.prefs = {};
        Object.keys(config).forEach(k => {
            if (k.startsWith('sla_prefs_')) {
                try { normalized.prefs[k] = JSON.parse(config[k]); }
                catch (e) { normalized.prefs[k] = config[k]; }
            }
        });
    } else if (config.targets !== undefined || config.prefs !== undefined) {
        // 新版平台格式
        normalized = config;
    } else {
        // 无法识别的格式，打印出字段帮助诊断
        AppDialog.alert(SLAT('sla.config.unknown', {
            fields: keys.slice(0, 10).join('\n'),
            more: keys.length > 10 ? '\n...' : ''
        }), { title: SLAT('sla.dialog.error'), tone: 'error' });
        event.target.value = '';
        return;
    }

    // 步骤4：发送到服务端
    try {
        try {
            await API.post('/api/sla/config', normalized);
        } catch (apiErr) {
            if (apiErr.status === 409 && apiErr.body && apiErr.body.requiresConfirmation) {
                const ok = await AppDialog.confirm(formatConfigImportImpact(apiErr.body.impact), { title: SLAT('sla.dialog.confirm'), tone: 'danger', confirmText: SLAT('sla.dialog.continue'), cancelText: SLAT('sla.dialog.cancel') });
                if (!ok) {
                    event.target.value = '';
                    return;
                }
                await API.post('/api/sla/config', {
                    ...normalized,
                    confirmImpact: true
                });
            } else {
                throw apiErr;
            }
        }
        if (normalized.targets) window.GlobalTargets = normalized.targets;
        const prefsCount = Object.keys(normalized.prefs || {}).length;
        const targetsCount = Object.keys(normalized.targets || {}).length;
        const formatTip = isOldFormat ? SLAT('sla.config.legacyTip') : '';
        AppDialog.alert(SLAT('sla.config.imported', { formatTip, targets: targetsCount, prefs: prefsCount }), { title: SLAT('sla.dialog.done'), tone: 'success' });
        API.logHistory('sla', '导入全量配置', `format:${isOldFormat ? 'legacy' : 'new'} targets:${targetsCount} prefs:${prefsCount}`);
    } catch (apiErr) {
        AppDialog.alert(SLAT('sla.config.uploadFail', { message: apiErr.message }), { title: SLAT('sla.dialog.error'), tone: 'error' });
        console.error('[importConfig] 上传失败:', apiErr);
    }

    event.target.value = '';
}

window.SLAConfig = { exportConfig, importConfig };

const meetingRepo = require('./meeting-snapshots-repository');
const incentiveRepo = require('./operation-incentive-snapshots-repository');

const jsonEscapes = { '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029' };
const safeJson = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, char => jsonEscapes[char]);

function publicSnapshot(item) {
    if (!item || typeof item !== 'object') return item;
    const { payload, ...summary } = item;
    return summary;
}

async function collectMeetingData() {
    const snapshots = await meetingRepo.listSnapshots({ includePayload: true });
    const roster = await meetingRepo.extractRoster();
    const persons = roster.map(person => ({
        staffId: person.staffId || person.id || '',
        name: person.name || ''
    }));
    const attendance = await meetingRepo.batchCheckAttendance(persons);
    Object.keys(attendance).forEach(key => {
        const splitIdx = key.indexOf('|');
        const id = splitIdx >= 0 ? key.slice(0, splitIdx) : key;
        const name = splitIdx >= 0 ? key.slice(splitIdx + 1) : '';
        if (/^\d{5,}$/.test(id)) {
            ['u', 'a', 'm'].forEach(prefix => {
                const aliasKey = `${prefix}${id}|${name}`;
                if (!attendance[aliasKey]) {
                    attendance[aliasKey] = attendance[key];
                }
            });
        } else if (/^[uam]\d{5,}$/i.test(id)) {
            const rawDigits = id.slice(1);
            const aliasKey = `${rawDigits}|${name}`;
            if (!attendance[aliasKey]) {
                attendance[aliasKey] = attendance[key];
            }
        }
    });
    return {
        snapshots,
        summaries: snapshots.map(publicSnapshot),
        roster,
        attendance
    };
}

async function collectIncentiveData() {
    const snapshots = await incentiveRepo.listSnapshots({ includePayload: true });
    const roster = await incentiveRepo.extractRoster();
    return {
        snapshots,
        summaries: snapshots.map(publicSnapshot),
        roster
    };
}

function staticRuntimeSource(variableName, options = {}) {
    const meeting = options.meeting !== false;
    const incentive = Boolean(options.incentive);
    return `
const TP_STATIC_READONLY_MESSAGE = '无权限，仅供查看。请联系管理员。';
function tpStaticJson(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
function tpStaticNormalizeId(value) {
  const text = String(value || '').trim().toLowerCase();
  const match = text.match(/^[ua](\\d{5,})$/);
  return match ? match[1] : text;
}
function tpStaticAttendance(person) {
  const source = ${variableName}.meeting || {};
  const attendance = source.attendance || {};
  const staffId = String(person?.staffId || person?.account || person?.id || '').trim();
  const name = String(person?.name || '').trim().toLowerCase();
  const normalizedId = tpStaticNormalizeId(staffId);
  let fallback = null;
  for (const [key, result] of Object.entries(attendance)) {
    const split = key.indexOf('|');
    const candidateId = split >= 0 ? key.slice(0, split) : key;
    const candidateName = split >= 0 ? key.slice(split + 1).trim().toLowerCase() : '';
    if (normalizedId && tpStaticNormalizeId(candidateId) === normalizedId) return result;
    if (name && candidateName && (candidateName === name || (name.length >= 2 && (candidateName.includes(name) || name.includes(candidateName))))) fallback = fallback || result;
  }
  return fallback || { found:false, hasAnomaly:false, cleanCount:0, anomalyCount:0, anomalies:[], records:[], totalMeetingsChecked:0 };
}
function tpStaticReadonlyResponse() {
  if (typeof showToast === 'function') showToast(TP_STATIC_READONLY_MESSAGE, 'warning');
  else if (typeof toast === 'function') toast(TP_STATIC_READONLY_MESSAGE, 'warning', 6000);
  return tpStaticJson({ success:false, error:TP_STATIC_READONLY_MESSAGE, code:'READ_ONLY_SNAPSHOT' }, 403);
}
function tpStaticApiResponse(url, options = {}) {
  const raw = String(url || '');
  let parsed;
  try { parsed = new URL(raw, 'https://tools-platform.invalid/'); } catch (_) { return null; }
  const pathname = parsed.pathname;
  const method = String(options.method || 'GET').toUpperCase();
  ${meeting ? `if (pathname === '/api/meeting-snapshots/attendance-check' && method === 'GET') {
    const result = tpStaticAttendance({ staffId: parsed.searchParams.get('staffId') || parsed.searchParams.get('account'), name: parsed.searchParams.get('name') });
    return tpStaticJson({ success:true, ...result, data:result });
  }
  if (pathname === '/api/meeting-snapshots/batch-attendance-check' && method === 'POST') {
    let body = {}; try { body = JSON.parse(options.body || '{}'); } catch (_) {}
    const results = {};
    for (const person of Array.isArray(body.persons) ? body.persons : []) results[String(person.staffId || '')+'|'+String(person.name || '')] = tpStaticAttendance(person);
    return tpStaticJson({ success:true, results, data:results });
  }
  if (pathname === '/api/meeting-snapshots/extract-roster' && method === 'GET') {
    const roster = ${variableName}.meeting?.roster || [];
    return tpStaticJson({ success:true, roster, items:roster, data:roster, count:roster.length });
  }
  if (pathname === '/api/meeting-snapshots' && method === 'GET') {
    const items = ${variableName}.meeting?.summaries || [];
    return tpStaticJson({ success:true, items, data:items, count:items.length });
  }
  if (pathname.startsWith('/api/meeting-snapshots/') && method === 'GET') {
    const id = decodeURIComponent(pathname.slice('/api/meeting-snapshots/'.length));
    const item = (${variableName}.meeting?.snapshots || []).find(entry => String(entry.id) === id);
    return item ? tpStaticJson({ success:true, item, data:item }) : tpStaticJson({ success:false, error:'未找到指定会议快照' }, 404);
  }
  if (pathname === '/api/meeting-snapshots' || pathname.startsWith('/api/meeting-snapshots/')) return tpStaticReadonlyResponse();` : ''}
  ${incentive ? `if (pathname === '/api/operation-incentive-snapshots/extract-roster' && method === 'GET') {
    const roster = ${variableName}.incentive?.roster || [];
    return tpStaticJson({ success:true, roster, items:roster, data:roster, count:roster.length });
  }
  if (pathname === '/api/operation-incentive-snapshots' && method === 'GET') {
    const items = ${variableName}.incentive?.summaries || [];
    return tpStaticJson({ success:true, items, data:items, count:items.length });
  }
  if (pathname.startsWith('/api/operation-incentive-snapshots/') && method === 'GET') {
    const id = decodeURIComponent(pathname.slice('/api/operation-incentive-snapshots/'.length));
    const item = (${variableName}.incentive?.snapshots || []).find(entry => String(entry.id) === id);
    return item ? tpStaticJson({ success:true, item, data:item }) : tpStaticJson({ success:false, error:'未找到指定操作激励快照' }, 404);
  }
  if (pathname === '/api/operation-incentive-snapshots' || pathname.startsWith('/api/operation-incentive-snapshots/')) return tpStaticReadonlyResponse();` : ''}
  return null;
}`;
}

module.exports = {
    safeJson,
    collectMeetingData,
    collectIncentiveData,
    staticRuntimeSource
};

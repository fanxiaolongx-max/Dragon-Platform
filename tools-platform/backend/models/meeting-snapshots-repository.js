const { run, get, all, getDbPath } = require('./app-db');
const { readKV, writeKV } = require('./kv-store');
const { normalizeStaffId } = require('./staff-id-normalization');

const initPromises = new Map();

async function ensureReady() {
    const key = getDbPath();
    if (!initPromises.has(key)) {
        const task = (async () => {
            await run(`
                CREATE TABLE IF NOT EXISTS meeting_attendance_snapshots (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    meeting_date TEXT DEFAULT '',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    summary_json TEXT,
                    payload_json TEXT NOT NULL
                )
            `);
            await run(`
                CREATE INDEX IF NOT EXISTS idx_meeting_snapshots_lookup
                ON meeting_attendance_snapshots(meeting_date DESC, updated_at DESC)
            `);
        })().catch(err => {
            initPromises.delete(key);
            throw err;
        });
        initPromises.set(key, task);
    }
    return initPromises.get(key);
}

function parseJson(str, fallback = {}) {
    if (!str) return fallback;
    try {
        return JSON.parse(str);
    } catch (_) {
        return fallback;
    }
}

async function listSnapshots({ search, startDate, endDate, since, includePayload = false, latestPerMonth = false } = {}) {
    await ensureReady();
    const conditions = [];
    const params = [];

    if (search) {
        const query = `%${String(search).trim()}%`;
        conditions.push('(title LIKE ? OR meeting_date LIKE ?)');
        params.push(query, query);
    }
    if (startDate) {
        conditions.push('meeting_date >= ?');
        params.push(String(startDate).trim());
    }
    if (endDate) {
        conditions.push('meeting_date <= ?');
        params.push(String(endDate).trim());
    }

    if(since){conditions.push('julianday(COALESCE(updated_at,created_at))>=julianday(?)');params.push(since);}
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
        SELECT id, title, meeting_date, created_at, updated_at, summary_json
        ${includePayload ? ', payload_json' : ''}
        FROM meeting_attendance_snapshots
        ${whereClause}
        ORDER BY ${latestPerMonth
            ? 'julianday(COALESCE(updated_at, created_at)) DESC, julianday(created_at) DESC, rowid DESC'
            : 'meeting_date DESC, updated_at DESC, id DESC'}
    `;

    const rows = await all(query, params);
    const seenMonths = new Set();
    // Attendance checks use one complete saved version per calendar month, selected
    // before matching people. Never resurrect a removed/corrected record from an older version.
    const selectedRows = latestPerMonth ? rows.filter(row => {
        const month = String(row.meeting_date || '').trim().match(/^(\d{4}-(?:0[1-9]|1[0-2]))(?:-|$)/)?.[1];
        if (!month) return true; // Undated legacy snapshots must not share an artificial month.
        if (seenMonths.has(month)) return false;
        seenMonths.add(month);
        return true;
    }) : rows;
    return selectedRows.map(row => {
        const item = {
            id: row.id,
            title: row.title,
            meetingDate: row.meeting_date,
            meeting_date: row.meeting_date,
            createdAt: row.created_at,
            created_at: row.created_at,
            updatedAt: row.updated_at,
            updated_at: row.updated_at,
            summary: parseJson(row.summary_json, {})
        };
        if (includePayload) {
            item.payload = parseJson(row.payload_json, null);
        }
        return item;
    });
}

async function getSnapshot(id) {
    await ensureReady();
    const snapId = String(id || '').trim();
    if (!snapId) return null;

    const row = await get(`
        SELECT id, title, meeting_date, created_at, updated_at, summary_json, payload_json
        FROM meeting_attendance_snapshots
        WHERE id = ?
    `, [snapId]);

    if (!row) return null;

    return {
        id: row.id,
        title: row.title,
        meetingDate: row.meeting_date,
        meeting_date: row.meeting_date,
        createdAt: row.created_at,
        created_at: row.created_at,
        updatedAt: row.updated_at,
        updated_at: row.updated_at,
        summary: parseJson(row.summary_json, {}),
        payload: parseJson(row.payload_json, null)
    };
}

async function saveSnapshot({ id, title, meetingDate, summary = {}, payload = {} }) {
    await ensureReady();
    const dateStr = String(meetingDate || '').trim() || new Date().toISOString().slice(0, 10);
    const snapId = String(id || '').trim() || `meet_${dateStr.replace(/-/g, '')}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const snapTitle = String(title || '').trim() || `${dateStr} 会议考勤快照`;

    const summaryJson = JSON.stringify(summary || {});
    const payloadJson = JSON.stringify(payload || {});

    await run(`
        INSERT INTO meeting_attendance_snapshots (
            id, title, meeting_date, created_at, updated_at, summary_json, payload_json
        )
        VALUES (?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'), strftime('%Y-%m-%d %H:%M:%f', 'now'), ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            meeting_date = excluded.meeting_date,
            updated_at = excluded.updated_at,
            summary_json = excluded.summary_json,
            payload_json = excluded.payload_json
    `, [snapId, snapTitle, dateStr, summaryJson, payloadJson]);

    return getSnapshot(snapId);
}

async function renameSnapshot(id, newTitle) {
    await ensureReady();
    const snapId = String(id || '').trim();
    const title = String(newTitle || '').trim();
    if (!snapId || !title) throw new Error('快照ID和新名称不能为空');

    const result = await run(`
        UPDATE meeting_attendance_snapshots
        SET title = ?, updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now')
        WHERE id = ?
    `, [title, snapId]);

    if (!result || result.changes === 0) return null;
    return getSnapshot(snapId);
}

async function deleteSnapshot(id) {
    await ensureReady();
    const snapId = String(id || '').trim();
    if (!snapId) return false;

    const result = await run(`
        DELETE FROM meeting_attendance_snapshots
        WHERE id = ?
    `, [snapId]);

    return Boolean(result && result.changes > 0);
}

function normalizeId(id) {
    if (!id) return '';
    const s = String(id).trim().toLowerCase();
    const m = s.match(/^[ua](\d{5,})$/);
    return m ? m[1] : s;
}

function areStaffIdsEquivalent(id1, id2) {
    if (!id1 || !id2) return false;
    const s1 = String(id1).trim().toLowerCase();
    const s2 = String(id2).trim().toLowerCase();
    if (!s1 || !s2) return false;
    if (s1 === s2) return true;

    // Check leading 'm' prefix (e.g. mWX1350434 vs WX1350434)
    if (s1 === 'm' + s2 || s2 === 'm' + s1) return true;

    // Check single leading letter difference
    if (s1.length === s2.length + 1 && s1.slice(1) === s2 && s2.length >= 4) return true;
    if (s2.length === s1.length + 1 && s2.slice(1) === s1 && s1.length >= 4) return true;

    // Check normalized digits if >= 5 digits (e.g. u1350434 vs 1350434 or mwx1350434 vs wx1350434)
    const num1 = s1.replace(/^[a-z]+/i, '');
    const num2 = s2.replace(/^[a-z]+/i, '');
    if (num1 && num1 === num2 && num1.length >= 5) return true;

    return false;
}

function isOrderNumber(str) {
    if (!str) return false;
    const s = String(str).trim();
    if (!s) return false;
    // 单号特征：以 qr/task/wo/req/inc/chg/cr 开头且后面跟纯数字或大部分数字
    if (/^qr\d+/i.test(s) || /^(task|wo|req|inc|chg|cr)\d+/i.test(s)) return true;
    // 纯无空格连续单号/工单编码（如 QR20260610000307，长于10位且含6位以上连续数字）
    if (/^[A-Za-z0-9_-]{11,}$/.test(s) && /\d{6,}/.test(s)) return true;
    return false;
}

function isInvalidStaffId(id) {
    if (!id) return false;
    const s = String(id).trim();
    if (!s) return false;
    // 自动过滤超过10位字符的非工号（如 QR20260610000307 共16位）
    if (s.length > 10) return true;
    // 单号/工单号特征过滤（如 QR...、TASK...、WO...）
    if (isOrderNumber(s)) return true;
    return false;
}

function preferCanonicalStaffId(id1, id2, preferredIds = new Set()) {
    const s1 = String(id1 || '').trim();
    const s2 = String(id2 || '').trim();
    if (isInvalidStaffId(s1) && !isInvalidStaffId(s2)) return s2;
    if (isInvalidStaffId(s2) && !isInvalidStaffId(s1)) return s1;
    if (isInvalidStaffId(s1) && isInvalidStaffId(s2)) return '';
    if (!s1) return s2;
    if (!s2) return s1;
    if (s1.toLowerCase() === s2.toLowerCase()) return s1;

    // 1. If one matches an already existing employee ID in the personnel roster, prefer it
    if (preferredIds.has(s1) && !preferredIds.has(s2)) return s1;
    if (preferredIds.has(s2) && !preferredIds.has(s1)) return s2;

    // 2. Prefer non-m prefix (e.g. WX1350434 over mWX1350434, 00665597 over m00665597)
    const isM1 = /^m/i.test(s1) && (s2.toLowerCase() === s1.slice(1).toLowerCase() || areStaffIdsEquivalent(s1, s2));
    const isM2 = /^m/i.test(s2) && (s1.toLowerCase() === s2.slice(1).toLowerCase() || areStaffIdsEquivalent(s1, s2));
    if (isM1 && !isM2) return s2;
    if (isM2 && !isM1) return s1;

    // 3. Prefer standard enterprise prefix (e.g. WX...)
    if (/^wx\d+/i.test(s1) && !/^wx\d+/i.test(s2)) return s1;
    if (/^wx\d+/i.test(s2) && !/^wx\d+/i.test(s1)) return s2;

    // 4. Shorter ID preferred
    if (s1.length !== s2.length) return s1.length < s2.length ? s1 : s2;
    return s1;
}

function isTotalRow(id, name) {
    const sId = String(id || '').trim();
    const sName = String(name || '').trim();
    return /总计|合计|小计|^total$/i.test(sId) || /总计|合计|小计|^total$/i.test(sName);
}

function matchPerson(person, targetStaffId, targetName) {
    const tId = normalizeId(targetStaffId);
    const tName = String(targetName || '').trim().toLowerCase();
    const pAccount = normalizeId(person.account || person.staffId || person.id);
    const pName = String(person.name || '').trim().toLowerCase();

    // 1. Exact or normalized ID match, or fuzzy equivalent ID match (e.g. WX1350434 vs mWX1350434)
    if (tId && pAccount && (
        tId === pAccount ||
        tId === (person.account || '').toLowerCase() ||
        tId === (person.staffId || '').toLowerCase() ||
        tId === (person.id || '').toLowerCase() ||
        areStaffIdsEquivalent(tId, pAccount)
    )) {
        return true;
    }
    // 2. Exact name match
    if (tName && pName && tName === pName) {
        if (!tId || !pAccount || areStaffIdsEquivalent(tId, pAccount)) {
            return true;
        }
    }
    // 3. Name substring match if length >= 2
    if (tName && pName && tName.length >= 2 && (pName.includes(tName) || tName.includes(pName))) {
        if (!tId || !pAccount || areStaffIdsEquivalent(tId, pAccount)) {
            return true;
        }
    }
    return false;
}

function getDigits(s) {
    const d = String(s || '').replace(/^[a-z]+/i, '').trim();
    return d.length >= 5 ? d : '';
}

function isStaffIdToken(token) {
    if (!token) return false;
    const s = String(token).trim();
    if (s.length < 4 || s.length > 10) return false;
    if (isInvalidStaffId(s) || isOrderNumber(s)) return false;
    const digits = s.replace(/\D/g, '');
    if (digits.length < 3) return false;
    return /^[A-Za-z]{0,4}\d{3,9}[A-Za-z]?$/i.test(s);
}

function cleanNameAndStaffId(rawName, existingStaffId = '') {
    let name = String(rawName || '').trim();
    let staffId = String(existingStaffId || '').trim();

    if (!name) {
        if (staffId && !isStaffIdToken(staffId)) {
            return cleanNameAndStaffId(staffId, '');
        }
        if (isInvalidStaffId(staffId)) staffId = '';
        return { name: '', staffId };
    }
    if (isInvalidStaffId(staffId)) staffId = '';

    if (isStaffIdToken(name)) {
        if (staffId && !isStaffIdToken(staffId)) {
            return cleanNameAndStaffId(staffId, name);
        }
        staffId = preferCanonicalStaffId(staffId, name);
        return { name: '', staffId };
    }

    // 1. Bracketed pattern
    const mParen = name.match(/^(.*?)\s*[(（]([A-Za-z0-9_-]{4,10})[)）]$/);
    if (mParen && isStaffIdToken(mParen[2])) {
        name = mParen[1].trim();
        staffId = preferCanonicalStaffId(staffId, mParen[2].trim());
    } else {
        const mParenStart = name.match(/^[(（]([A-Za-z0-9_-]{4,10})[)）]\s*(.*?)$/);
        if (mParenStart && isStaffIdToken(mParenStart[1])) {
            name = mParenStart[2].trim();
            staffId = preferCanonicalStaffId(staffId, mParenStart[1].trim());
        }
    }

    // 2. Suffix pattern
    const mSuffix = name.match(/^(.*?)\s+([A-Za-z0-9_-]{4,10})$/);
    if (mSuffix && isStaffIdToken(mSuffix[2])) {
        name = mSuffix[1].trim();
        staffId = preferCanonicalStaffId(staffId, mSuffix[2].trim());
    }

    // 3. Prefix pattern
    const mPrefix = name.match(/^([A-Za-z0-9_-]{4,10})\s+(.*?)$/);
    if (mPrefix && isStaffIdToken(mPrefix[1])) {
        staffId = preferCanonicalStaffId(staffId, mPrefix[1].trim());
        name = mPrefix[2].trim();
    }

    // 4. Strip known staffId from name
    if (staffId) {
        const idEscaped = staffId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const idRegex = new RegExp(`(^|\\s+|[(（])${idEscaped}($|\\s+|[)）])`, 'gi');
        if (idRegex.test(name)) {
            name = name.replace(idRegex, ' ').replace(/\s+/g, ' ').trim();
        }
        const digits = getDigits(staffId);
        if (digits && digits.length >= 5) {
            const digitsRegex = new RegExp(`(^|\\s+|[(（])${digits}($|\\s+|[)）])`, 'gi');
            if (digitsRegex.test(name)) {
                name = name.replace(digitsRegex, ' ').replace(/\s+/g, ' ').trim();
            }
        }
    }

    name = name.replace(/^[\s,;，；|/()（）\-]+|[\s,;，；|/()（）\-]+$/g, '').trim();
    return { name, staffId };
}

function splitAndParsePeople(rawStr, defaultStaffId = '', defaultName = '') {
    if (!rawStr) return [];
    const text = String(rawStr).trim();
    if (!text) return [];

    const tokens = text.split(/[;\n；|]+/).map(t => t.trim()).filter(Boolean);
    const results = [];

    for (const token of tokens) {
        let { name, staffId } = cleanNameAndStaffId(token, defaultStaffId);

        if (!staffId && !name) {
            if (/[\u4e00-\u9fa5]/.test(token) || /\s+/.test(token)) {
                name = token;
                staffId = defaultStaffId || '';
            } else if (isStaffIdToken(token)) {
                staffId = token;
                name = defaultName || '';
            } else {
                name = token;
                staffId = '';
            }
        }

        if (isInvalidStaffId(staffId)) staffId = '';
        if (isOrderNumber(name)) name = '';
        if (name) name = name.replace(/^[\s,;，；|/()（）\-]+|[\s,;，；|/()（）\-]+$/g, '').trim();

        if ((name || staffId) && !isTotalRow(staffId, name)) {
            results.push({ name: name || staffId, staffId: staffId || '' });
        }
    }
    return results;
}

function getSnapshotAttendees(snapshot) {
    if (!snapshot) return [];
    const attendees = [];
    const attByKey = new Map();
    const attById = new Map();
    const attByName = new Map();

    const getDigits = s => {
        const d = String(s || '').replace(/^[a-z]+/i, '').trim();
        return d.length >= 5 ? d : '';
    };

    const add = (p, traceInfo = null) => {
        let id = String(p.account || p.staffId || p.id || '').trim();
        let name = String(p.name || '').trim();
        const cleaned = cleanNameAndStaffId(name, id);
        id = cleaned.staffId;
        name = cleaned.name;
        if (isInvalidStaffId(id)) {
            id = '';
        }
        if (isOrderNumber(name)) {
            name = '';
        }
        if (!id && !name) return;
        if (isTotalRow(id, name)) return;

        const role = p.role || '';
        const isPm = /^\s*pm\s*$/i.test(role);
        const bu = isPm ? 'PMO' : (p.bu || p.businessUnit || '');
        const customerGroup = p.customerGroup || p.customer || p['Customer Group'] || p.CustomerGroup || p['客户群'] || p.group || '';

        const normN = normName(name);
        const key = id ? id.toLowerCase() : (normN ? `name:${normN}` : '');
        if (!key) return;

        let existing = attByKey.get(key);
        if (!existing && id) {
            const sId = id.toLowerCase();
            existing = attById.get(sId);
            if (!existing && sId.startsWith('m')) existing = attById.get(sId.slice(1));
            if (!existing) existing = attById.get('m' + sId);
            if (!existing) {
                const digits = getDigits(sId);
                if (digits) existing = attById.get('digits:' + digits);
            }
        }
        if (!existing && normN) {
            existing = attByName.get(normN);
        }

        const splitDelimited = val => {
            if (!val) return [];
            if (Array.isArray(val)) {
                return [...new Set(val.flatMap(x => String(x || '').split(/[,，;/]+/).map(s => s.trim()).filter(Boolean)))];
            }
            return [...new Set(String(val).split(/[,，;/]+/).map(s => s.trim()).filter(Boolean))];
        };

        const initGroups = splitDelimited(p.customerGroups && p.customerGroups.length ? p.customerGroups : customerGroup);
        const initRoles = splitDelimited(p.roles && p.roles.length ? p.roles : role);

        if (!existing) {
            const newEntry = {
                account: id,
                staffId: id,
                id,
                name,
                bu,
                businessUnit: bu,
                customerGroup: initGroups.join(', '),
                customerGroups: initGroups,
                role: initRoles.join(', '),
                roles: initRoles,
                attendance: p.attendance || p.status || 'Attend on Time',
                status: p.status || p.attendance || 'Attend on Time',
                reason: p.reason || '',
                date: p.date || p.meetingDate || p.attendanceDate || '',
                attendanceTime: p.attendanceTime || '',
                sourceTraces: traceInfo ? [traceInfo] : []
            };
            attendees.push(newEntry);
            attByKey.set(key, newEntry);
            if (id) {
                const sId = id.toLowerCase();
                attById.set(sId, newEntry);
                if (sId.startsWith('m')) attById.set(sId.slice(1), newEntry);
                else attById.set('m' + sId, newEntry);
                const digits = getDigits(sId);
                if (digits) attById.set('digits:' + digits, newEntry);
            }
            if (normN) attByName.set(normN, newEntry);
        } else {
            existing.account = preferCanonicalStaffId(existing.account, id);
            existing.staffId = preferCanonicalStaffId(existing.staffId, id);
            existing.id = existing.staffId || existing.account;
            if ((!existing.name || isStaffIdToken(existing.name) || existing.name === existing.staffId) && name && !isStaffIdToken(name)) {
                existing.name = name;
            } else if (name) {
                existing.name = preferCanonicalName(existing.name, name);
            }
            if (id) {
                const sId = id.toLowerCase();
                attById.set(sId, existing);
                if (sId.startsWith('m')) attById.set(sId.slice(1), existing);
                else attById.set('m' + sId, existing);
                const digits = getDigits(sId);
                if (digits) attById.set('digits:' + digits, existing);
            }
            if (normN) attByName.set(normN, existing);

            if (p.attendance && (!existing.attendance || isAttendanceAnomaly(p.attendance))) {
                existing.attendance = p.attendance;
                existing.status = p.attendance;
            }
            if (!Array.isArray(existing.roles)) {
                existing.roles = splitDelimited(existing.role);
            }
            for (const r of initRoles) {
                if (r && !existing.roles.includes(r)) existing.roles.push(r);
            }
            existing.role = existing.roles.join(', ');

            if (!Array.isArray(existing.customerGroups)) {
                existing.customerGroups = splitDelimited(existing.customerGroup);
            }
            for (const g of initGroups) {
                if (g && !existing.customerGroups.includes(g)) existing.customerGroups.push(g);
            }
            existing.customerGroup = existing.customerGroups.join(', ');

            const anyPm = isPm || /^\s*pm\s*$/i.test(role) || existing.roles.some(r => /^\s*pm\s*$/i.test(r));
            if (anyPm) {
                existing.bu = 'PMO';
                existing.businessUnit = 'PMO';
            } else if (!existing.bu && bu) {
                existing.bu = bu;
                existing.businessUnit = bu;
            }
            if (!existing.date && (p.date || p.meetingDate || p.attendanceDate)) {
                existing.date = p.date || p.meetingDate || p.attendanceDate;
            }
            if (!existing.attendanceTime && p.attendanceTime) {
                existing.attendanceTime = p.attendanceTime;
            }
            if (traceInfo) {
                if (!Array.isArray(existing.sourceTraces)) existing.sourceTraces = [];
                if (!existing.sourceTraces.some(t => t.snapshotTitle === traceInfo.snapshotTitle && t.rowNumber === traceInfo.rowNumber && t.field === traceInfo.field && t.sheetName === traceInfo.sheetName)) {
                    existing.sourceTraces.push(traceInfo);
                }
            }
        }
    };

    // 核心业务原则：
    // 1. 若存在“三类合并人员备用名单”（或 summary.attendees），在册人员范围严格以此为准；
    // 2. 随后扫描 QR、RFC、WFM 原始明细表，查找每位在册人员的“匹配角色”（如 TD/PM/FME）与 Customer Group 进行属性富化与补全。
    let hasCombinedRoster = false;
    if (Array.isArray(snapshot.summary?.attendees) && snapshot.summary.attendees.length) {
        hasCombinedRoster = true;
        snapshot.summary.attendees.forEach((a, idx) => {
            const trace = {
                source: 'meeting',
                sourceName: '会议考勤快照',
                snapshotTitle: snapshot.title || '会议考勤快照',
                sheetName: '三类合并人员备用名单',
                rowNumber: idx + 1,
                field: '参会人员',
                raw: [a.name, a.account || a.staffId].filter(Boolean).join(' ')
            };
            add(a, trace);
        });
    } else if (snapshot.payload && Array.isArray(snapshot.payload.sheets)) {
        const combinedSheet = snapshot.payload.sheets.find(s => 
            /三类合并人员备用名单|Combined.*People List/i.test(s.sheetName || s.name || s.title || '')
        );
        if (combinedSheet && Array.isArray(combinedSheet.rows) && combinedSheet.rows.length) {
            hasCombinedRoster = true;
            const headers = (combinedSheet.headers || []).map(h => String(h || '').trim());
            const nameIdx = headers.findIndex(h => /姓名|fullname|\bname\b/i.test(h));
            const idIdx = headers.findIndex(h => /工号|account|staffid|\bid\b/i.test(h));
            const buIdx = headers.findIndex(h => /bu|部门/i.test(h));
            const grpIdx = headers.findIndex(h => /客户群|customer group|customer/i.test(h));

            combinedSheet.rows.forEach((row, rIdx) => {
                const name = nameIdx >= 0 ? String(row[nameIdx] || '').trim() : '';
                const account = idIdx >= 0 ? String(row[idIdx] || '').trim() : '';
                const bu = buIdx >= 0 ? String(row[buIdx] || '').trim() : '';
                const customerGroup = grpIdx >= 0 ? String(row[grpIdx] || '').trim() : '';
                if (name || account) {
                    add({ account, name, bu, customerGroup, attendance: 'Attend on Time' }, {
                        source: 'meeting',
                        sourceName: '会议考勤快照',
                        snapshotTitle: snapshot.title || '会议考勤快照',
                        sheetName: combinedSheet.sheetName || '三类合并人员备用名单',
                        rowNumber: rIdx + 1,
                        field: '参会人员',
                        raw: `${name} ${account}`.trim()
                    });
                }
            });
        }
    }

    const findExistingAttendee = (rawId, rawName) => {
        let id = String(rawId || '').trim();
        let name = String(rawName || '').trim();
        const cleaned = cleanNameAndStaffId(name, id);
        id = cleaned.staffId;
        name = cleaned.name;
        if (id) {
            const sId = id.toLowerCase();
            let c = attById.get(sId);
            if (!c && sId.startsWith('m')) c = attById.get(sId.slice(1));
            if (!c) c = attById.get('m' + sId);
            if (!c) {
                const digits = getDigits(sId);
                if (digits) c = attById.get('digits:' + digits);
            }
            if (c) return c;
        }
        if (name) {
            const normN = normName(name);
            let c = (normN && attByName.get(normN)) || attByName.get(name.toLowerCase());
            if (c && (!id || !c.account || areStaffIdsEquivalent(id, c.account))) {
                return c;
            }
        }
        if (id || name) {
            return attendees.find(a => matchPerson(a, id, name));
        }
        return null;
    };

    const addOrEnrich = (p, traceInfo = null) => {
        if (hasCombinedRoster) {
            const existing = findExistingAttendee(p.account || p.staffId || p.id, p.name);
            if (existing) {
                add(p, traceInfo);
            }
            return;
        }
        add(p, traceInfo);
    };

    // Helper to parse paired names and accounts in QR cells (supports multi-person semicolon split)
    const parseQrPairedPeople = (nameValue, accountValue) => {
        const splitNames = String(nameValue || '').split(/[;；\n|]+/).map(s => s.trim()).filter(Boolean);
        const splitAccounts = String(accountValue || '').split(/[;；\n|]+/).map(s => s.trim()).filter(Boolean);

        if (splitNames.length === splitAccounts.length) {
            const result = [];
            for (let i = 0; i < splitNames.length; i++) {
                const cleaned = cleanNameAndStaffId(splitNames[i], splitAccounts[i]);
                if (cleaned.name || cleaned.staffId) {
                    result.push({ name: cleaned.name || cleaned.staffId, account: cleaned.staffId || '' });
                }
            }
            return result;
        }

        const result = [];
        const usedAccounts = new Set();
        for (const rawN of splitNames) {
            let matchedAcc = '';
            for (const rawA of splitAccounts) {
                if (!rawA) continue;
                const strippedA = rawA.replace(/^m/i, '');
                const esc = strippedA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                if (new RegExp(`(^|[^a-zA-Z0-9])${esc}($|[^a-zA-Z0-9])`, 'i').test(rawN)) {
                    matchedAcc = rawA;
                    usedAccounts.add(rawA);
                    break;
                }
            }
            const cleaned = cleanNameAndStaffId(rawN, matchedAcc);
            if (cleaned.name || cleaned.staffId) {
                result.push({ name: cleaned.name || cleaned.staffId, account: cleaned.staffId || '' });
            }
        }

        for (const rawA of splitAccounts) {
            if (usedAccounts.has(rawA)) continue;
            const cleaned = cleanNameAndStaffId('', rawA);
            if (cleaned.name || cleaned.staffId) {
                if (!result.some(r => r.account && areStaffIdsEquivalent(r.account, cleaned.staffId))) {
                    result.push({ name: cleaned.name || cleaned.staffId, account: cleaned.staffId || '' });
                }
            }
        }
        return result;
    };

    // Helper to extract a person's name and canonical ID from QR cells given candidate search keys (e.g. without 'm')
    const extractNameForStaffIdFromCells = (nameCell, idCell, searchKeys) => {
        const sName = String(nameCell || '').trim();
        const sId = String(idCell || '').trim();
        if (!sName && !sId) return null;

        const matchesTarget = (text) => {
            for (const key of searchKeys) {
                if (!key) continue;
                const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const re = new RegExp(`(^|[^a-zA-Z0-9])${esc}($|[^a-zA-Z0-9])`, 'i');
                if (re.test(text)) return key;
            }
            return null;
        };

        const nameSegments = sName ? sName.split(/[;；\n|]+/).map(s => s.trim()).filter(Boolean) : [];
        const idSegments = sId ? sId.split(/[;；\n|]+/).map(s => s.trim()).filter(Boolean) : [];

        // Check nameSegments first (e.g. "Mahmoud Elnaggar 00909378;Mostafa Orabi 00665597")
        for (let i = 0; i < nameSegments.length; i++) {
            const seg = nameSegments[i];
            const matchedKey = matchesTarget(seg);
            if (matchedKey) {
                const cleaned = cleanNameAndStaffId(seg, matchedKey);
                if (cleaned.name && !isStaffIdToken(cleaned.name)) {
                    return {
                        name: cleaned.name,
                        canonicalId: preferCanonicalStaffId(cleaned.staffId || matchedKey, matchedKey)
                    };
                }
            }
        }

        // Check idSegments and parallel nameSegments
        for (let i = 0; i < idSegments.length; i++) {
            const seg = idSegments[i];
            const matchedKey = matchesTarget(seg);
            if (matchedKey) {
                const cleanedSelf = cleanNameAndStaffId(seg, matchedKey);
                if (cleanedSelf.name && !isStaffIdToken(cleanedSelf.name)) {
                    return {
                        name: cleanedSelf.name,
                        canonicalId: preferCanonicalStaffId(cleanedSelf.staffId || matchedKey, matchedKey)
                    };
                }
                if (i < nameSegments.length) {
                    const cleanedParallel = cleanNameAndStaffId(nameSegments[i], matchedKey);
                    if (cleanedParallel.name && !isStaffIdToken(cleanedParallel.name)) {
                        return {
                            name: cleanedParallel.name,
                            canonicalId: preferCanonicalStaffId(cleanedParallel.staffId || matchedKey, matchedKey)
                        };
                    }
                }
            }
        }

        // If nameSegments has 1 item and idCell matches
        if (nameSegments.length === 1 && matchesTarget(sId)) {
            const cleaned = cleanNameAndStaffId(nameSegments[0], sId);
            if (cleaned.name && !isStaffIdToken(cleaned.name)) {
                return {
                    name: cleaned.name,
                    canonicalId: preferCanonicalStaffId(cleaned.staffId, searchKeys[0])
                };
            }
        }

        // Fallback: check all segments
        const allSegments = [...nameSegments, ...idSegments];
        for (const seg of allSegments) {
            const matchedKey = matchesTarget(seg);
            if (matchedKey) {
                const cleaned = cleanNameAndStaffId(seg, matchedKey);
                if (cleaned.name && !isStaffIdToken(cleaned.name)) {
                    return {
                        name: cleaned.name,
                        canonicalId: preferCanonicalStaffId(cleaned.staffId || matchedKey, matchedKey)
                    };
                }
            }
        }

        return null;
    };

    // Helper to parse role-paired cell or free-text names/accounts
    const parsePeopleTokens = (value) => {
        const text = String(value || '').trim();
        if (!text) return [];
        const people = [];
        const re = /([A-Za-z]{0,4}\d{4,})/g;
        let match, cursor = 0;
        while ((match = re.exec(text))) {
            const rawPart = text.slice(cursor, match.index).replace(/[\s,;，；|/()（）\-]+$/g, '').trim();
            const account = match[1];
            if (!isInvalidStaffId(account)) {
                people.push({ name: rawPart || account, account });
            } else if (rawPart && !isOrderNumber(rawPart)) {
                people.push({ name: rawPart, account: '' });
            }
            cursor = re.lastIndex;
        }
        if (people.length) return people;
        return text.split(/[\n;,，；|]+/)
            .map(s => s.replace(/^[\s,;，；|/()（）\-]+|[\s,;，；|/()（）\-]+$/g, '').trim())
            .filter(name => Boolean(name) && !isOrderNumber(name))
            .map(name => ({ name, account: '' }));
    };

    // Parse or enrich from sheets if available (QR, RFC, WFM)
    if (snapshot.payload && Array.isArray(snapshot.payload.sheets)) {
        const rfcRoles = [
            { role: 'Originator', re: /建单人|originator/i },
            { role: 'Owner', re: /\bowner\b/i },
            { role: 'Solution Developer', re: /方案制作人|solution developer/i },
            { role: 'TD', re: /\btd\b/i },
            { role: 'PM', re: /\bpm\b/i },
            { role: 'L1 Solution Reviewer', re: /l1评审人|l1 solution reviewer|l1 reviewer/i }
        ];
        const wfmRoles = [
            { role: 'FME', re: /实施人|operator|oprator|fme/i },
            { role: 'Creator', re: /建单人|creator|originator/i },
            { role: 'TD', re: /\btd\b/i },
            { role: 'PM', re: /\bpm\b/i }
        ];

        snapshot.payload.sheets.forEach(sheet => {
            if (!sheet || !Array.isArray(sheet.headers) || !Array.isArray(sheet.rows)) return;
            const sheetName = String(sheet.sheetName || sheet.name || sheet.title || '');
            if (/三类合并人员备用名单|Combined.*People List/i.test(sheetName)) return;

            const headers = sheet.headers.map(h => String(h || '').trim());
            const nameIdx = headers.findIndex(h => /姓名|fullname|apply fullname|\bname\b/i.test(h));
            const idIdx = headers.findIndex(h => /工号|accountid|apply accountid|staffid|\baccount\b|\bid\b/i.test(h));
            const buIdx = headers.findIndex(h => /^(bu|部门|service type|bu\/service type)$/i.test(h));
            const roleIdx = headers.findIndex(h => /^(匹配角色|用户角色|角色|role name|\brole\b|岗位|identity|身份)$/i.test(h));

            // Priority:
            // 1. 客户群/Customer Group
            // 2. 客户网络/Network Name
            // 3. 客户组织/Customer Org
            // 4. 网络/Network
            // 5. 组织/Org
            // 6. 客户/Customer
            const grpCandidates = [
                headers.findIndex(h => /客户群|customer group/i.test(h)),
                headers.findIndex(h => /客户网络|network name/i.test(h)),
                headers.findIndex(h => /客户组织|customer org/i.test(h)),
                headers.findIndex(h => /网络|network/i.test(h)),
                headers.findIndex(h => /组织|org/i.test(h)),
                headers.findIndex(h => /customer name|customer|客户/i.test(h))
            ].filter(idx => idx >= 0);

            const isRfc = sheet.category === 'rfc' || /rfc.*记录|rfc.*明细|\brfc\b/i.test(sheetName) || headers.some(h => /solution developer|方案制作人/i.test(h));
            const isWfm = sheet.category === 'wfm' || /wfm.*记录|wfm.*明细|\bwfm\b/i.test(sheetName) || headers.some(h => /\bfme\b|实施人/i.test(h));
            const isQr = sheet.category === 'qr' || /qr.*记录|qr.*明细|\bqr\b/i.test(sheetName) || headers.some(h => /apply fullname|apply accountid/i.test(h));

            sheet.rows.forEach((row, rIdx) => {
                const bu = buIdx >= 0 ? String(row[buIdx] || '').trim() : '';
                let customerGroup = '';
                for (const cIdx of grpCandidates) {
                    const val = String(row[cIdx] || '').trim();
                    if (val) {
                        customerGroup = val;
                        break;
                    }
                }
                const explicitRole = roleIdx >= 0 ? String(row[roleIdx] || '').trim() : '';

                if (isQr) {
                    const applyNameIdx = headers.findIndex(h => /apply\s*(full)?\s*name/i.test(h));
                    const applyIdIdx = headers.findIndex(h => /apply\s*(account|id|accountid|工号)/i.test(h));
                    const tdNameIdx = headers.findIndex(h => /td\s*(full)?\s*name/i.test(h));
                    const tdIdIdx = headers.findIndex(h => /^(td|td\s*(account|id|accountid|工号)|td\s*[(（].*?[)）])$/i.test(h));

                    if (tdNameIdx >= 0 || tdIdIdx >= 0) {
                        const rawName = tdNameIdx >= 0 ? row[tdNameIdx] : '';
                        const rawId = tdIdIdx >= 0 ? row[tdIdIdx] : '';
                        parseQrPairedPeople(rawName, rawId).forEach(p => {
                            addOrEnrich({
                                account: p.account,
                                name: p.name,
                                bu,
                                customerGroup,
                                role: explicitRole || 'TD',
                                attendance: 'Attend on Time'
                            }, {
                                source: 'meeting',
                                sourceName: '会议考勤快照',
                                snapshotTitle: snapshot.title || '会议考勤快照',
                                sheetName: sheet.sheetName || 'QR 相关记录',
                                rowNumber: rIdx + 1,
                                field: `TD${explicitRole ? ` (匹配角色: ${explicitRole})` : ''}`,
                                raw: `${p.name} ${p.account}`.trim()
                            });
                        });
                    }

                    if (applyNameIdx >= 0 || applyIdIdx >= 0) {
                        const rawName = applyNameIdx >= 0 ? row[applyNameIdx] : '';
                        const rawId = applyIdIdx >= 0 ? row[applyIdIdx] : '';
                        const applyRole = (explicitRole && !/^\s*td\s*$/i.test(explicitRole)) ? explicitRole : '申请人';
                        parseQrPairedPeople(rawName, rawId).forEach(p => {
                            addOrEnrich({
                                account: p.account,
                                name: p.name,
                                bu,
                                customerGroup,
                                role: applyRole,
                                attendance: 'Attend on Time'
                            }, {
                                source: 'meeting',
                                sourceName: '会议考勤快照',
                                snapshotTitle: snapshot.title || '会议考勤快照',
                                sheetName: sheet.sheetName || 'QR 相关记录',
                                rowNumber: rIdx + 1,
                                field: `申请人${explicitRole ? ` (匹配角色: ${explicitRole})` : ''}`,
                                raw: `${p.name} ${p.account}`.trim()
                            });
                        });
                    }
                } else if (isRfc) {
                    rfcRoles.forEach(cfg => {
                        const colIdx = headers.findIndex(h => cfg.re.test(h));
                        if (colIdx >= 0) {
                            parsePeopleTokens(row[colIdx]).forEach(p => {
                                addOrEnrich({
                                    account: p.account,
                                    name: p.name,
                                    bu,
                                    customerGroup,
                                    role: explicitRole || cfg.role,
                                    attendance: 'Attend on Time'
                                }, {
                                    source: 'meeting',
                                    sourceName: '会议考勤快照',
                                    snapshotTitle: snapshot.title || '会议考勤快照',
                                    sheetName: sheet.sheetName || 'RFC 相关记录',
                                    rowNumber: rIdx + 1,
                                    field: `${cfg.role}${explicitRole ? ` (匹配角色: ${explicitRole})` : ''}`,
                                    raw: `${p.name} ${p.account}`.trim()
                                });
                            });
                        }
                    });
                } else if (isWfm) {
                    wfmRoles.forEach(cfg => {
                        const colIdx = headers.findIndex(h => cfg.re.test(h));
                        if (colIdx >= 0) {
                            parsePeopleTokens(row[colIdx]).forEach(p => {
                                addOrEnrich({
                                    account: p.account,
                                    name: p.name,
                                    bu,
                                    customerGroup,
                                    role: explicitRole || cfg.role,
                                    attendance: 'Attend on Time'
                                }, {
                                    source: 'meeting',
                                    sourceName: '会议考勤快照',
                                    snapshotTitle: snapshot.title || '会议考勤快照',
                                    sheetName: sheet.sheetName || 'WFM 相关记录',
                                    rowNumber: rIdx + 1,
                                    field: `${cfg.role}${explicitRole ? ` (匹配角色: ${explicitRole})` : ''}`,
                                    raw: `${p.name} ${p.account}`.trim()
                                });
                            });
                        }
                    });
                } else {
                    // Generic row fallback
                    if (nameIdx >= 0 || idIdx >= 0) {
                        const name = nameIdx >= 0 ? String(row[nameIdx] || '').trim() : '';
                        const account = idIdx >= 0 ? String(row[idIdx] || '').trim() : '';
                        if (name || account) {
                            addOrEnrich({
                                account,
                                name,
                                bu,
                                customerGroup,
                                role: explicitRole || '',
                                attendance: 'Attend on Time'
                            }, {
                                source: 'meeting',
                                sourceName: '会议考勤快照',
                                snapshotTitle: snapshot.title || '会议考勤快照',
                                sheetName: sheet.sheetName || '明细表',
                                rowNumber: rIdx + 1,
                                field: explicitRole || '人员明细',
                                raw: `${name} ${account}`.trim()
                            });
                        }
                    }
                }
            });
        });
    }

    if (Array.isArray(snapshot.payload?.attendees) && snapshot.payload.attendees.length) {
        snapshot.payload.attendees.forEach(p => addOrEnrich(p));
    }

    // 专门针对“有工号、没真实姓名”的人员，主动扫描 QR 表（尤其是 Td、Td Fullname 以及 Apply 相关列）
    // 规则：工号去掉首字母 m（如 mWX1459632 -> WX1459632，m00665597 -> 00665597）在单元格中精准反查真实姓名
    const namelessAttendees = attendees.filter(a => {
        const id = a.account || a.staffId || a.id;
        if (!id) return false;
        const name = a.name;
        return !name || isStaffIdToken(name) || name === id || name === '—' || name === '-';
    });

    if (namelessAttendees.length > 0 && snapshot.payload && Array.isArray(snapshot.payload.sheets)) {
        const sortedSheets = [...snapshot.payload.sheets].sort((s1, s2) => {
            const isQr1 = s1.category === 'qr' || /qr.*记录|qr.*明细|\bqr\b/i.test(s1.sheetName || s1.name || s1.title || '');
            const isQr2 = s2.category === 'qr' || /qr.*记录|qr.*明细|\bqr\b/i.test(s2.sheetName || s2.name || s2.title || '');
            if (isQr1 && !isQr2) return -1;
            if (!isQr1 && isQr2) return 1;
            return 0;
        });

        for (const a of namelessAttendees) {
            const rawId = String(a.account || a.staffId || a.id || '').trim();
            if (!rawId) continue;
            const strippedM = rawId.replace(/^m/i, '');
            const withM = /^m/i.test(rawId) ? rawId : ('m' + rawId);
            const digits = getDigits(rawId);
            const searchKeys = [...new Set([strippedM, rawId, withM, digits].filter(k => k && k.length >= 4))];

            let resolved = false;
            for (const sheet of sortedSheets) {
                if (!sheet || !Array.isArray(sheet.headers) || !Array.isArray(sheet.rows)) continue;
                const sheetName = String(sheet.sheetName || sheet.name || sheet.title || '');
                if (/三类合并人员备用名单|Combined.*People List/i.test(sheetName)) continue;

                const headers = sheet.headers.map(h => String(h || '').trim());
                const tdNameIdx = headers.findIndex(h => /td\s*(full)?\s*name/i.test(h));
                const tdIdIdx = headers.findIndex(h => /^(td|td\s*(account|id|accountid|工号)|td\s*[(（].*?[)）])$/i.test(h));
                const applyNameIdx = headers.findIndex(h => /apply\s*(full)?\s*name/i.test(h));
                const applyIdIdx = headers.findIndex(h => /apply\s*(account|id|accountid|工号)/i.test(h));

                for (let rIdx = 0; rIdx < sheet.rows.length; rIdx++) {
                    const row = sheet.rows[rIdx];
                    if (!row) continue;

                    // 1. Check TD columns
                    const tdNameCell = tdNameIdx >= 0 ? row[tdNameIdx] : '';
                    const tdIdCell = tdIdIdx >= 0 ? row[tdIdIdx] : '';
                    let found = extractNameForStaffIdFromCells(tdNameCell, tdIdCell, searchKeys);
                    let field = 'TD (Td/Td Fullname 姓名反查)';

                    // 2. Check Apply columns
                    if (!found) {
                        const applyNameCell = applyNameIdx >= 0 ? row[applyNameIdx] : '';
                        const applyIdCell = applyIdIdx >= 0 ? row[applyIdIdx] : '';
                        found = extractNameForStaffIdFromCells(applyNameCell, applyIdCell, searchKeys);
                        field = '申请人 (Apply 姓名反查)';
                    }

                    if (found && found.name) {
                        a.name = preferCanonicalName(a.name, found.name);
                        if (found.canonicalId) {
                            const bestId = preferCanonicalStaffId(a.staffId, found.canonicalId);
                            a.staffId = bestId;
                            a.account = bestId;
                            a.id = bestId;
                        }
                        const norm = normName(a.name);
                        if (norm) attByName.set(norm, a);
                        attByName.set(a.name.toLowerCase(), a);
                        const sid = a.staffId.toLowerCase();
                        attById.set(sid, a);
                        if (sid.startsWith('m')) attById.set(sid.slice(1), a);
                        else attById.set('m' + sid, a);
                        const num = getDigits(sid);
                        if (num) attById.set('digits:' + num, a);

                        if (!Array.isArray(a.sourceTraces)) a.sourceTraces = [];
                        a.sourceTraces.push({
                            source: 'meeting',
                            sourceName: '会议考勤快照',
                            snapshotTitle: snapshot.title || '会议考勤快照',
                            sheetName: sheet.sheetName || 'QR 相关记录',
                            rowNumber: rIdx + 1,
                            field,
                            raw: `${found.name} ${found.canonicalId || searchKeys[0]}`.trim()
                        });
                        resolved = true;
                        break;
                    }
                }
                if (resolved) break;
            }
        }
    }

    return attendees;
}

function isAttendanceAnomaly(att) {
    if (!att) return false;
    const s = String(att).trim().toLowerCase();
    if (s === 'attend on time' || s === '准时出席' || s === 'on time' || s === '正常') return false;
    return s.includes('absent') || s.includes('delay') || s.includes('fake') || s.includes('缺席') || s.includes('迟到') || s.includes('假打卡');
}

function getSnapshotAttendanceRecords(snapshot) {
    const perSession = snapshot.summary?.sessionAttendees;
    return Array.isArray(perSession) && perSession.length ? perSession : getSnapshotAttendees(snapshot);
}

function makeAttendanceCheckItem(snapshot, match, queryId, queryName) {
    const rawAtt = match.attendance || match.status || 'Attend on Time';
    const attLower = String(rawAtt).toLowerCase();
    const issueType = (attLower.includes('absent') || rawAtt.includes('缺席')) ? 'absent' : 'delay';
    const snapshotDate = snapshot.meetingDate || snapshot.meeting_date || '';
    const actualDate = match.date || match.actualDate || (match.attendanceTime && match.attendanceTime.match(/\d{4}-\d{2}-\d{2}/)?.[0]) || (match.reason && match.reason.match(/\d{4}-\d{2}-\d{2}/)?.[0]) || (snapshot.title && snapshot.title.match(/\b(20\d\d[-_/.](?:0?[1-9]|1[0-2])[-_/.](?:0?[1-9]|[12]\d|3[01]))\b/)?.[1]?.replace(/[/_.]/g, '-')) || snapshotDate;
    return {
        snapshotId: snapshot.id || snapshot.snapshotId,
        title: snapshot.title,
        meetingTitle: snapshot.title,
        snapshotTitle: snapshot.title,
        sessionName: match.sessionName || '',
        meetingDate: actualDate || snapshotDate,
        actualDate: actualDate || snapshotDate,
        attendanceDate: actualDate || snapshotDate,
        attendanceTime: match.attendanceTime || '',
        attendance: rawAtt,
        type: issueType,
        name: match.name || queryName,
        account: match.account || match.staffId || queryId,
        staffId: match.account || match.staffId || queryId,
        bu: match.bu || match.businessUnit || '',
        businessUnit: match.bu || match.businessUnit || '',
        customerGroup: match.customerGroup || ''
    };
}

async function checkPersonAttendance({ staffId, name }) {
    await ensureReady();
    const queryId = String(staffId || '').trim();
    const queryName = String(name || '').trim();
    if (!queryId && !queryName) {
        return { found: false, hasRecords: false, hasAnomaly: false, records: [], anomalies: [], cleanCount: 0, anomalyCount: 0, totalMeetingsChecked: 0 };
    }

    const snapshots = await listSnapshots({ includePayload: true, latestPerMonth: true });
    const records = [];
    const anomalies = [];
    let cleanCount = 0;
    let anomalyCount = 0;

    for (const snap of snapshots) {
        const matches = getSnapshotAttendanceRecords(snap).filter(p => matchPerson(p, queryId, queryName));
        for (const match of matches) {
            const item = makeAttendanceCheckItem(snap, match, queryId, queryName);
            records.push(item);
            if (isAttendanceAnomaly(item.attendance)) {
                anomalies.push(item);
                anomalyCount++;
            } else {
                cleanCount++;
            }
        }
    }

    return {
        found: records.length > 0,
        hasRecords: records.length > 0,
        hasAnomaly: anomalies.length > 0,
        cleanCount,
        anomalyCount,
        anomalies,
        records,
        totalMeetingsChecked: records.length
    };
}

async function batchCheckAttendance(persons = []) {
    await ensureReady();
    if (!Array.isArray(persons) || !persons.length) return {};
    const snapshots = await listSnapshots({ includePayload: false, latestPerMonth: true });

    const getDigits = s => {
        const d = String(s || '').replace(/^[a-z]+/i, '').trim();
        return d.length >= 5 ? d : '';
    };

    const snapshotAttendeesList = [];
    for (const s of snapshots) {
        let snapToUse = s;
        if (!Array.isArray(s.summary?.attendees) || !s.summary.attendees.length) {
            try {
                const full = await getSnapshot(s.id);
                if (full) snapToUse = full;
            } catch (_) {}
        }
        const attendees = getSnapshotAttendanceRecords(snapToUse);
        const attById = new Map();
        const attByName = new Map();
        const addToIndex = (index, key, attendee) => {
            if (!key) return;
            if (!index.has(key)) index.set(key, []);
            index.get(key).push(attendee);
        };
        for (const a of attendees) {
            const aid = String(a.account || a.staffId || a.id || '').trim().toLowerCase();
            const aname = String(a.name || '').trim().toLowerCase();
            if (aid) {
                addToIndex(attById, aid, a);
                if (aid.startsWith('m')) addToIndex(attById, aid.slice(1), a);
                const digits = getDigits(aid);
                if (digits && digits !== aid) addToIndex(attById, digits, a);
            }
            addToIndex(attByName, aname, a);
        }
        snapshotAttendeesList.push({
            snapshotId: snapToUse.id,
            title: snapToUse.title,
            meetingDate: snapToUse.meetingDate || snapToUse.meeting_date || '',
            attendees,
            attById,
            attByName
        });
    }

    const result = {};
    for (const p of persons) {
        const key = `${p.staffId || ''}|${p.name || ''}`;
        const queryId = String(p.staffId || '').trim();
        const queryName = String(p.name || '').trim();
        if (!queryId && !queryName) {
            result[key] = { found: false, hasRecords: false, hasAnomaly: false, cleanCount: 0, anomalyCount: 0, anomalies: [], records: [] };
            continue;
        }

        const records = [];
        const anomalies = [];
        let cleanCount = 0;
        let anomalyCount = 0;

        for (const snap of snapshotAttendeesList) {
            const candidates = new Set();
            if (queryId) {
                const qId = queryId.toLowerCase();
                for (const id of [qId, qId.startsWith('m') ? qId.slice(1) : 'm' + qId, getDigits(qId)]) {
                    for (const attendee of snap.attById.get(id) || []) candidates.add(attendee);
                }
            }
            if (queryName) {
                for (const attendee of snap.attByName.get(queryName.toLowerCase()) || []) candidates.add(attendee);
            }
            const indexedMatches = [...candidates].filter(a => matchPerson(a, queryId, queryName));
            const matches = indexedMatches.length ? indexedMatches : snap.attendees.filter(a => matchPerson(a, queryId, queryName));

            for (const match of matches) {
                const item = makeAttendanceCheckItem(snap, match, queryId, queryName);
                records.push(item);
                if (isAttendanceAnomaly(item.attendance)) {
                    anomalies.push(item);
                    anomalyCount++;
                } else {
                    cleanCount++;
                }
            }
        }

        result[key] = {
            found: records.length > 0,
            hasRecords: records.length > 0,
            hasAnomaly: anomalies.length > 0,
            cleanCount,
            anomalyCount,
            anomalies,
            records,
            totalMeetingsChecked: records.length
        };
    }
    return result;
}

function normName(str) {
    if (!str) return '';
    return String(str).replace(/[\(（].*?[\)）]/g, '').replace(/[\/\\].*$/, '').replace(/\s+/g, '').trim().toLowerCase();
}

function isChinese(str) {
    return /[\u4e00-\u9fa5]/.test(String(str || ''));
}

function preferCanonicalName(n1, n2) {
    const s1 = String(n1 || '').trim();
    const s2 = String(n2 || '').trim();
    if (!s1) return s2;
    if (!s2) return s1;
    if (s1 === s2) return s1;

    // 1. 真实姓名绝对优于工号 Token
    const isId1 = isStaffIdToken(s1) || (/^[A-Za-z0-9_-]{4,10}$/.test(s1) && /\d{3,}/.test(s1));
    const isId2 = isStaffIdToken(s2) || (/^[A-Za-z0-9_-]{4,10}$/.test(s2) && /\d{3,}/.test(s2));
    if (isId1 && !isId2) return s2;
    if (!isId1 && isId2) return s1;
    if (isId1 && isId2) return preferCanonicalStaffId ? preferCanonicalStaffId(s1, s2) : s1;

    // 2. 中文姓名优于非中文
    if (isChinese(s1) && !isChinese(s2)) return s1;
    if (isChinese(s2) && !isChinese(s1)) return s2;

    // 3. 不带括号的纯姓名优于带括号（如包含标注/角色）的姓名
    const hasBracket1 = /[\(（]/.test(s1);
    const hasBracket2 = /[\(（]/.test(s2);
    if (!hasBracket1 && hasBracket2) return s1;
    if (!hasBracket2 && hasBracket1) return s2;

    // 4. 外文多词完整姓名优于单词或残缺名（如 "Ahmed Helmy" 优于 "Ahmed"）
    const words1 = s1.split(/\s+/).filter(Boolean);
    const words2 = s2.split(/\s+/).filter(Boolean);
    if (!isChinese(s1) && !isChinese(s2)) {
        if (words1.length !== words2.length) {
            return words1.length > words2.length ? s1 : s2;
        }
    }

    return s1.length <= s2.length ? s1 : s2;
}

async function extractRoster() {
    await ensureReady();
    const snapshots = await listSnapshots({ includePayload: true });
    const rosterMap = new Map();
    const candById = new Map();
    const candByDigits = new Map();
    const candByName = new Map();

    const getDigits = s => {
        const d = String(s || '').replace(/^[a-z]+/i, '').trim();
        return d.length >= 5 ? d : '';
    };

    const registerCandidate = (c) => {
        if (c.staffId) {
            const sid = c.staffId.toLowerCase();
            candById.set(sid, c);
            if (sid.startsWith('m')) candById.set(sid.slice(1), c);
            const digits = getDigits(sid);
            if (digits) candByDigits.set(digits, c);
        }
        if (c.id && c.id !== c.staffId) {
            const cid = c.id.toLowerCase();
            candById.set(cid, c);
            if (cid.startsWith('m')) candById.set(cid.slice(1), c);
            const digits = getDigits(cid);
            if (digits) candByDigits.set(digits, c);
        }
        if (c.name) {
            const norm = normName(c.name);
            if (norm) {
                if (!candByName.has(norm)) candByName.set(norm, []);
                const list = candByName.get(norm);
                if (!list.includes(c)) list.push(c);
            }
            const lowerName = c.name.trim().toLowerCase();
            if (lowerName) {
                if (!candByName.has(lowerName)) candByName.set(lowerName, []);
                const list = candByName.get(lowerName);
                if (!list.includes(c)) list.push(c);
            }
        }
    };

    const findExisting = (id, name) => {
        if (id) {
            const sid = id.toLowerCase();
            let c = candById.get(sid);
            if (!c && sid.startsWith('m')) {
                c = candById.get(sid.slice(1));
            }
            if (!c) {
                c = candById.get('m' + sid);
            }
            if (!c) {
                const digits = getDigits(sid);
                if (digits) c = candByDigits.get(digits);
            }
            if (c) return c;
        }

        if (name) {
            const norm = normName(name);
            const candidates = (norm && candByName.get(norm)) || candByName.get(name.trim().toLowerCase());
            if (candidates && candidates.length) {
                for (const c of candidates) {
                    if (!id || !c.staffId || areStaffIdsEquivalent(id, c.staffId)) {
                        return c;
                    }
                }
            }
        }
        return null;
    };

    for (const snap of snapshots) {
        const attendees = getSnapshotAttendees(snap);
        for (const a of attendees) {
            let id = String(a.account || a.staffId || a.id || '').trim();
            let name = String(a.name || '').trim();
            if (name && isStaffIdToken(name) && areStaffIdsEquivalent(name, id)) name = '';
            id = normalizeStaffId(id);
            if (isInvalidStaffId(id)) {
                id = '';
            }
            if (isOrderNumber(name)) {
                name = '';
            }
            if (!id && !name) continue;
            if (isTotalRow(id, name)) continue;

            const existingEntry = findExisting(id, name);
            const snapTitle = snap.title || '';
            const snapDate = snap.meetingDate || snap.meeting_date || '';
            const isPm = /^\s*pm\s*$/i.test(a.role || '');
            const resolvedBu = isPm ? 'PMO' : (a.bu || a.businessUnit || '');

            const traces = Array.isArray(a.sourceTraces) ? [...a.sourceTraces] : [];
            if (!existingEntry) {
                const key = id ? id.toLowerCase() : name.toLowerCase();
                const cGroups = Array.isArray(a.customerGroups) && a.customerGroups.length ? [...a.customerGroups] : (a.customerGroup ? [a.customerGroup] : []);
                const rRoles = Array.isArray(a.roles) && a.roles.length ? [...a.roles] : (a.role ? [a.role] : []);
                const newEntry = {
                    id: id || name,
                    staffId: id || '',
                    name,
                    bu: resolvedBu,
                    businessUnit: resolvedBu,
                    customerGroup: cGroups.join(', ') || a.customerGroup || '',
                    customerGroups: cGroups,
                    role: rRoles.join(', ') || a.role || '',
                    roles: rRoles,
                    source: 'meeting',
                    sourceType: 'meeting',
                    snapshotTitle: snapTitle,
                    snapshotTitles: snapTitle ? [snapTitle] : [],
                    snapshotDate: snapDate,
                    meetingDates: snapDate ? [snapDate] : [],
                    sourceTraces: traces
                };
                rosterMap.set(key, newEntry);
                registerCandidate(newEntry);
            } else {
                const canonicalId = preferCanonicalStaffId(existingEntry.staffId, id);
                if (canonicalId && canonicalId !== existingEntry.staffId) {
                    existingEntry.staffId = canonicalId;
                    existingEntry.id = canonicalId;
                    rosterMap.set(canonicalId.toLowerCase(), existingEntry);
                    registerCandidate(existingEntry);
                }
                if ((!existingEntry.name || isStaffIdToken(existingEntry.name) || existingEntry.name === existingEntry.staffId) && name && !isStaffIdToken(name)) {
                    existingEntry.name = name;
                    registerCandidate(existingEntry);
                } else if (name) {
                    const prevName = existingEntry.name;
                    existingEntry.name = preferCanonicalName(existingEntry.name, name);
                    if (existingEntry.name !== prevName) {
                        registerCandidate(existingEntry);
                    }
                }

                // Accumulate customer groups
                if (!Array.isArray(existingEntry.customerGroups)) {
                    existingEntry.customerGroups = existingEntry.customerGroup ? [existingEntry.customerGroup] : [];
                }
                const newGroups = Array.isArray(a.customerGroups) && a.customerGroups.length ? a.customerGroups : (a.customerGroup ? [a.customerGroup] : []);
                for (const g of newGroups) {
                    if (g && !existingEntry.customerGroups.includes(g)) {
                        existingEntry.customerGroups.push(g);
                    }
                }
                existingEntry.customerGroup = existingEntry.customerGroups.join(', ');

                // Accumulate roles
                if (!Array.isArray(existingEntry.roles)) {
                    existingEntry.roles = existingEntry.role ? [existingEntry.role] : [];
                }
                const newRoles = Array.isArray(a.roles) && a.roles.length ? a.roles : (a.role ? [a.role] : []);
                for (const r of newRoles) {
                    if (r && !existingEntry.roles.includes(r)) {
                        existingEntry.roles.push(r);
                    }
                }
                existingEntry.role = existingEntry.roles.join(', ');

                // BU remains singular: if any role is PM, BU is PMO
                const anyPm = isPm || existingEntry.roles.some(r => /^\s*pm\s*$/i.test(r));
                if (anyPm) {
                    existingEntry.bu = 'PMO';
                    existingEntry.businessUnit = 'PMO';
                } else if (!existingEntry.bu && resolvedBu) {
                    existingEntry.bu = resolvedBu;
                    existingEntry.businessUnit = resolvedBu;
                }

                if (snapTitle && !existingEntry.snapshotTitles.includes(snapTitle)) existingEntry.snapshotTitles.push(snapTitle);
                if (snapDate && !existingEntry.meetingDates.includes(snapDate)) existingEntry.meetingDates.push(snapDate);

                if (traces.length) {
                    if (!Array.isArray(existingEntry.sourceTraces)) existingEntry.sourceTraces = [];
                    for (const t of traces) {
                        if (!existingEntry.sourceTraces.some(et => et.snapshotTitle === t.snapshotTitle && et.rowNumber === t.rowNumber && et.field === t.field)) {
                            existingEntry.sourceTraces.push(t);
                        }
                    }
                }
            }
        }
    }

    // 最终唯一性收敛：同姓名记录强制聚合，优先保留非空工号
    const converged = [];
    const convById = new Map();
    const convByName = new Map();

    for (const cand of rosterMap.values()) {
        const sid = String(cand.staffId || '').trim();
        const nm = String(cand.name || '').trim();
        const norm = normName(nm);

        let target = null;
        if (sid) {
            target = convById.get(sid.toLowerCase());
            if (!target) {
                const digits = getDigits(sid);
                if (digits) target = convById.get('digits:' + digits);
            }
        }
        if (!target && norm) {
            target = convByName.get(norm);
        }

        if (!target) {
            target = { ...cand };
            converged.push(target);
            if (sid) {
                convById.set(sid.toLowerCase(), target);
                const digits = getDigits(sid);
                if (digits) convById.set('digits:' + digits, target);
            }
            if (norm) convByName.set(norm, target);
        } else {
            const canonicalId = preferCanonicalStaffId(target.staffId, sid);
            if (canonicalId) {
                target.staffId = canonicalId;
                target.id = canonicalId;
                convById.set(canonicalId.toLowerCase(), target);
                const digits = getDigits(canonicalId);
                if (digits) convById.set('digits:' + digits, target);
            }
            if ((!target.name || isStaffIdToken(target.name) || target.name === target.staffId) && nm && !isStaffIdToken(nm)) {
                target.name = nm;
            } else {
                target.name = preferCanonicalName(target.name, nm);
            }
            const targetNorm = normName(target.name);
            if (targetNorm) convByName.set(targetNorm, target);

            // Merge customer groups
            if (!Array.isArray(target.customerGroups)) target.customerGroups = target.customerGroup ? [target.customerGroup] : [];
            const newGroups = Array.isArray(cand.customerGroups) && cand.customerGroups.length ? cand.customerGroups : (cand.customerGroup ? [cand.customerGroup] : []);
            for (const g of newGroups) {
                if (g && !target.customerGroups.includes(g)) target.customerGroups.push(g);
            }
            target.customerGroup = target.customerGroups.join(', ');

            // Merge roles
            if (!Array.isArray(target.roles)) target.roles = target.role ? [target.role] : [];
            const newRoles = Array.isArray(cand.roles) && cand.roles.length ? cand.roles : (cand.role ? [cand.role] : []);
            for (const r of newRoles) {
                if (r && !target.roles.includes(r)) target.roles.push(r);
            }
            target.role = target.roles.join(', ');

            if (target.roles.some(r => /^\s*pm\s*$/i.test(r))) {
                target.bu = 'PMO';
                target.businessUnit = 'PMO';
            } else if (!target.bu && cand.bu) {
                target.bu = cand.bu;
                target.businessUnit = cand.bu;
            }

            cand.snapshotTitles?.forEach(t => { if (!target.snapshotTitles.includes(t)) target.snapshotTitles.push(t); });
            cand.meetingDates?.forEach(d => { if (!target.meetingDates.includes(d)) target.meetingDates.push(d); });

            if (Array.isArray(cand.sourceTraces)) {
                if (!Array.isArray(target.sourceTraces)) target.sourceTraces = [];
                for (const t of cand.sourceTraces) {
                    if (!target.sourceTraces.some(et => et.snapshotTitle === t.snapshotTitle && et.rowNumber === t.rowNumber && et.field === t.field)) {
                        target.sourceTraces.push(t);
                    }
                }
            }
        }
    }

    return converged.sort((a, b) => (a.staffId || a.id || '').localeCompare(b.staffId || b.id || ''));
}

const ROSTER_KV_CATEGORY = 'meeting_attendance';
const ROSTER_KV_KEY = 'roster_settings';

async function getRosterSettings() {
    await ensureReady();
    const defaultVal = {
        mandatoryAttendees: [],
        exemptions: [],
        updatedAt: null
    };
    const settings = await readKV(ROSTER_KV_CATEGORY, ROSTER_KV_KEY, defaultVal);
    return {
        mandatoryAttendees: Array.isArray(settings?.mandatoryAttendees) ? settings.mandatoryAttendees : [],
        exemptions: Array.isArray(settings?.exemptions) ? settings.exemptions : [],
        updatedAt: settings?.updatedAt || null
    };
}

async function saveRosterSettings({ mandatoryAttendees, exemptions } = {}) {
    await ensureReady();
    const current = await getRosterSettings();
    const updated = {
        mandatoryAttendees: Array.isArray(mandatoryAttendees) ? mandatoryAttendees : current.mandatoryAttendees,
        exemptions: Array.isArray(exemptions) ? exemptions : current.exemptions,
        updatedAt: new Date().toISOString()
    };
    await writeKV(ROSTER_KV_CATEGORY, ROSTER_KV_KEY, updated);
    return updated;
}

module.exports = {
    ensureReady,
    listSnapshots,
    getSnapshot,
    saveSnapshot,
    renameSnapshot,
    deleteSnapshot,
    checkPersonAttendance,
    batchCheckAttendance,
    extractRoster,
    preferCanonicalStaffId,
    cleanNameAndStaffId,
    areStaffIdsEquivalent,
    getRosterSettings,
    saveRosterSettings
};

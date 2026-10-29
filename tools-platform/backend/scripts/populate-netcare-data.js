// tools-platform/backend/scripts/populate-netcare-data.js
// 填充 netcare 全量 441 张表 + 源表视图 + 应用表数据到 report.db
const fs = require('fs');
const path = require('path');
const sqlite3 = require('../../node_modules/sqlite3');

const REPORT_DB_PATH = path.resolve(__dirname, '../../data/report.db');
const BACKEND_REPORT_DB_PATH = path.resolve(__dirname, '../data/report.db');
const REQ_DB_PATH = path.resolve(__dirname, '../data/requirements.db');
const SEED_PATH = path.resolve(__dirname, '../models/digital-human/netcare-table-seed.json');
const TABLE_MAP_PATH = path.resolve(__dirname, '../data/hosted-apps/aiops-report/app/static/data/table_map.json');
const INIT_SQLITE_PATH = path.resolve(__dirname, '../data/hosted-apps/aiops-report/app/db/init.sqlite.sql');

function openDb(file) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(file, err => (err ? reject(err) : resolve(db)));
    });
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(new Error(`${err.message} in: ${sql.slice(0, 120)}`));
            else resolve(this);
        });
    });
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
}

function exec(db, sql) {
    return new Promise((resolve, reject) => {
        db.exec(sql, err => (err ? reject(err) : resolve()));
    });
}

async function main() {
    console.log('1. Reading seed, table_map, and requirements...');
    const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
    const tableMap = JSON.parse(fs.readFileSync(TABLE_MAP_PATH, 'utf8'));
    const reqDb = await openDb(REQ_DB_PATH);

    // Extract Req 30 headers and rows
    const req30Row = await all(reqDb, 'SELECT description FROM Requirements WHERE id = 30');
    let req30Headers = [], req30Data = [];
    if (req30Row && req30Row[0]) {
        const lines = req30Row[0].description.trim().split('\n');
        req30Headers = lines[0].split('\t').map(h => h.trim()).filter(Boolean);
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.startsWith('帮我分析')) continue;
            const vals = line.split('\t');
            if (vals.length >= req30Headers.length - 2) {
                const obj = {};
                req30Headers.forEach((h, idx) => { obj[h] = vals[idx] !== undefined ? vals[idx].trim() : ''; });
                req30Data.push(obj);
            }
        }
    }
    console.log(`Req 30: ${req30Headers.length} headers, ${req30Data.length} sample rows`);

    // Extract Req 143 section 4.2 table samples
    const req143Row = await all(reqDb, 'SELECT description FROM Requirements WHERE id = 143');
    const req143Samples = {};
    if (req143Row && req143Row[0]) {
        const text = req143Row[0].description;
        const s = text.indexOf('### 4.2');
        const e = text.indexOf('## 5.', s);
        if (s > 0) {
            const section = text.slice(s, e > 0 ? e : s + 20000);
            const items = section.split('\n- **`').slice(1);
            for (const item of items) {
                const tableName = item.split('`**')[0].trim().toLowerCase();
                const afterColon = item.split('）：')[1] || '';
                const firstLine = afterColon.split('\n')[0].trim();
                const pairs = firstLine.split('，');
                const sampleObj = {};
                for (const pair of pairs) {
                    const eqIdx = pair.indexOf('=');
                    if (eqIdx > 0) {
                        const k = pair.slice(0, eqIdx).trim();
                        const v = pair.slice(eqIdx + 1).trim();
                        sampleObj[k] = v;
                    }
                }
                if (Object.keys(sampleObj).length) {
                    req143Samples[tableName] = sampleObj;
                }
            }
        }
    }
    console.log(`Req 143: ${Object.keys(req143Samples).length} table samples extracted`);
    await new Promise(r => reqDb.close(r));

    // Open target report.db
    console.log(`2. Connecting to ${REPORT_DB_PATH}...`);
    const db = await openDb(REPORT_DB_PATH);
    await run(db, 'PRAGMA journal_mode = WAL');
    await run(db, 'PRAGMA synchronous = NORMAL');

    // Regions and RepOffices reference data
    const REGIONS = [
        { code: '26902', nameCn: '北部非洲地区部', nameEn: 'Northern Africa Region', repCode: '26921', repNameCn: '埃及代表处', repNameEn: 'Egypt Rep Office', country: '埃及', countryCode: 'EG', countryArea: 'EG' },
        { code: '027425', nameCn: '中国地区部', nameEn: 'China Region', repCode: '028145', repNameCn: '广西代表处', repNameEn: 'Guangxi Rep Office, CN', country: '中国', countryCode: 'CN', countryArea: 'CN-45' },
        { code: '027425', nameCn: '中国地区部', nameEn: 'China Region', repCode: '028031', repNameCn: '湖北代表处', repNameEn: 'Hubei Rep Office, CN', country: '中国', countryCode: 'CN', countryArea: 'CN-42' },
        { code: '050133', nameCn: '亚太地区部', nameEn: 'Asia Pacific Region', repCode: '026356', repNameCn: '香港代表处', repNameEn: 'Hong Kong Rep Office', country: '中国香港', countryCode: 'HK', countryArea: 'HK' },
        { code: '050133', nameCn: '亚太地区部', nameEn: 'Asia Pacific Region', repCode: '026371', repNameCn: '泰国代表处', repNameEn: 'Thailand Rep Office', country: '泰国', countryCode: 'TH', countryArea: 'TH' },
        { code: '071217', nameCn: '欧洲地区部', nameEn: 'Europe Region', repCode: '024989', repNameCn: '德国代表处', repNameEn: 'Germany Rep Office', country: '德国', countryCode: 'DE', countryArea: 'DE' },
        { code: '024932', nameCn: '中东地区部', nameEn: 'Middle East Region', repCode: '024932', repNameCn: '阿联酋代表处', repNameEn: 'UAE Rep Office', country: '阿联酋', countryCode: 'AE', countryArea: 'AE' }
    ];

    const PRODUCTS = [
        { name: 'OptiX OSN 9800 M24', line: '光传输', map: 'optical_network', category: '波分传输' },
        { name: 'OptiX OSN 8800', line: '光传输', map: 'optical_network', category: '波分传输' },
        { name: 'NetEngine 8000 X8', line: '数据通信', map: 'data_communication', category: '路由器' },
        { name: 'CloudEngine 16800', line: '数据通信', map: 'data_communication', category: '数据中心交换机' },
        { name: 'OceanStor Dorado 8000', line: '数据存储', map: 'data_storage', category: '全闪存存储' },
        { name: 'AirEngine 9700-M1', line: '企业无线', map: 'wireless', category: '无线控制器' },
        { name: 'CloudCampus 3.0', line: '云核心网', map: 'cloud_core_network', category: '园区核心' }
    ];

    const CUSTOMERS = [
        { name: 'Telecom Egypt', nameCn: '埃及电信', number: '1000005969' },
        { name: 'Vodafone Egypt', nameCn: '沃达丰埃及', number: '1000019373' },
        { name: 'China Telecom', nameCn: '中国电信', number: '1000012641' },
        { name: 'China Mobile', nameCn: '中国移动', number: '1000226065' },
        { name: 'AIS Thailand', nameCn: '泰国AIS', number: '1000005804' },
        { name: 'Deutsche Telekom', nameCn: '德国电信', number: '1000033891' }
    ];

    const SEVERITIES = ['Critical', 'Major', 'Minor', 'Warning'];
    const STATUSES = ['Closed', 'Resolved', 'In Progress', 'Completed'];

    // ── 3. Populate SR Problem Detail (nc_op_sa_sr_problem_detail_all_bg_ofr_dwd & nc_op_sa_sr_problem_detail_all_bg_dwd) ──
    const srTables = ['nc_op_sa_sr_problem_detail_all_bg_ofr_dwd', 'nc_op_sa_sr_problem_detail_all_bg_dwd'];
    for (const tName of srTables) {
        console.log(`Creating table: ${tName} with ${req30Headers.length} columns...`);
        await run(db, `DROP TABLE IF EXISTS \`${tName}\``);
        const colDefs = ['id INTEGER PRIMARY KEY AUTOINCREMENT', ...req30Headers.map(h => `\`${h}\` TEXT`)].join(', ');
        await run(db, `CREATE TABLE \`${tName}\` (${colDefs})`);

        // Prepare insert statement
        const placeholders = req30Headers.map(() => '?').join(', ');
        const insertSql = `INSERT INTO \`${tName}\` (${req30Headers.map(h => `\`${h}\``).join(', ')}) VALUES (${placeholders})`;

        // Insert Req 30 sample rows
        for (const r of req30Data) {
            const vals = req30Headers.map(h => r[h] ?? '');
            await run(db, insertSql, vals);
        }

        // Generate 25 additional rich test rows
        for (let i = 1; i <= 25; i++) {
            const reg = REGIONS[i % REGIONS.length];
            const prod = PRODUCTS[i % PRODUCTS.length];
            const cust = CUSTOMERS[i % CUSTOMERS.length];
            const sev = SEVERITIES[i % SEVERITIES.length];
            const st = STATUSES[i % STATUSES.length];
            const monthIdx = (i % 6) + 5; // May-26 ~ Oct-26
            const monthStr = `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][monthIdx - 1]}-26`;
            const dateStr = `2026-${String(monthIdx).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`;
            const srId = `SR2026${String(monthIdx).padStart(2, '0')}${String(i).padStart(4, '0')}`;

            const row = {
                hw_sev_name: sev,
                pdt: prod.category,
                subnet: `${cust.nameCn} 核心承载网`,
                problem_summary: `[${prod.name}] 核心节点 ${sev === 'Critical' ? '业务倒换/丢包异常' : '接口告警波动'} 排查处理`,
                sr_tac: `${reg.country} TAC`,
                esc_to_pse_org: 'China GTAC',
                customer_region: reg.nameEn,
                channel_code: i % 2 === 0 ? 'WEB' : 'EMAIL',
                branch: `${cust.nameCn}系统部`,
                product_number: `PRD-${100000 + i}`,
                logged_by: `Engineer_${i} 00${100000 + i}`,
                product_class: prod.line,
                esc_to_rde_flag: 'N',
                sr_num: String(39240000 + i),
                open_date_month: monthStr,
                relation_num: String(39240000 + i),
                spdt: prod.line,
                esc_to_rde_assignee: '',
                sr_status_name: st,
                sus_exp_close_date: `${dateStr} 20:00:00`,
                esc_to_pse_flag: i % 3 === 0 ? 'Y' : 'N',
                open_date: `${dateStr} 09:30:00`,
                resolution_details: `[Problem Summary]: 链路抖动排查 [Solution]: 调整保护倒换阈值并重启主控板`,
                resolution_name_map: '网络设备维护',
                cur_assignee: `Support_Agent_${i}`,
                country_code: reg.countryCode,
                product_line: prod.line,
                network_id: `NET-${reg.countryCode}-${100 + i}`,
                start_er_date: `${dateStr} 10:00:00`,
                sr_group: `${reg.country}-All Product-FSE`,
                esc_to_pse_assignee: `PSE_${i}`,
                survey_date: dateStr,
                customer_industry_en_lv1: 'Carrier',
                open_date_year: '2026',
                inc_notify_flag: 'N',
                soft_entitlement: 'Standard Support',
                na_level: 'L3',
                bg: i % 4 === 0 ? 'EBG' : 'CNBG',
                customer_number: cust.number,
                resolution_name: '设备配置调整与固件升级',
                esc_to_manager_flag: 'N',
                act_close_date: `${dateStr} 18:45:00`,
                sr_owner: `Owner_${i}`,
                customer_office: reg.repNameEn,
                customer_industry_cn_lv1: '运营商',
                check_contract_result: 'Valid Contract',
                urgency: sev === 'Critical' ? 'Immediate' : 'Normal',
                esc_to_rde_group: '',
                repoffice_code: reg.repCode,
                country_name: reg.country,
                t1_operator: 'Tier1_Ops',
                survey_total_score: '100',
                entitlement_type: 'Contract Service',
                esc_to_pse_group: 'GTAC Support Group',
                market_type: 'Enterprise/Carrier',
                urgency_flag: sev === 'Critical' ? 'Y' : 'N',
                product: prod.name,
                resolution_summary: '已通过路由策略调整与端口光模块更换闭环',
                product_line_map: prod.map,
                exp_close_date: `${dateStr} 19:00:00`,
                sr_id: srId,
                service_type: 'CS - Technical Request',
                sr_type: 'Technical Problem',
                product_category: prod.category,
                reporter_type: 'Customer',
                region_code: reg.code,
                customer_industry: '通信运营商',
                overdue: i % 5 === 0 ? '是' : '否',
                network_name: `${reg.countryCode}-${cust.name}-CoreNet`,
                country_name_cn: reg.country,
                country_name_en: reg.country,
                region_name: reg.nameCn,
                repoffice_name: reg.repNameCn,
                customer_name_cn: cust.nameCn,
                customer_name_en: cust.name,
                customer_name: cust.name,
                region_name_cn: reg.nameCn,
                region_name_en: reg.nameEn,
                repoffice_name_cn: reg.repNameCn,
                repoffice_name_en: reg.repNameEn,
                country_area_code: reg.countryArea,
                country_area_name_en: reg.country,
                country_area_name_cn: reg.country
            };

            const vals = req30Headers.map(h => row[h] ?? '');
            await run(db, insertSql, vals);
        }
        const count = (await all(db, `SELECT count(*) as c FROM \`${tName}\``))[0].c;
        console.log(`✓ ${tName}: populated ${count} rows`);
    }

    // ── 4. Populate all 441 NetCare tables ──
    console.log('3. Processing full 441 tables in netcare-table-seed...');
    let createdCount = 0, populatedCount = 0, emptyCount = 0;

    for (const [rawName, meta] of Object.entries(seed.tables)) {
        const name = rawName.toLowerCase();
        if (srTables.includes(name)) continue; // already created

        const isEmpty = meta.rows === 0 || meta.note?.includes('空表');
        const hasReqSample = req143Samples[name];

        // Determine column set (case-insensitive deduplication)
        const colMap = new Map();
        const addCol = (col) => {
            const lower = col.toLowerCase();
            if (!colMap.has(lower)) colMap.set(lower, lower);
        };

        ['id', 'task_id', 'did', 'sid', 's_id', 'nid', 'bg', 'region_code', 'region_name_cn', 'repoffice_code', 'repoffice_name_cn', 'customer_name', 'customer_number', 'product_line', 'product_line_map', 'product_name', 'network_id', 'network_name', 'status', 'period_month', 'period_date', 'create_time', 'update_time'].forEach(addCol);

        if (hasReqSample) {
            Object.keys(hasReqSample).forEach(addCol);
        }

        // Add category/grain specific columns
        if (meta.category?.includes('整改') || name.includes('rectif')) {
            ['nid_cn', 'title', 'check_cnt', 'check_complete_cnt', 'rectify_complete_rate'].forEach(addCol);
        } else if (meta.category?.includes('EOS') || meta.category?.includes('风险') || name.includes('risk') || name.includes('eos')) {
            ['risk_title', 'risk_level', 'risk_status', 'closed_rate', 'contingency_plan_completed_rate', 'version'].forEach(addCol);
        } else if (meta.category?.includes('变更') || meta.category?.includes('工单') || name.includes('rfc') || name.includes('work')) {
            ['rfc_no', 'work_order', 'ticket_id', 'bu', 'rfc_status', 'urgency', 'complete_time'].forEach(addCol);
        } else if (meta.category?.includes('告警') || name.includes('alarm')) {
            ['alarm_id', 'alarm_name', 'severity', 'bubble_id', 'clear_time', 'duration_min'].forEach(addCol);
        } else if (meta.category?.includes('巡检') || name.includes('health_check')) {
            ['hc_id', 'orderid', 'check_result', 'total_count', 'completed_count', 'complete_rate'].forEach(addCol);
        } else if (meta.category?.includes('License') || meta.category?.includes('证书') || name.includes('license') || name.includes('cert')) {
            ['cert_id', 'lsn', 'cert_name', 'expired_date', 'reduced_rate'].forEach(addCol);
        } else if (meta.category?.includes('公共') || name.includes('common_data')) {
            ['account_id', 'account_number', 'account_name', 'relation_id', 'product_key', 'rep_id', 'dept_code'].forEach(addCol);
        }

        const cols = Array.from(colMap.values());
        const colDefs = cols.map(c => (c === 'id' ? '`id` INTEGER PRIMARY KEY AUTOINCREMENT' : `\`${c}\` TEXT`)).join(', ');

        await run(db, `DROP TABLE IF EXISTS \`${name}\``);
        await run(db, `CREATE TABLE \`${name}\` (${colDefs})`);
        createdCount++;

        if (isEmpty) {
            emptyCount++;
            continue; // Keep empty (0 rows)
        }

        // Insert sample data
        const insertCols = cols.filter(c => c !== 'id');
        const placeholders = insertCols.map(() => '?').join(', ');
        const insertSql = `INSERT INTO \`${name}\` (${insertCols.map(c => `\`${c}\``).join(', ')}) VALUES (${placeholders})`;

        const numRows = Math.min(12, Math.max(5, Math.floor(Math.sqrt(meta.rows || 100))));
        const normalizedSample = {};
        if (hasReqSample) {
            Object.entries(hasReqSample).forEach(([k, v]) => { normalizedSample[k.toLowerCase()] = v; });
        }

        for (let i = 0; i < numRows; i++) {
            const reg = REGIONS[i % REGIONS.length];
            const prod = PRODUCTS[i % PRODUCTS.length];
            const cust = CUSTOMERS[i % CUSTOMERS.length];
            const st = STATUSES[i % STATUSES.length];
            const sev = SEVERITIES[i % SEVERITIES.length];
            const monthStr = `2026-0${(i % 3) + 7}`;
            const dateStr = `${monthStr}-${String((i % 25) + 1).padStart(2, '0')}`;

            const rowData = {};
            // If i === 0 and we have real sample from req 143, use it
            if (i === 0 && hasReqSample) {
                Object.assign(rowData, normalizedSample);
            }

            // Fill standard columns if not provided
            if (!rowData.task_id) rowData.task_id = `TASK_${10000 + i}`;
            if (!rowData.did) rowData.did = `DID_${name}_${100 + i}`;
            if (!rowData.sid) rowData.sid = `SID_${name}_${100 + i}`;
            if (!rowData.s_id) rowData.s_id = `SID_${100 + i}`;
            if (!rowData.nid) rowData.nid = `NID_${20000 + i}`;
            if (!rowData.bg) rowData.bg = i % 3 === 0 ? 'EBG' : 'CNBG';
            if (!rowData.region_code) rowData.region_code = reg.code;
            if (!rowData.region_name_cn) rowData.region_name_cn = reg.nameCn;
            if (!rowData.repoffice_code) rowData.repoffice_code = reg.repCode;
            if (!rowData.repoffice_name_cn) rowData.repoffice_name_cn = reg.repNameCn;
            if (!rowData.customer_name) rowData.customer_name = cust.name;
            if (!rowData.customer_number) rowData.customer_number = cust.number;
            if (!rowData.product_line) rowData.product_line = prod.line;
            if (!rowData.product_line_map) rowData.product_line_map = prod.map;
            if (!rowData.product_name) rowData.product_name = prod.name;
            if (!rowData.network_id) rowData.network_id = `NET-${reg.countryCode}-${100 + i}`;
            if (!rowData.network_name) rowData.network_name = `${reg.countryCode}-${cust.name}-Net`;
            if (!rowData.status) rowData.status = st;
            if (!rowData.period_month) rowData.period_month = monthStr;
            if (!rowData.period_date) rowData.period_date = dateStr;
            if (!rowData.create_time) rowData.create_time = `${dateStr} 10:00:00`;
            if (!rowData.update_time) rowData.update_time = `${dateStr} 18:00:00`;

            // Specific fill
            if (cols.includes('rectify_complete_rate') && !rowData.rectify_complete_rate) {
                rowData.rectify_complete_rate = (0.85 + (i * 0.015)).toFixed(3);
            }
            if (cols.includes('check_cnt') && !rowData.check_cnt) rowData.check_cnt = String(20 + i * 5);
            if (cols.includes('check_complete_cnt') && !rowData.check_complete_cnt) rowData.check_complete_cnt = String(18 + i * 5);
            if (cols.includes('closed_rate') && !rowData.closed_rate) {
                rowData.closed_rate = (0.90 + (i * 0.01)).toFixed(3);
            }
            if (cols.includes('contingency_plan_completed_rate') && !rowData.contingency_plan_completed_rate) {
                rowData.contingency_plan_completed_rate = '0.960';
            }
            if (cols.includes('reduced_rate') && !rowData.reduced_rate) rowData.reduced_rate = '0.985';
            if (cols.includes('complete_rate') && !rowData.complete_rate) rowData.complete_rate = '0.950';
            if (cols.includes('risk_level') && !rowData.risk_level) rowData.risk_level = sev;
            if (cols.includes('severity') && !rowData.severity) rowData.severity = sev;
            if (cols.includes('alarm_name') && !rowData.alarm_name) rowData.alarm_name = `${prod.name} 端口告警`;

            const vals = insertCols.map(c => (rowData[c] !== undefined ? String(rowData[c]) : ''));
            await run(db, insertSql, vals);
        }
        populatedCount++;
    }

    console.log(`✓ 441 tables finished: ${populatedCount} populated with test data, ${emptyCount} empty tables created.`);

    // ── 5. Upstream Source Tables Views from table_map.json ──
    console.log('4. Creating views for upstream source tables in table_map.json...');
    let viewCount = 0;
    const existingTables = new Set((await all(db, "SELECT name FROM sqlite_master WHERE type='table'")).map(r => r.name.toLowerCase()));

    for (const mod of tableMap.modules || []) {
        const landing = mod.landing_tables && mod.landing_tables[0];
        if (!landing) continue;
        const landingBase = landing.toLowerCase().split('.').pop();
        for (const src of mod.source_tables || []) {
            const srcBase = src.toLowerCase().split('.').pop();
            if (!existingTables.has(srcBase)) {
                try {
                    await run(db, `CREATE VIEW IF NOT EXISTS \`${srcBase}\` AS SELECT * FROM \`${landingBase}\``);
                    existingTables.add(srcBase);
                    viewCount++;
                } catch (e) {
                    console.warn(`View failed for ${srcBase}: ${e.message}`);
                }
            }
        }
    }
    console.log(`✓ Created ${viewCount} views for upstream source tables`);

    // ── 6. Ensure APP_TABLES exist in report.db ──
    console.log('5. Ensuring APP_TABLES exist in report.db...');
    if (fs.existsSync(INIT_SQLITE_PATH)) {
        const initSql = fs.readFileSync(INIT_SQLITE_PATH, 'utf8');
        await exec(db, initSql);
        console.log('✓ APP_TABLES initialized in report.db');
    }

    await new Promise(r => db.close(r));

    // ── 7. Copy to backend/data/report.db ──
    console.log(`6. Syncing to ${BACKEND_REPORT_DB_PATH}...`);
    fs.copyFileSync(REPORT_DB_PATH, BACKEND_REPORT_DB_PATH);
    console.log('✓ Both report.db instances synchronized successfully.');

    console.log('\nAll done! Total tables & views in report.db ready for query.');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

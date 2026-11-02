// 一次性/按需运行：把历史所有已有会话（尤其是各个空间/项目文件夹下的对话）名称精简为高可读性短标题
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { conversationTitle } = require('../models/conversation-title');

function findDatabases() {
    const dbs = [];
    const rootToolsDb = path.join(__dirname, '../data/tools.db');
    if (fs.existsSync(rootToolsDb)) dbs.push(rootToolsDb);
    const tenantsDir = path.join(__dirname, '../data/tenants');
    if (fs.existsSync(tenantsDir)) {
        for (const tenant of fs.readdirSync(tenantsDir)) {
            const tenantDb = path.join(tenantsDir, tenant, 'tools.db');
            if (fs.existsSync(tenantDb)) dbs.push(tenantDb);
        }
    }
    return dbs;
}

function runQuery(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function runExec(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

async function streamlineDatabase(dbPath) {
    console.log(`\n================ 处理数据库: ${dbPath} ================`);
    const db = new sqlite3.Database(dbPath);
    try {
        const tables = await runQuery(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='ai_chat_sessions'");
        if (!tables.length) {
            console.log('未找到 ai_chat_sessions 表，跳过。');
            return;
        }

        const columns = await runQuery(db, 'PRAGMA table_info(ai_chat_sessions)');
        if (!columns.some(c => c.name === 'auto_title')) {
            console.log('添加缺失的 auto_title 列...');
            await runExec(db, "ALTER TABLE ai_chat_sessions ADD COLUMN auto_title TEXT NOT NULL DEFAULT ''");
        }
        if (!columns.some(c => c.name === 'auto_title_source')) {
            console.log('添加缺失的 auto_title_source 列...');
            await runExec(db, "ALTER TABLE ai_chat_sessions ADD COLUMN auto_title_source TEXT NOT NULL DEFAULT ''");
        }

        const rows = await runQuery(db, `
            SELECT s.id, s.auto_title, s.auto_title_source, s.agent_root,
                   (SELECT content FROM ai_chat_messages m WHERE m.session_id = s.id AND m.role = 'user' ORDER BY m.created_at ASC, m.rowid ASC LIMIT 1) AS first_question
            FROM ai_chat_sessions s
            WHERE EXISTS (SELECT 1 FROM ai_chat_messages m WHERE m.session_id = s.id)
            ORDER BY s.updated_at DESC
        `);

        console.log(`找到包含消息的有效会话共: ${rows.length} 条`);
        let updatedCount = 0;
        const workspaceStats = {};

        for (const row of rows) {
            if (!row.first_question) continue;
            const newTitle = conversationTitle(row.first_question);
            const folder = row.agent_root ? row.agent_root.split('/').filter(Boolean).pop() : '默认任务(无空间)';
            workspaceStats[folder] = (workspaceStats[folder] || 0) + 1;

            if (row.auto_title !== newTitle || row.auto_title_source !== 'ai') {
                await runExec(db, "UPDATE ai_chat_sessions SET auto_title = ?, auto_title_source = 'ai' WHERE id = ?", [newTitle, row.id]);
                updatedCount++;
                if (row.agent_root) {
                    console.log(`  [空间: ${folder}] ${row.id}: "${row.auto_title || '(空)'}" -> "${newTitle}"`);
                }
            }
        }

        console.log(`更新完成: 共精简重命名 ${updatedCount} 条会话。`);
        console.log('空间会话分布:', workspaceStats);
    } finally {
        db.close();
    }
}

async function main() {
    const dbs = findDatabases();
    console.log(`发现 ${dbs.length} 个 tools.db:`, dbs);
    for (const dbPath of dbs) {
        await streamlineDatabase(dbPath);
    }
    console.log('\n所有数据库会话名称精简完成！');
}

if (require.main === module) {
    main().catch(err => {
        console.error('精简会话名称失败:', err);
        process.exit(1);
    });
}

module.exports = { streamlineDatabase, findDatabases };

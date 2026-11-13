#!/usr/bin/env node
'use strict';
const path = require('path');
const { vault } = require('../models/password-vault');

const [,, cmd, name, val, label, category] = process.argv;
const defaultOwner = process.env.DRAGON_VAULT_OWNER || process.env.TOOLS_VAULT_OWNER || 'admin';

async function main() {
    const v = vault();
    if (!cmd || cmd === '--help' || cmd === '-h') {
        console.log('Dragon Claw 保险箱密钥 CLI (vault-secret)');
        console.log('用法:');
        console.log('  node vault-secret.js get <NAME> [owner]');
        console.log('  node vault-secret.js set <NAME> <VALUE> [label] [category]');
        console.log('  node vault-secret.js list [owner]');
        process.exit(0);
    }
    if (cmd === 'get') {
        if (!name) { console.error('缺少密钥名称'); process.exit(1); }
        const targetOwner = val || defaultOwner;
        const item = await v.getSecret(targetOwner, name);
        if (!item || item.value === undefined) {
            console.error(`密钥未找到: ${name} (owner: ${targetOwner})`);
            process.exit(1);
        }
        process.stdout.write(item.value);
        process.exit(0);
    }
    if (cmd === 'set') {
        if (!name || val === undefined) { console.error('缺少名称或密钥内容: set <NAME> <VALUE> [label] [category]'); process.exit(1); }
        const res = await v.saveSecret(defaultOwner, { name, value: val, label: label || '', category: category || 'api_key' });
        console.log(`已成功保存密钥: ${name}`);
        process.exit(0);
    }
    if (cmd === 'list') {
        const targetOwner = name || defaultOwner;
        const res = await v.listSecrets(targetOwner);
        console.log(JSON.stringify(res, null, 2));
        process.exit(0);
    }
    console.error(`未知子命令: ${cmd}`);
    process.exit(1);
}

main().catch(err => {
    console.error(err.message || err);
    process.exit(1);
});

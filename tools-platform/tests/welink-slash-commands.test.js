const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'welink-slash-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');

const { runWithTenant } = require('../backend/models/tenant-context');
const welinkSlashRepo = require('../backend/models/channels/welink-slash-commands-repository');
const { WeLinkProvider } = require('../backend/models/channels/welink-provider');

test('welink slash commands repository: list defaults, save, scaffold and delete', async () => {
    await runWithTenant('default', async () => {
        // 1. 初始列表包含默认预设
        const initial = await welinkSlashRepo.listCommands();
        assert.ok(Array.isArray(initial));
        assert.ok(initial.some(c => c.name === 'dragonclaw'));

        // 2. 保存 Type 1 命令（直接打开网页）
        const savedWeb = await welinkSlashRepo.saveCommand({
            name: 'testportal',
            nameZh: '测试门户',
            type: 1,
            scopes: '1,2',
            url: 'https://example.com/portal',
            descZh: '一键跳转测试门户'
        });
        assert.equal(savedWeb.name, 'testportal');
        assert.equal(savedWeb.type, 1);
        assert.deepEqual(savedWeb.scopes, ['user', 'group']);
        assert.equal(savedWeb.url, 'https://example.com/portal');

        // 生成脚手架
        const webScaffold = welinkSlashRepo.generateScaffold(savedWeb);
        assert.ok(webScaffold.includes('"command_type": 1'));
        assert.ok(webScaffold.includes('https://example.com/portal'));

        // 3. 保存 Type 3 命令（本地 Python 处理）
        const savedPy = await welinkSlashRepo.saveCommand({
            name: 'my_query',
            nameZh: '本地查询',
            type: 3,
            scopes: ['group'],
            descZh: '在群内查询本地指标'
        });
        assert.equal(savedPy.name, 'my_query');
        assert.equal(savedPy.type, 3);
        assert.deepEqual(savedPy.scopes, ['group']);

        const pyScaffold = welinkSlashRepo.generateScaffold(savedPy);
        assert.ok(pyScaffold.includes('"command_type": 3'));
        assert.ok(pyScaffold.includes('async def handle(ctx):'));
        assert.ok(pyScaffold.includes('ctx.send_text'));

        // 4. 查询已保存的命令
        const found = await welinkSlashRepo.getCommand('testportal');
        assert.equal(found.nameZh, '测试门户');

        // 5. 删除命令
        const delResult = await welinkSlashRepo.deleteCommand('testportal');
        assert.equal(delResult.deleted, true);
        const afterDel = await welinkSlashRepo.getCommand('testportal');
        assert.equal(afterDel, null);
    });
});

test('welink provider merges custom slash commands into listSlashCommands and handleSlashCommand', async () => {
    await runWithTenant('default', async () => {
        // 保存一个自定义命令
        await welinkSlashRepo.saveCommand({
            name: 'autobot',
            nameZh: '自动化助手',
            descZh: '执行自动化任务',
            type: 1,
            url: 'http://127.0.0.1:5200/auto'
        });

        const fakeService = {
            log: () => {},
            defaultUserName: acc => acc,
            accountIsReadable: true,
            activeBridge: null,
            getRuntimeStatus: () => ({ state: 'connected' })
        };
        const provider = new WeLinkProvider(fakeService);

        // 列表应包含 /help, /new 等内置命令，以及 /autobot
        const { slashCommands } = await provider.listSlashCommands();
        const cmdNames = slashCommands.map(c => c.command);
        assert.ok(cmdNames.includes('/help'));
        assert.ok(cmdNames.includes('/whoami'));
        assert.ok(cmdNames.includes('/autobot'));

        // 触发 /help 应展示 /autobot
        const helpReply = await provider.handleSlashCommand('/help', { toolSessionId: 'sess-1', conversation: { kind: 'user', senderAccount: 'a123' } });
        assert.ok(helpReply.includes('/autobot'));

        // 触发自定义命令 /autobot
        const customCmd = await welinkSlashRepo.getCommand('autobot');
        const autoReply = await provider.handleSlashCommand('/autobot', { toolSessionId: 'sess-1', conversation: { kind: 'user', senderAccount: 'a123' }, customCmd });
        assert.ok(autoReply.includes('自动化助手'));
        assert.ok(autoReply.includes('http://127.0.0.1:5200/auto'));
    });
});

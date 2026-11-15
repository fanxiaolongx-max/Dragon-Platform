const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Skill Hub shared badges & category filter chips for Plugins and Tools', async (t) => {
    const hubPath = path.join(__dirname, '../frontend/js/home/skill-hub.js');
    const hubCode = fs.readFileSync(hubPath, 'utf8');

    function createMockEnvironment({ isSuper = true } = {}) {
        const mockWindow = {
            localStorage: {
                getItem: (k) => {
                    if (k === 'tools_super') return isSuper ? '1' : '0';
                    if (k === 'tools_role') return isSuper ? 'admin' : 'user';
                    if (k === 'tools_tenant_id') return 'default';
                    return null;
                },
                setItem: () => {}
            },
            isNavSuperAdmin: () => isSuper,
            ToolsI18n: { getLanguage: () => 'zh-CN' },
            SkillSource: {
                kind: (item) => (item?.builtIn ? 'builtin' : (item?.shared || item?.sharedAccess) ? 'shared' : 'custom'),
                indicator: (src) => `<i class="skill-src-dot" data-src="${src}"></i>`,
                label: (text, item, { source }) => `<span>${text}</span><i class="skill-src-dot" data-src="${source}"></i>`
            },
            NavFavorites: { get: () => [] },
            HomeCapabilities: {
                groups: () => [
                    {
                        kind: 'f12',
                        label: '浏览器插件',
                        labelEn: 'Browser plugins',
                        where: '浏览器扩展',
                        whereEn: 'Browser extensions',
                        href: '/uivf12',
                        items: [
                            { id: 'f12:plugin-shared', name: '已开放插件', sharedAccess: true, builtIn: true },
                            { id: 'f12:plugin-unshared', name: '未开放插件', sharedAccess: false, builtIn: false }
                        ]
                    }
                ]
            },
            HomeWorkspace: {
                getTools: () => [
                    {
                        id: 'static-builtin-tool',
                        title: '静态内置工具',
                        href: '/html/static.html',
                        builtIn: true,
                        shared: false,
                        sharedAccess: false,
                        group: '平台工具'
                    },
                    {
                        id: 'custom:tool-shared',
                        title: '已开放自定义工具',
                        href: '/custom-tools/tool-shared/index.html',
                        builtIn: false,
                        shared: false,
                        sharedAccess: true,
                        group: '实用工具'
                    },
                    {
                        id: 'custom:tool-unshared',
                        title: '未开放自定义工具',
                        href: '/custom-tools/tool-unshared/index.html',
                        builtIn: false,
                        shared: false,
                        sharedAccess: false,
                        group: '实用工具'
                    }
                ],
                formatRelative: () => '刚刚'
            },
            __homeCustomTools: [
                {
                    slug: 'tool-shared',
                    name: '已开放自定义工具',
                    href: '/custom-tools/tool-shared/index.html',
                    builtIn: false,
                    sharedAccess: true
                },
                {
                    slug: 'tool-unshared',
                    name: '未开放自定义工具',
                    href: '/custom-tools/tool-unshared/index.html',
                    builtIn: false,
                    sharedAccess: false
                }
            ],
            document: {
                readyState: 'complete',
                addEventListener: () => {},
                getElementById: () => null,
                querySelector: () => null,
                querySelectorAll: () => []
            },
            addEventListener: () => {}
        };
        mockWindow.window = mockWindow;
        return mockWindow;
    }

    await t.test('superadmin receives sharedWithAll and unsharedOnly badges and extraCats for plugins', () => {
        const mockEnv = createMockEnvironment({ isSuper: true });
        const context = vm.createContext(mockEnv);
        vm.runInContext(hubCode, context);

        const plugins = mockEnv.HomeSkillHub.entries('plugins');
        assert.equal(plugins.length, 2);
        const sharedPlugin = plugins.find(p => p.capabilityId === 'f12:plugin-shared');
        const unsharedPlugin = plugins.find(p => p.capabilityId === 'f12:plugin-unshared');

        assert.ok(sharedPlugin.badges.includes('全员开放'), 'shared plugin must have 全员开放 badge');
        assert.ok(sharedPlugin.extraCats.includes('sharedWithAll'), 'shared plugin must have sharedWithAll extraCat');
        assert.equal(sharedPlugin.sharedAccess, true);

        assert.ok(unsharedPlugin.badges.includes('未全员开放'), 'unshared plugin must have 未全员开放 badge for superadmin');
        assert.ok(unsharedPlugin.extraCats.includes('unsharedOnly'), 'unshared plugin must have unsharedOnly extraCat for superadmin');
        assert.equal(unsharedPlugin.sharedAccess, false);
    });

    await t.test('superadmin receives sharedWithAll and unsharedOnly badges and extraCats for tools', () => {
        const mockEnv = createMockEnvironment({ isSuper: true });
        const context = vm.createContext(mockEnv);
        vm.runInContext(hubCode, context);

        const tools = mockEnv.HomeSkillHub.entries('tools');
        assert.equal(tools.length, 3);
        const staticTool = tools.find(t => t.id === 'static-builtin-tool');
        const sharedTool = tools.find(t => t.id === 'custom:tool-shared');
        const unsharedTool = tools.find(t => t.id === 'custom:tool-unshared');

        assert.ok(staticTool.badges.includes('全员开放'), 'static built-in tool must have 全员开放 badge');
        assert.ok(staticTool.extraCats.includes('sharedWithAll'), 'static built-in tool must have sharedWithAll extraCat');

        assert.ok(sharedTool.badges.includes('全员开放'), 'shared custom tool must have 全员开放 badge');
        assert.ok(sharedTool.extraCats.includes('sharedWithAll'), 'shared custom tool must have sharedWithAll extraCat');

        assert.ok(unsharedTool.badges.includes('未全员开放'), 'unshared custom tool must have 未全员开放 badge for superadmin');
        assert.ok(unsharedTool.extraCats.includes('unsharedOnly'), 'unshared custom tool must have unsharedOnly extraCat for superadmin');
    });

    await t.test('non-superadmin only receives sharedWithAll badge, never unsharedOnly', () => {
        const mockEnv = createMockEnvironment({ isSuper: false });
        const context = vm.createContext(mockEnv);
        vm.runInContext(hubCode, context);

        const tools = mockEnv.HomeSkillHub.entries('tools');
        const sharedTool = tools.find(t => t.id === 'custom:tool-shared');
        const unsharedTool = tools.find(t => t.id === 'custom:tool-unshared');

        assert.ok(sharedTool.badges.includes('全员开放'));
        assert.ok(!unsharedTool.badges.includes('未全员开放'), 'non-superadmin must not see 未全员开放 badge');
        assert.equal(unsharedTool.extraCats.length, 0, 'non-superadmin must not have unsharedOnly in extraCats');
    });

    await t.test('dragon-claw-skills.js optionNode renders dc-skill-share-badge for superadmin and non-superadmin', () => {
        const skillsCode = fs.readFileSync(path.join(__dirname, '../frontend/js/home/dragon-claw-skills.js'), 'utf8');
        assert.match(skillsCode, /dc-skill-share-badge/, 'must define dc-skill-share-badge');
        assert.match(skillsCode, /dc-skill-option-tags/, 'must wrap option tags in a right-aligned container');
        assert.match(skillsCode, /dc-skill-tag-workspace/, 'must give workspace requirement a distinct tag class');
        assert.match(skillsCode, /isSuperAdminUser\(\)/, 'must check isSuperAdminUser');
        assert.match(skillsCode, /isShared \? '全员开放' : '未全员开放'/, 'must support i18n for shared');
    });

    await t.test('home-shell.js discover popup defines shared and unshared category chips and badges', () => {
        const homeV2Code = fs.readFileSync(path.join(__dirname, '../frontend/js/home/home-shell.js'), 'utf8');
        assert.match(homeV2Code, /sharedWithAll:\s*'全员开放'/, 'must define sharedWithAll translation in zh-CN');
        assert.match(homeV2Code, /unsharedOnly:\s*'未全员开放'/, 'must define unsharedOnly translation in zh-CN');
        assert.match(homeV2Code, /v2-badge-shared-pill/, 'must render v2-badge-shared-pill in appRow');
        assert.match(homeV2Code, /discover\.cat === 'sharedWithAll'/, 'must handle sharedWithAll filter');
        assert.match(homeV2Code, /discover\.cat === 'unsharedOnly'/, 'must handle unsharedOnly filter');
    });
});

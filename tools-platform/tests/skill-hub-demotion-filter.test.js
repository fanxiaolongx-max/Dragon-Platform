const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Skill Hub demotion, visual indicators, source filtering and share toggle', async (t) => {
    const hubCode = fs.readFileSync(path.join(__dirname, '../frontend/js/home/skill-hub.js'), 'utf8');
    const skillsToolsCode = fs.readFileSync(path.join(__dirname, '../frontend/js/home/skills-tools.js'), 'utf8');
    const indexHtml = fs.readFileSync(path.join(__dirname, '../frontend/index.html'), 'utf8');
    const homePageCode = fs.readFileSync(path.join(__dirname, '../frontend/js/home/home-tools.js'), 'utf8');

    function createMockEnvironment({ isSuper = true, lang = 'zh-CN' } = {}) {
        const mockWindow = {
            localStorage: {
                getItem: (k) => {
                    if (k === 'tools_super') return isSuper ? '1' : '0';
                    if (k === 'tools_tenant_id') return 'default';
                    if (k === 'tools_lang') return lang;
                    if (k === 'tools_role') return 'admin';
                    return null;
                },
                setItem: () => {}
            },
            HomeSkills: {
                items: () => [
                    {
                        id: 'builtin-skill',
                        name: '内置技能',
                        nameEn: 'Builtin Skill',
                        description: '这是一个内置技能',
                        builtIn: true,
                        source: 'builtin'
                    },
                    {
                        id: 'demoted-skill',
                        name: '已取消内置的技能',
                        nameEn: 'Demoted Skill',
                        description: '这是一个取消内置后的技能',
                        builtIn: false,
                        source: 'chat'
                    },
                    {
                        id: 'legacy-demoted-skill',
                        name: '历史遗留字段的取消内置技能',
                        nameEn: 'Legacy Demoted Skill',
                        description: 'source仍为builtin但builtIn为false',
                        builtIn: false,
                        source: 'builtin'
                    }
                ]
            },
            HomeCapabilities: {
                groups: () => [
                    {
                        kind: 'float',
                        label: '浏览器脚本',
                        labelEn: 'Browser Scripts',
                        where: '扩展程序',
                        color: '#38bdf8',
                        items: [
                            { id: 'f12:builtin-script', name: '内置脚本', builtIn: true },
                            { id: 'f12:custom-script', name: '自定义脚本', builtIn: false }
                        ]
                    }
                ]
            },
            HomeWorkspace: {
                getTools: () => [
                    {
                        id: 'builtin-tool',
                        title: '内置工具',
                        href: '/tools/builtin-tool',
                        builtIn: true,
                        group: '常用'
                    },
                    {
                        id: 'custom:my-tool',
                        title: '自定义工具',
                        href: '/tools/my-tool',
                        builtIn: false,
                        group: '常用'
                    }
                ],
                formatRelative: () => '刚刚'
            },
            __homeCustomTools: [
                {
                    slug: 'my-tool',
                    name: '自定义工具',
                    href: '/tools/my-tool',
                    builtIn: false
                }
            ],
            document: {
                readyState: 'complete',
                addEventListener: () => {},
                getElementById: () => null,
                querySelector: () => null,
                querySelectorAll: () => []
            },
            addEventListener: () => {},
            dispatchEvent: () => {}
        };
        mockWindow.window = mockWindow;
        return mockWindow;
    }

    await t.test('SkillSource.kind correctly classifies builtIn=false items as non-builtin', () => {
        const mockEnv = createMockEnvironment();
        const context = vm.createContext(mockEnv);
        vm.runInContext(skillsToolsCode, context);

        assert.equal(mockEnv.SkillSource.kind({ builtIn: true, source: 'builtin' }), 'builtin');
        assert.equal(mockEnv.SkillSource.kind({ builtIn: false, source: 'builtin' }), 'chat');
        assert.equal(mockEnv.SkillSource.kind({ builtIn: false, source: 'import' }), 'import');
        assert.equal(mockEnv.SkillSource.kind({ builtIn: false, source: 'external' }), 'external');
        assert.equal(mockEnv.SkillSource.kind({ builtIn: false, source: 'custom' }), 'custom');
        assert.equal(mockEnv.SkillSource.kind({ builtIn: false, source: 'chat' }), 'chat');
    });

    await t.test('skillEntries assigns builtIn=false, pink color, and custom category to demoted skills', () => {
        const mockEnv = createMockEnvironment();
        const context = vm.createContext(mockEnv);
        vm.runInContext(skillsToolsCode, context);
        // Ensure mock HomeSkills.items is set after skillsToolsCode runs
        mockEnv.HomeSkills.items = () => [
            {
                id: 'builtin-skill',
                name: '内置技能',
                nameEn: 'Builtin Skill',
                description: '这是一个内置技能',
                builtIn: true,
                source: 'builtin'
            },
            {
                id: 'demoted-skill',
                name: '已取消内置的技能',
                nameEn: 'Demoted Skill',
                description: '这是一个取消内置后的技能',
                builtIn: false,
                source: 'chat'
            },
            {
                id: 'legacy-demoted-skill',
                name: '历史遗留字段的取消内置技能',
                nameEn: 'Legacy Demoted Skill',
                description: 'source仍为builtin但builtIn为false',
                builtIn: false,
                source: 'builtin'
            }
        ];
        vm.runInContext(hubCode, context);

        const skills = mockEnv.HomeSkillHub.entries('skills');
        const builtin = skills.find(s => s.id === 'builtin-skill');
        const demoted = skills.find(s => s.id === 'demoted-skill');
        const legacyDemoted = skills.find(s => s.id === 'legacy-demoted-skill');

        assert.equal(builtin.builtIn, true);
        assert.equal(builtin.color, '#10a37f');
        assert.equal(builtin.cat, 'builtin');
        assert.equal(builtin.source, 'builtin');

        assert.equal(demoted.builtIn, false);
        assert.equal(demoted.color, '#f472b6');
        assert.notEqual(demoted.cat, 'builtin');
        assert.notEqual(demoted.source, 'builtin');

        assert.equal(legacyDemoted.builtIn, false);
        assert.equal(legacyDemoted.color, '#f472b6');
        assert.notEqual(legacyDemoted.cat, 'builtin');
        assert.notEqual(legacyDemoted.source, 'builtin');
    });

    await t.test('toolEntries and pluginEntries correctly distinguish built-in vs demoted/custom items', () => {
        const mockEnv = createMockEnvironment();
        const context = vm.createContext(mockEnv);
        vm.runInContext(skillsToolsCode, context);
        vm.runInContext(hubCode, context);

        const tools = mockEnv.HomeSkillHub.entries('tools');
        const builtinTool = tools.find(t => t.id === 'builtin-tool');
        const customTool = tools.find(t => t.id === 'custom:my-tool');

        assert.equal(builtinTool.builtIn, true);
        assert.equal(builtinTool.source, 'builtin');
        assert.equal(builtinTool.color, '#10a37f');

        assert.equal(customTool.builtIn, false);
        assert.notEqual(customTool.source, 'builtin');
        assert.notEqual(customTool.color, '#10a37f');

        const plugins = mockEnv.HomeSkillHub.entries('plugins');
        const builtinPlugin = plugins.find(p => p.capabilityId === 'f12:builtin-script');
        const customPlugin = plugins.find(p => p.capabilityId === 'f12:custom-script');

        assert.equal(builtinPlugin.builtIn, true);
        assert.equal(builtinPlugin.source, 'builtin');
        assert.equal(customPlugin.builtIn, false);
        assert.notEqual(customPlugin.source, 'builtin');
    });

    await t.test('HTML and JS provide optional shareAll toggle in upload modal for superadmins', () => {
        assert.match(indexHtml, /id="customToolShareField"/);
        assert.match(indexHtml, /id="customToolShareCheckbox"/);
        assert.match(homePageCode, /home\.import\.shareLabel/);
        assert.match(homePageCode, /home\.import\.shareHint/);
        assert.match(homePageCode, /shareCheckbox\.checked/);
    });
});

// @welink-office Skill 的工具：管理员在首页 Dragon Claw（普通对话，不选工作目录）里以本人身份使用 WeLink。
// welink_query：只读查询，以及下载到固定目录（云空间文件、分享外链、邮件附件），直接执行。
// welink_action：发消息、建群、撤回、建会/改会/取消、议题、云空间增删改与外链、发/回/转/移邮件、建日程、特别关注；
//   需管理员在设置里开启「允许写操作」，且每一条都要用户在对话里的审批卡上点「允许」才执行。
// 参数按白名单逐个校验后组装成参数数组交给 welink-cli-runner，不拼命令行字符串。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const runner = require('./welink-cli-runner');

const SKILL_ID = 'welink-office';
const MAX_STEPS = 12;
const RESULT_CHARS = 24 * 1024;
const VERBOSE_OUTPUT_CHARS = 6000;
const MAX_VALUE_CHARS = 500;
const MAX_LIST_ITEMS = 50;
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const APPROVAL_TIMEOUT_MS = 10 * 60000;
const LONG_TIMEOUT_MS = 10 * 60000;
const DAY_MS = 86400000;

// type：string | text（可多行）| int | bool（无值开关）| enum | date（YYYY-MM-DD）| datetime（YYYY-MM-DDTHH:mm[:ss]）| ms（13 位毫秒时间戳）
//       list（同一个参数后跟多个值）| emails（逗号分隔的邮箱）| file（本机文件路径）| files（同一参数重复多次的文件路径）
// write：写操作，只能经 welink_action 且需审批；output：下载命令，输出目录由平台指定，模型不能传。
const COMMANDS = {
    'auth status': { label: '查看登录状态', options: {} },
    'search person': { label: '搜索联系人', options: { text: { type: 'string', required: true }, 'page-size': { type: 'int', min: 1, max: 50 } } },
    'search group': { label: '搜索群组', options: { text: { type: 'string', required: true }, 'page-size': { type: 'int', min: 1, max: 50 }, type: { type: 'int', min: 0, max: 2 } } },
    'contact detail': { label: '查询用户详情', positional: { name: 'accounts', required: true }, options: {} },
    'contact favorite_list': { label: '特别关注列表', options: { pageIndex: { type: 'int', min: 1, max: 10000 }, pageSize: { type: 'int', min: 1, max: 50 } } },
    'im query-recent-conversation': { label: '最近会话', options: { count: { type: 'int', min: 1, max: 100 } } },
    'im query-group-member': { label: '群成员', options: { 'group-id': { type: 'string', required: true } } },
    'im query-history-message': {
        label: '聊天记录',
        oneOf: ['group-id', 'user-account'],
        options: { 'group-id': { type: 'string' }, 'user-account': { type: 'string' }, 'query-count': { type: 'int', min: 1, max: 100 }, 'message-id': { type: 'string' }, 'query-direction': { type: 'int', min: 0, max: 1 } }
    },
    'meeting query-list': {
        label: '会议列表',
        options: {
            'meeting-start-time': { type: 'ms', required: true }, 'meeting-end-time': { type: 'ms', required: true },
            type: { type: 'int', min: 0, max: 5, required: true }, 'meeting-sort': { type: 'enum', values: ['asc', 'desc'], required: true },
            page: { type: 'int', min: 0, max: 10000, required: true }, size: { type: 'int', min: 1, max: 30, required: true }
        }
    },
    'meeting info': { label: '会议详情', options: { 'meeting-id': { type: 'string', required: true } } },
    'meeting topic': { label: '会议议题', options: { 'meeting-id': { type: 'string', required: true } } },
    'meeting topic-materials': { label: '议题材料', options: { 'meeting-id': { type: 'string', required: true }, 'topic-id': { type: 'string', required: true } } },
    'meeting fuzzy-search': {
        label: '搜索会议',
        pairs: true,
        options: { 'result-type': { type: 'enum', values: ['meeting', 'file'], required: true }, limit: { type: 'int', min: 1, max: 50, required: true }, offset: { type: 'int', min: 0, max: 10000, required: true }, 'with-full-content': { type: 'enum', values: ['true', 'false'] } }
    },
    'onebox user-info': { label: '个人云空间信息', options: {} },
    'onebox folder-list': { label: '列出文件夹', options: { 'space-id': { type: 'string', required: true }, 'folder-id': { type: 'string' }, limit: { type: 'int', min: 1, max: 100 }, offset: { type: 'int', min: 0, max: 100000 } } },
    'onebox file-info': { label: '文件信息', options: { 'space-id': { type: 'string', required: true }, 'file-id': { type: 'string', required: true } } },
    'onebox node-search': {
        label: '搜索云空间',
        options: { 'space-id': { type: 'string', required: true }, name: { type: 'string', required: true }, offset: { type: 'int', min: 0, max: 100000 }, limit: { type: 'int', min: 1, max: 100 }, 'with-path': { type: 'bool' }, 'exact-search': { type: 'bool' }, 'file-type': { type: 'enum', values: ['file', 'folder', 'all'] } }
    },
    'onebox file-download': { label: '下载云空间文件', output: '--output', options: { 'space-id': { type: 'string', required: true }, 'file-id': { type: 'string', required: true }, force: { type: 'bool' } } },
    'onebox file-share-link-download': {
        label: '下载分享外链文件',
        output: '--output',
        oneOf: ['link', 'link-code'],
        options: { link: { type: 'string', max: 1000 }, 'link-code': { type: 'string' }, 'plain-access-code': { type: 'string' }, force: { type: 'bool' } }
    },
    'mail autodiscover': { label: '发现邮箱服务器', options: { email: { type: 'string', required: true } } },
    'mail folders': { label: '邮件文件夹', options: {} },
    'mail list': {
        label: '邮件列表',
        options: { 'folder-id': { type: 'string' }, max: { type: 'int', min: 1, max: 100 }, offset: { type: 'int', min: 0, max: 100000 }, 'is-read': { type: 'int', min: -1, max: 1 }, from: { type: 'string' }, subject: { type: 'string' }, start: { type: 'date' }, end: { type: 'date' }, query: { type: 'string' } }
    },
    'mail get': { label: '邮件详情', options: { 'item-id': { type: 'string', required: true }, 'body-type': { type: 'enum', values: ['Text', 'HTML'] } } },
    'mail attachment': { label: '下载邮件附件', output: '--path', options: { 'attachment-id': { type: 'string', required: true, max: 2000 } } },
    'calendar list': { label: '日历列表', options: { start: { type: 'date' }, end: { type: 'date' }, max: { type: 'int', min: 1, max: 100 } } },
    'calendar get': { label: '日程详情', options: { 'item-id': { type: 'string', required: true }, 'body-type': { type: 'enum', values: ['Text', 'HTML'] } } },

    // ── 写操作（welink_action，逐条审批） ──
    'im send-to-user': {
        label: '发消息给个人', write: true, impact: '对方会立即收到，以你本人名义发送',
        atLeastOne: ['text', 'image', 'file'],
        options: { receiver: { type: 'string', required: true }, text: { type: 'text', max: 5000 }, image: { type: 'file' }, file: { type: 'file' } }
    },
    'im send-to-group': {
        label: '发消息到群', write: true, impact: '群里所有人会立即收到，以你本人名义发送',
        atLeastOne: ['text', 'image', 'file'],
        options: { 'group-id': { type: 'string', required: true }, text: { type: 'text', max: 5000 }, image: { type: 'file' }, file: { type: 'file' } }
    },
    'im create-group': {
        label: '创建群组', write: true, impact: '新建群并拉入成员，成员会收到通知',
        options: { name: { type: 'string', required: true, max: 100 }, 'user-account': { type: 'list', required: true }, notice: { type: 'text', required: true, max: 1000 }, type: { type: 'int', min: 0, max: 1, required: true } }
    },
    'im add-group-member': { label: '添加群成员', write: true, impact: '被添加的人会进群并收到通知', options: { 'group-id': { type: 'string', required: true }, 'user-account': { type: 'list', required: true } } },
    'im recall-message': {
        label: '撤回消息', write: true, impact: '撤回后对方看到「已撤回」提示',
        oneOf: ['group-id', 'user-account'],
        options: { 'message-id': { type: 'string', required: true }, 'group-id': { type: 'string' }, 'user-account': { type: 'string' } }
    },
    'meeting create': {
        label: '创建会议', write: true, impact: '与会人会收到会议邀请', meetingTimes: true,
        options: { subject: { type: 'string', required: true, max: 100 }, 'start-time': { type: 'ms', required: true }, 'end-time': { type: 'ms', required: true }, 'meeting-user-list': { type: 'list', required: true } }
    },
    'meeting update': {
        label: '修改会议', write: true, impact: '与会人会收到会议变更通知', meetingTimes: true,
        atLeastOne: ['subject', 'start-time', 'end-time', 'meeting-user-list'],
        options: { 'meeting-id': { type: 'string', required: true }, subject: { type: 'string', max: 100 }, 'start-time': { type: 'ms' }, 'end-time': { type: 'ms' }, 'meeting-user-list': { type: 'list' } }
    },
    'meeting cancel': { label: '取消会议', write: true, impact: '会议取消，与会人会收到通知，不能恢复', options: { 'meeting-id': { type: 'string', required: true } } },
    'meeting topic-create': {
        label: '创建议题', write: true, impact: '在会议里新增议题和汇报人',
        options: { 'meeting-id': { type: 'string', required: true }, 'topic-name': { type: 'string', required: true, max: 200 }, 'topic-category': { type: 'string', required: true, max: 20 }, 'topic-member-list': { type: 'list', required: true } }
    },
    'meeting topic-update': {
        label: '修改议题', write: true, impact: '修改会议议题',
        atLeastOne: ['topic-name', 'topic-category', 'topic-member-list'],
        options: { 'meeting-id': { type: 'string', required: true }, 'topic-id': { type: 'string', required: true }, 'topic-name': { type: 'string', max: 200 }, 'topic-category': { type: 'string', max: 20 }, 'topic-member-list': { type: 'list' } }
    },
    'meeting topic-delete': { label: '删除议题', write: true, impact: '议题删除后不能恢复', options: { 'meeting-id': { type: 'string', required: true }, 'topic-id': { type: 'string', required: true } } },
    'onebox file-upload': {
        label: '上传文件到云空间', write: true, impact: '把本机文件上传到云空间', timeoutMs: LONG_TIMEOUT_MS,
        positional: { name: 'file', type: 'file', required: true },
        options: { 'space-id': { type: 'string', required: true }, parent: { type: 'string' } }
    },
    'onebox file-copy': {
        label: '复制云空间文件', write: true, impact: '在目标文件夹生成副本',
        options: { 'space-id': { type: 'string', required: true }, 'file-id': { type: 'string', required: true }, 'dest-parent': { type: 'string', required: true }, 'dest-space-id': { type: 'string', required: true } }
    },
    'onebox file-move': {
        label: '移动云空间文件', write: true, impact: '文件会移到目标文件夹',
        options: { 'space-id': { type: 'string', required: true }, 'file-id': { type: 'string', required: true }, 'dest-parent': { type: 'string', required: true }, 'dest-space-id': { type: 'string', required: true } }
    },
    'onebox file-rename': { label: '重命名云空间文件', write: true, impact: '修改文件名', options: { 'space-id': { type: 'string', required: true }, 'file-id': { type: 'string', required: true }, name: { type: 'string', required: true, max: 255 } } },
    'onebox file-remove': { label: '删除云空间文件', write: true, impact: '文件移到回收站', options: { 'space-id': { type: 'string', required: true }, 'file-id': { type: 'string', required: true } } },
    'onebox folder-new': { label: '新建云空间文件夹', write: true, impact: '新建文件夹', options: { 'space-id': { type: 'string', required: true }, parent: { type: 'string' }, name: { type: 'string', required: true, max: 255 } } },
    'onebox folder-rename': { label: '重命名云空间文件夹', write: true, impact: '修改文件夹名', options: { 'space-id': { type: 'string', required: true }, 'folder-id': { type: 'string', required: true }, name: { type: 'string', required: true, max: 255 } } },
    'onebox folder-remove': { label: '删除云空间文件夹', write: true, impact: '文件夹及其内容移到回收站', options: { 'space-id': { type: 'string', required: true }, 'folder-id': { type: 'string', required: true } } },
    'onebox file-share-link-get': { label: '创建分享外链', write: true, impact: '生成外链（默认仅自己可见）', options: { 'space-id': { type: 'string', required: true }, 'file-id': { type: 'string', required: true } } },
    'onebox file-share-link-edit': {
        label: '修改分享外链', write: true, impact: '改变谁能通过外链访问这个文件',
        options: { 'space-id': { type: 'string', required: true }, 'file-id': { type: 'string', required: true }, role: { type: 'enum', values: ['viewer', 'previewer', 'editor', 'prohibitVisitors'], required: true }, 'set-plain-access-code': { type: 'string', max: 20 }, 'unset-plain-access-code': { type: 'bool' } }
    },
    'onebox file-share-link-remove': { label: '取消分享外链', write: true, impact: '外链失效', options: { 'space-id': { type: 'string', required: true }, 'file-id': { type: 'string', required: true } } },
    'mail send': {
        label: '发送邮件', write: true, impact: '邮件立即发出，不能撤回', timeoutMs: LONG_TIMEOUT_MS, mailBody: true,
        options: { to: { type: 'emails', required: true }, subject: { type: 'string', required: true, max: 300 }, body: { type: 'text', max: 100000 }, cc: { type: 'emails' }, bcc: { type: 'emails' }, html: { type: 'bool' }, attachment: { type: 'files' } }
    },
    'mail reply': {
        label: '回复邮件', write: true, impact: '回复立即发给原发件人，不能撤回', timeoutMs: LONG_TIMEOUT_MS, mailBody: true,
        options: { 'item-id': { type: 'string', required: true, max: 2000 }, body: { type: 'text', max: 100000 }, subject: { type: 'string', max: 300 }, html: { type: 'bool' }, attachment: { type: 'files' } }
    },
    'mail reply-all': {
        label: '回复全部', write: true, impact: '回复立即发给原邮件的所有收件人和抄送人，不能撤回', timeoutMs: LONG_TIMEOUT_MS, mailBody: true,
        options: { 'item-id': { type: 'string', required: true, max: 2000 }, body: { type: 'text', max: 100000 }, subject: { type: 'string', max: 300 }, html: { type: 'bool' }, attachment: { type: 'files' } }
    },
    'mail forward': {
        label: '转发邮件', write: true, impact: '邮件（含原附件）立即转发，不能撤回', timeoutMs: LONG_TIMEOUT_MS, mailBody: true,
        options: { 'item-id': { type: 'string', required: true, max: 2000 }, to: { type: 'emails', required: true }, cc: { type: 'emails' }, body: { type: 'text', max: 100000 }, subject: { type: 'string', max: 300 }, html: { type: 'bool' }, attachment: { type: 'files' } }
    },
    'mail move': { label: '移动邮件', write: true, impact: '邮件移到目标文件夹（ItemId 会改变）', options: { 'item-id': { type: 'string', required: true, max: 2000 }, 'folder-id': { type: 'string', required: true, max: 2000 } } },
    'calendar create': {
        label: '创建日程', write: true, impact: '填了参会人会自动发出会议邀请', mailBody: true,
        options: { subject: { type: 'string', required: true, max: 300 }, start: { type: 'datetime', required: true }, end: { type: 'datetime', required: true }, body: { type: 'text', max: 100000 }, location: { type: 'string', max: 200 }, html: { type: 'bool' }, attendee: { type: 'emails' }, reminder: { type: 'int', min: 0, max: 40320 } }
    },
    'contact add_favorite': { label: '添加特别关注', write: true, impact: '加入你的特别关注列表', positional: { name: 'accounts', required: true }, options: {} },
    'contact del_favorite': { label: '取消特别关注', write: true, impact: '从你的特别关注列表移除', positional: { name: 'accounts', required: true }, options: {} }
};
const READ_COMMANDS = Object.keys(COMMANDS).filter(name => !COMMANDS[name].write);
const WRITE_COMMANDS = Object.keys(COMMANDS).filter(name => COMMANDS[name].write);

// 审批卡上的参数中文名
const OPTION_LABELS = {
    receiver: '接收人', text: '内容', image: '图片', file: '文件', 'group-id': '群 ID', name: '名称', 'user-account': '成员账号', notice: '群公告', type: '类型',
    'message-id': '消息 ID', subject: '主题', 'start-time': '开始时间', 'end-time': '结束时间', 'meeting-user-list': '与会人', 'meeting-id': '会议 ID',
    'topic-id': '议题 ID', 'topic-name': '议题名称', 'topic-category': '议题分类', 'topic-member-list': '汇报人', 'space-id': '空间 ID', 'file-id': '文件 ID',
    parent: '父文件夹 ID', 'dest-parent': '目标文件夹 ID', 'dest-space-id': '目标空间 ID', 'folder-id': '文件夹 ID', role: '外链权限',
    'set-plain-access-code': '设置提取码', 'unset-plain-access-code': '取消提取码', to: '收件人', cc: '抄送', bcc: '密送', body: '正文', html: 'HTML 正文',
    attachment: '附件', 'item-id': '邮件 ID', start: '开始', end: '结束', location: '地点', attendee: '参会人', reminder: '提前提醒（分钟）', accounts: '账号'
};

function toolError(code, message) {
    return Object.assign(new Error(message), { code });
}

/** 参数名宽松匹配：group-id / groupId / group_id / --group-id 都对应 --group-id。 */
const looseKey = key => String(key || '').replace(/^-+/, '').replace(/[-_]/g, '').toLowerCase();

function checkString(name, value, { max = MAX_VALUE_CHARS, multiline = false } = {}) {
    const text = multiline ? String(value ?? '').replace(/\r\n?/g, '\n').trim() : String(value ?? '').trim();
    if (!text) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 不能为空`);
    if (text.length > max) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 超过 ${max} 字`);
    // 以 - 开头的值会被 CLI 当成参数名
    if (text.startsWith('-')) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 不能以 - 开头`);
    if ((multiline ? /[\u0000-\u0008\u000b-\u001f]/ : /[\u0000-\u001f]/).test(text)) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 含有控制字符`);
    return text;
}

/** 本机文件：必须是存在的普通文件（绝对路径），用于发图片/文件、邮件附件、上传云空间。 */
function checkFile(name, value) {
    const text = checkString(name, value, { max: 1000 });
    if (!path.isAbsolute(text)) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 需要本机文件的完整路径`);
    let stat;
    try { stat = fs.statSync(text); } catch { throw toolError('WELINK_ARG_INVALID', `参数 ${name} 指向的文件不存在：${text}`); }
    if (!stat.isFile()) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 不是文件：${text}`);
    if (stat.size > MAX_UPLOAD_BYTES) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 文件超过 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB`);
    return text;
}

function splitValues(value) {
    return (Array.isArray(value) ? value : String(value ?? '').split(/[,，;；\s]+/)).map(item => String(item ?? '').trim()).filter(Boolean);
}

function listValues(name, value) {
    const items = splitValues(value);
    if (!items.length) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 至少需要一个值`);
    if (items.length > MAX_LIST_ITEMS) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 最多 ${MAX_LIST_ITEMS} 个`);
    return items.map(item => checkString(name, item));
}

function formatValue(name, spec, value) {
    if (spec.type === 'int') {
        const number = Number(value);
        if (!Number.isInteger(number) || number < spec.min || number > spec.max) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 应为 ${spec.min}~${spec.max} 的整数`);
        return String(number);
    }
    if (spec.type === 'ms') {
        const text = String(value ?? '').trim();
        if (!/^\d{13}$/.test(text)) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 应为 13 位毫秒时间戳`);
        return text;
    }
    if (spec.type === 'date') {
        const text = String(value ?? '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 应为 YYYY-MM-DD`);
        return text;
    }
    if (spec.type === 'datetime') {
        const text = String(value ?? '').trim();
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text)) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 应为 YYYY-MM-DDTHH:mm:ss（不带时区）`);
        return text.length === 16 ? `${text}:00` : text;
    }
    if (spec.type === 'enum') {
        const text = String(value ?? '').trim();
        const match = spec.values.find(item => item.toLowerCase() === text.toLowerCase());
        if (!match) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 只能是 ${spec.values.join(' / ')}`);
        return match;
    }
    if (spec.type === 'emails') {
        const items = splitValues(value);
        if (!items.length) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 至少需要一个邮箱`);
        if (items.length > MAX_LIST_ITEMS) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 最多 ${MAX_LIST_ITEMS} 个`);
        items.forEach(item => { if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(item)) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 里的 ${item} 不是有效邮箱`); });
        return items.join(',');
    }
    if (spec.type === 'file') return checkFile(name, value);
    if (spec.type === 'text') return checkString(name, value, { max: spec.max || MAX_VALUE_CHARS, multiline: true });
    return checkString(name, value, { max: spec.max || MAX_VALUE_CHARS });
}

/** 会议时间规则（CLI 文档）：开始须在未来且不晚于 31 天后，时长 15 分钟 ~ 7 天。 */
function checkMeetingTimes(values, now = Date.now()) {
    const start = values['start-time'] === undefined ? null : Number(values['start-time']);
    const end = values['end-time'] === undefined ? null : Number(values['end-time']);
    if (start !== null && start < now) throw toolError('WELINK_ARG_INVALID', 'start-time 不能是过去的时间');
    if (start !== null && start > now + 31 * DAY_MS) throw toolError('WELINK_ARG_INVALID', '只能预约 31 天内的会议');
    if (start !== null && end !== null) {
        if (end - start < 15 * 60000) throw toolError('WELINK_ARG_INVALID', '会议时长至少 15 分钟，且结束时间要晚于开始时间');
        if (end - start > 7 * DAY_MS) throw toolError('WELINK_ARG_INVALID', '会议时长不能超过 7 天');
    }
}

/**
 * 把模型给的 { command, options, accounts, search, file } 转成 CLI 参数数组；任何不在白名单里的东西都拒绝。
 * mode：'read' 只接受查询/下载命令，'write' 只接受写操作命令。
 * 返回 { command, args, label, spec, fields（审批卡展示用）, bodyFile（长正文改走 --body-path 时的内容） }。
 */
function buildArgs(input = {}, { mode = 'read', now } = {}) {
    const command = String(input.command || '').trim().replace(/\s+/g, ' ');
    const spec = COMMANDS[command];
    const allowed = mode === 'write' ? WRITE_COMMANDS : READ_COMMANDS;
    if (!spec || !allowed.includes(command)) {
        const hint = spec && spec.write ? `${command} 是写操作，welink_query 不支持，请用 welink_action` : spec ? `${command} 是查询命令，welink_action 不支持，请用 welink_query` : `不支持的命令：${command || '（空）'}`;
        throw toolError('WELINK_COMMAND_NOT_ALLOWED', `${hint}。可用：${allowed.join('、')}`);
    }
    const args = command.split(' ');
    const given = input.options && typeof input.options === 'object' && !Array.isArray(input.options) ? input.options : {};
    const byLoose = new Map(Object.keys(spec.options).map(name => [looseKey(name), name]));
    const values = {};
    for (const [rawKey, value] of Object.entries(given)) {
        if (value === undefined || value === null || value === '' || value === false) continue;
        if (spec.positional && looseKey(rawKey) === looseKey(spec.positional.name)) continue;
        const name = byLoose.get(looseKey(rawKey));
        if (!name) throw toolError('WELINK_ARG_NOT_ALLOWED', `命令 ${command} 不支持参数 ${rawKey}。可用参数：${Object.keys(spec.options).join('、') || '无'}`);
        values[name] = value;
    }
    for (const [name, optionSpec] of Object.entries(spec.options)) {
        if (optionSpec.required && values[name] === undefined) throw toolError('WELINK_ARG_REQUIRED', `命令 ${command} 缺少必填参数 ${name}`);
    }
    if (spec.oneOf && spec.oneOf.filter(name => values[name] !== undefined).length !== 1) {
        throw toolError('WELINK_ARG_REQUIRED', `命令 ${command} 需要且只能提供 ${spec.oneOf.join(' 或 ')} 之一`);
    }
    if (spec.atLeastOne && !spec.atLeastOne.some(name => values[name] !== undefined)) {
        throw toolError('WELINK_ARG_REQUIRED', `命令 ${command} 需要至少提供 ${spec.atLeastOne.join(' / ')} 之一`);
    }
    if (/^mail (send|reply|reply-all)$/.test(command) && values.body === undefined) {
        throw toolError('WELINK_ARG_REQUIRED', `命令 ${command} 需要 body 正文`);
    }
    if (values['set-plain-access-code'] !== undefined && values['unset-plain-access-code'] !== undefined) {
        throw toolError('WELINK_ARG_INVALID', 'set-plain-access-code 与 unset-plain-access-code 只能二选一');
    }
    const fields = [];
    let bodyFile = null;
    for (const [name, value] of Object.entries(values)) {
        const optionSpec = spec.options[name];
        const label = OPTION_LABELS[name] || name;
        if (optionSpec.type === 'bool') {
            if (value === true || value === 'true') { args.push(`--${name}`); fields.push({ name, label, value: '是' }); }
            continue;
        }
        if (optionSpec.type === 'list') {
            const items = listValues(name, value);
            args.push(`--${name}`, ...items);
            fields.push({ name, label, value: items.join('、') });
            continue;
        }
        if (optionSpec.type === 'files') {
            const items = splitValues(value);
            if (items.length > 10) throw toolError('WELINK_ARG_INVALID', `参数 ${name} 最多 10 个文件`);
            const files = items.map(item => checkFile(name, item));
            files.forEach(file => args.push(`--${name}`, file));
            if (files.length) fields.push({ name, label, value: files.join('\n') });
            continue;
        }
        const formatted = formatValue(name, optionSpec, value);
        // 长正文 / 多行正文改用 --body-path 临时文件，避开 Windows 命令行长度和换行转义问题
        if (name === 'body' && spec.mailBody && (formatted.length > 2000 || formatted.includes('\n'))) {
            bodyFile = formatted;
            args.push('--body-path', '<正文临时文件>');
        } else {
            args.push(`--${name}`, formatted);
        }
        fields.push({ name, label, value: optionSpec.type === 'ms' ? `${formatted}（${new Date(Number(formatted)).toLocaleString('zh-CN', { hour12: false })}）` : formatted });
    }
    if (spec.meetingTimes) checkMeetingTimes(values, now);
    if (spec.pairs) {
        // fuzzy-search 的条件是成对重复的 --search-type X --search-content Y
        const pairs = Array.isArray(input.search) ? input.search : [];
        if (!pairs.length) throw toolError('WELINK_ARG_REQUIRED', `命令 ${command} 需要 search 条件，如 [{"type":"subject","content":"周会"}]`);
        if (pairs.length > 10) throw toolError('WELINK_ARG_INVALID', 'search 条件最多 10 组');
        for (const pair of pairs) {
            args.push('--search-type', checkString('search.type', pair?.type), '--search-content', checkString('search.content', pair?.content));
        }
    }
    if (spec.positional) {
        const name = spec.positional.name;
        const raw = input[name] ?? given[name];
        if (spec.positional.type === 'file') {
            const file = checkFile(name, Array.isArray(raw) ? raw[0] : raw);
            args.push(file);
            fields.push({ name, label: OPTION_LABELS[name] || name, value: file });
        } else {
            const items = listValues(name, raw);
            args.push(...items);
            fields.push({ name, label: OPTION_LABELS[name] || name, value: items.join('、') });
        }
    }
    if (spec.output) args.push(spec.output, `${runner.downloadDir()}${path.sep}`);
    const timezone = String(input.timezone || '').trim();
    if (timezone && /^(mail|calendar) /.test(command)) {
        // --timezone 要写在 mail/calendar 之后、子命令之前
        if (!/^[A-Za-z][A-Za-z .()+-]{1,60}$/.test(timezone)) throw toolError('WELINK_ARG_INVALID', 'timezone 应为 Windows 时区 ID，如 China Standard Time');
        args.splice(1, 0, '--timezone', timezone);
        fields.push({ name: 'timezone', label: '时区', value: timezone });
    }
    return { command, args, label: spec.label, spec, fields, bodyFile };
}

const SHARED_PROPERTIES = {
    options: { type: 'object', description: '命令参数，键为参数名（如 group-id、query-count、start），值为字符串/数字/布尔；多值参数（成员、与会人、收件人、附件）传数组' },
    accounts: { type: 'array', items: { type: 'string' }, description: 'contact detail / add_favorite / del_favorite 的 welinkId 列表' },
    timezone: { type: 'string', description: 'mail/calendar 的时区 ID，默认 China Standard Time；如 Egypt Standard Time' }
};

function definitions({ write = false } = {}) {
    const tools = [{
        name: 'welink_query',
        description: [
            '以当前用户本人身份执行只读的 welink-cli 命令，或把云空间文件 / 分享外链 / 邮件附件下载到平台指定的下载目录（不用传输出路径）。',
            '参数名与 welink-cli 一致（不带 --），例如 {"command":"search person","options":{"text":"张三"}}。',
            'contact detail 用 accounts 传 welinkId 列表；meeting fuzzy-search 用 search 传 [{type,content}] 条件。'
        ].join(''),
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', enum: READ_COMMANDS, description: '命令' },
                ...SHARED_PROPERTIES,
                search: {
                    type: 'array',
                    description: 'meeting fuzzy-search 的条件',
                    items: { type: 'object', properties: { type: { type: 'string', description: 'subject / startTime / endTime 等' }, content: { type: 'string' } }, required: ['type', 'content'] }
                }
            },
            required: ['command']
        }
    }];
    if (write) {
        tools.push({
            name: 'welink_action',
            description: [
                '以当前用户本人身份执行会改变 WeLink 状态的命令：发消息、建群/拉人/撤回、建会/改会/取消/议题、云空间上传/复制/移动/改名/删除/外链、发/回复/转发/移动邮件、建日程、特别关注。',
                '每次调用都会在对话里弹出审批卡，用户点「允许」才执行，拒绝或超时则不执行；一次只做一件事，不要批量连发。',
                '收件人、内容、时间等必须来自用户明确的要求或前面查询到的结果，不要自行编造；拿不准时先问用户。',
                '本机文件参数（image、file、attachment、onebox file-upload 的 file）要用完整路径。'
            ].join(''),
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', enum: WRITE_COMMANDS, description: '命令' },
                    ...SHARED_PROPERTIES,
                    file: { type: 'string', description: 'onebox file-upload 要上传的本机文件完整路径' }
                },
                required: ['command']
            }
        });
    }
    return tools;
}

function clamp(text) {
    const value = String(text || '');
    return value.length > RESULT_CHARS ? { content: `${value.slice(0, RESULT_CHARS)}\n…（结果过长已截断，请缩小查询范围或分页）`, truncated: true } : { content: value, truncated: false };
}

function countOf(json) {
    if (Array.isArray(json)) return json.length;
    if (json && typeof json === 'object') {
        for (const key of ['data', 'list', 'items', 'records', 'result']) {
            if (Array.isArray(json[key])) return json[key].length;
        }
    }
    return null;
}

function commandLine(args) {
    return ['welink-cli', ...args].map(arg => (/[\s"]/.test(arg) ? JSON.stringify(arg) : arg)).join(' ');
}

// ── 审批：写操作在对话里弹卡，等用户在同一个页面点允许 / 拒绝 ─────────
const pendingApprovals = new Map();

function waitForApproval({ owner, signal }) {
    const id = crypto.randomBytes(12).toString('hex');
    let settle;
    const promise = new Promise(resolve => {
        const timer = setTimeout(() => settle('timeout'), APPROVAL_TIMEOUT_MS);
        if (typeof timer.unref === 'function') timer.unref();
        const onAbort = () => settle('abort');
        settle = decision => {
            if (!pendingApprovals.has(id)) return;
            pendingApprovals.delete(id);
            clearTimeout(timer);
            signal?.removeEventListener?.('abort', onAbort);
            resolve(decision);
        };
        pendingApprovals.set(id, { owner, settle });
        if (signal?.aborted) return onAbort();
        signal?.addEventListener?.('abort', onAbort, { once: true });
    });
    return { id, promise };
}

/** 用户在审批卡上的决定；只有发起这一轮对话的账号能决定。 */
function decide(id, decision, actor) {
    const pending = pendingApprovals.get(String(id || ''));
    if (!pending) throw Object.assign(new Error('审批已结束或不存在'), { code: 'WELINK_APPROVAL_GONE', statusCode: 404 });
    if (pending.owner && pending.owner !== actor) throw Object.assign(new Error('只能由发起这条对话的账号审批'), { code: 'WELINK_APPROVAL_FORBIDDEN', statusCode: 403 });
    if (!['allow', 'deny'].includes(decision)) throw Object.assign(new Error('decision 只能是 allow 或 deny'), { code: 'WELINK_APPROVAL_INVALID', statusCode: 400 });
    pending.settle(decision);
    return { ok: true };
}

function guard({ write = false } = {}) {
    runner.assertTenant();
    const config = runner.readConfig();
    if (!config.enabled) throw toolError('WELINK_CLI_DISABLED', '管理员尚未在「全局设置 › 频道对接 › WeLink › 个人身份（welink-cli）」启用该能力');
    if (write && !config.allowWrite) throw toolError('WELINK_CLI_WRITE_DISABLED', '管理员尚未在「全局设置 › 频道对接 › WeLink › 个人身份（welink-cli）」开启「允许写操作」');
}

async function runBuilt(built, signal) {
    let tempDir = null;
    const args = built.args.slice();
    try {
        if (built.bodyFile !== null && built.bodyFile !== undefined) {
            tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'welink-body-'));
            const file = path.join(tempDir, 'body.txt');
            fs.writeFileSync(file, built.bodyFile, { encoding: 'utf8', mode: 0o600 });
            args[args.indexOf('<正文临时文件>')] = file;
        }
        return await runner.run(args, { signal, ...(built.spec.timeoutMs || built.spec.output ? { timeoutMs: built.spec.timeoutMs || LONG_TIMEOUT_MS } : {}) });
    } finally {
        if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

function outcomeOf(built, result) {
    const cli = commandLine(built.args);
    // 详细模式：原始输出（含进度行与 stderr）随事件下发，对话里可展开查看
    const raw = [result.raw, result.stderr].filter(Boolean).join('\n--- stderr ---\n');
    if (!result.ok) {
        return { content: `welink-cli ${built.command} 失败：${result.error}`, summary: `${built.label}失败`, isError: true, cli, raw };
    }
    const body = result.json !== null ? JSON.stringify(result.json) : result.text;
    const clamped = clamp(body);
    const count = countOf(result.json);
    const savedTo = built.spec.output && result.json && typeof result.json === 'object' ? (result.json.path || result.json.output || result.json.file || '') : '';
    const summary = built.spec.write ? `${built.label}成功` : `${built.label}${count === null ? '' : ` ${count} 条`}${savedTo ? `：${savedTo}` : ''}`;
    const note = built.spec.output && !savedTo ? `\n（已下载到 ${runner.downloadDir()}）` : '';
    return { content: clamped.content + note, summary, truncated: clamped.truncated, cli, raw };
}

/**
 * 执行一次工具调用。ctx.onEvent 用于写操作的审批卡（approval / approval_result 事件）；
 * ctx.canApprove 为 false（非流式请求）时写操作直接拒绝。
 */
async function execute(ctx, name, args = {}) {
    if (name !== 'welink_query' && name !== 'welink_action') return { content: `未知工具：${name}`, summary: '未知工具', isError: true };
    const write = name === 'welink_action';
    try {
        guard({ write });
        const built = buildArgs(args && typeof args === 'object' ? args : {}, { mode: write ? 'write' : 'read' });
        if (write) {
            if (!ctx.canApprove || typeof ctx.onEvent !== 'function') throw toolError('WELINK_APPROVAL_UNAVAILABLE', '写操作需要在 Dragon Claw 对话里审批确认，当前请求无法弹出审批卡');
            const { id, promise } = waitForApproval({ owner: ctx.actor || '', signal: ctx.signal });
            const cli = commandLine(built.args);
            ctx.onEvent({
                type: 'approval', id, callId: ctx.callId, tool: 'welink_action', noAlways: true,
                approvalUrl: `/api/channels/welink-cli/approvals/${id}`,
                preview: { title: built.label, impact: built.spec.impact || '', fields: built.fields, command: cli }
            });
            const decision = await promise;
            ctx.onEvent({ type: 'approval_result', callId: ctx.callId, decision });
            if (decision !== 'allow') {
                const reason = decision === 'timeout' ? '审批超时，操作未执行' : decision === 'abort' ? '对话已停止，操作未执行' : '用户拒绝了该操作，未执行';
                return { content: reason, summary: reason, isError: true, cli, declined: true };
            }
        }
        return outcomeOf(built, await runBuilt(built, ctx.signal));
    } catch (error) {
        return { content: `错误（${error.code || 'ERROR'}）：${error.message}`, summary: error.message.slice(0, 120), isError: true };
    }
}

async function buildPrompt() {
    const config = runner.readConfig();
    const lines = ['', '【WeLink 个人身份工具（@welink-office）】'];
    if (!runner.tenantAllowed()) {
        lines.push('当前租户不能使用 welink-cli（只开放给默认租户）。请如实告诉用户。');
    } else if (!config.enabled) {
        lines.push('welink-cli 尚未启用。请告诉用户到「全局设置 › 频道对接 › WeLink › 个人身份（welink-cli）」检测安装、扫码登录并启用。');
    } else {
        lines.push(
            '用 welink_query 以用户本人身份查询 WeLink，或把云空间文件 / 分享外链 / 邮件附件下载到本机下载目录。结果以工具返回为准，不要编造人员、消息、会议或邮件内容。',
            `今天是 ${new Date().toLocaleDateString('sv-SE')}，现在是 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}（平台服务器本地时间），当前 13 位毫秒时间戳约为 ${Date.now()}；meeting 的时间参数是 13 位毫秒时间戳，mail/calendar 的 --end 不包含当天（查某天要写次日），calendar create 的 start/end 写 YYYY-MM-DDTHH:mm:ss。`,
            config.email ? `已为 ${config.email} 执行过 mail autodiscover。` : '首次查邮件或日历前，需先用 mail autodiscover 传入用户邮箱（不知道就先问用户）。',
            config.allowWrite
                ? '用户明确要求发消息、建群、撤回、建会/改会/取消、议题、云空间增删改与外链、发/回/转/移邮件、建日程、特别关注时，用 welink_action：每次调用都会弹出审批卡，用户允许后才真正执行。调用前把收件人/成员换成查询到的真实账号或邮箱（不知道就先用 search person / contact detail 查，查不到就问用户），不要猜；工具返回成功前不要说「已发送 / 已创建」，被拒绝时如实说明未执行。'
                : '写操作（发消息、发邮件、建会、删除等）当前未开启：请告诉用户管理员可在「全局设置 › 频道对接 › WeLink › 个人身份（welink-cli）」开启「允许写操作」，开启后每次执行前都会在对话里请他确认。',
            '需要查询或执行时在本轮直接调用工具，不要只回复「请稍等 / 正在查询」就结束；工具结果出来后再回答。'
        );
    }
    return lines.join('\n');
}

// 模型只说「请稍等 / 正在查询」却没有调用工具：本轮补一次提示，让它真正去查
const PROMISE_ONLY_RE = /请稍等|稍等|稍候|正在(为你|帮你|通过|查询|搜索|拉取|获取|调用|发送|创建)|我来(帮你|为你)?(查|搜|看|拉|发|建)|马上(帮你|为你)?(查|搜|发|建)/;

/**
 * 带 welink_query / welink_action 工具的一轮回复（与 @ops-group 相同的工具循环）。
 * canApprove：本轮能否弹审批卡（流式请求才行）。
 * @returns {Promise<{text, usage, toolLog}>}
 */
async function runTurn({ client, systemInstruction, messages, ctx = {}, signal, onDelta, onEvent, canApprove = false, maxOutputTokens, temperature }) {
    const config = runner.readConfig();
    const tools = definitions({ write: Boolean(config.allowWrite && canApprove) });
    const history = messages.map(item => ({ ...item }));
    const usage = { promptTokens: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const toolLog = [];
    const verbose = Boolean(config.verbose);
    let nudged = false;
    let activeClient = client;
    for (let step = 1; step <= MAX_STEPS; step += 1) {
        if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        let result;
        try {
            result = await activeClient.generateText({ systemInstruction, messages: history, tools, maxOutputTokens, temperature, signal, onDelta });
        } catch (error) {
            if (step === 1 && error?.code === 'AI_TOOLS_UNSUPPORTED') {
                result = await activeClient.generateText({ systemInstruction: `${systemInstruction}\n\n（当前模型不支持工具调用，WeLink 查询暂不可用；请说明需要管理员切换支持函数调用的模型。）`, messages: history, maxOutputTokens, temperature, signal, onDelta });
                return { text: result.text || '', usage: result.usage || usage, toolLog, toolsUnsupported: true };
            }
            throw error;
        }
        if (result.providerClient) activeClient = result.providerClient;
        usage.promptTokens = Number(result.usage?.promptTokens || 0);
        usage.inputTokens += Number(result.usage?.promptTokens || 0);
        usage.outputTokens += Number(result.usage?.outputTokens || 0);
        usage.totalTokens += Number(result.usage?.totalTokens || 0);
        const calls = Array.isArray(result.toolCalls) ? result.toolCalls : [];
        if (!calls.length) {
            const text = String(result.text || '');
            if (!nudged && !toolLog.length && text.length < 400 && PROMISE_ONLY_RE.test(text)) {
                nudged = true;
                if (onDelta) onDelta('\n\n');
                history.push({ role: 'model', content: text });
                history.push({ role: 'user', content: '（系统提示：请现在直接调用工具执行，拿到结果后再回答，不要只描述将要做什么。）' });
                continue;
            }
            return { text, usage, toolLog };
        }
        if (result.text && onDelta) onDelta('\n\n');
        history.push({ role: 'model', content: result.text || '', toolCalls: calls });
        const toolResults = [];
        for (const call of calls) {
            const callId = call.id || `welink-${step}-${toolResults.length}`;
            const write = call.name === 'welink_action';
            const toolName = write ? 'welink_action' : 'welink_query';
            let preview = '';
            try { preview = commandLine(buildArgs(call.args && typeof call.args === 'object' ? call.args : {}, { mode: write ? 'write' : 'read' }).args); } catch { preview = String(call.args?.command || ''); }
            // 查询：先出「执行中」工具行；写操作：先出审批卡，允许后才出工具行
            let startedAt = Date.now();
            let started = false;
            const start = () => {
                if (started) return;
                started = true;
                startedAt = Date.now();
                onEvent?.({ type: 'tool_start', callId, tool: toolName, args: { command: preview } });
            };
            if (!write) start();
            const outcome = await execute({
                ...ctx, signal, callId, canApprove,
                onEvent: event => {
                    onEvent?.(event);
                    if (event.type === 'approval_result' && event.decision === 'allow') start();
                }
            }, call.name, call.args);
            if (!outcome.declined) {
                start();
                const output = verbose
                    ? `$ ${outcome.cli || preview}\n${String(outcome.raw || outcome.content || '').slice(0, VERBOSE_OUTPUT_CHARS)}`
                    : (outcome.isError ? String(outcome.content || '').slice(0, 2000) : '');
                onEvent?.({ type: 'tool_result', callId, tool: toolName, ok: !outcome.isError, summary: String(outcome.summary || '').slice(0, 200), durationMs: Date.now() - startedAt, ...(output ? { output } : {}) });
            }
            toolLog.push({ tool: call.name, ok: !outcome.isError, summary: outcome.summary });
            toolResults.push({ id: call.id, name: call.name, content: outcome.content, isError: Boolean(outcome.isError) });
        }
        history.push({ role: 'tool', toolResults });
    }
    const text = '已达到单轮最大工具调用步数，请再发一条消息继续。';
    onDelta?.(text);
    return { text, usage, toolLog };
}

module.exports = { SKILL_ID, COMMANDS, READ_COMMANDS, WRITE_COMMANDS, definitions, buildArgs, execute, decide, buildPrompt, runTurn };

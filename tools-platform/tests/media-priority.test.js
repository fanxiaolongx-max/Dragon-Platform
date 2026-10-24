const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
    DEFAULT_MEDIA_ORDER,
    DEFAULT_FEINIU_URL,
    normalizeMediaOrder,
    compareMediaOrder,
    normalizeMediaCategoryOrder,
    sortMediaCategories,
    createCategoryPinRecord,
    verifyCategoryPin
} = require('../backend/routes/media');
const {
    normalizeFeiniuUrl,
    signFeiniuAuthx
} = require('../backend/models/feiniu-service');

test('龙餐馆在未设置优先级时默认排在普通视频之前', () => {
    assert.equal(normalizeMediaOrder(undefined, true), 0);
    assert.equal(normalizeMediaOrder(undefined, false), DEFAULT_MEDIA_ORDER);

    const videos = [
        { fileName: '01_普通视频.mp4', order: normalizeMediaOrder(undefined, false) },
        { fileName: '龙餐馆_1334x720.mp4', order: normalizeMediaOrder(undefined, true) }
    ].sort(compareMediaOrder);

    assert.equal(videos[0].fileName, '龙餐馆_1334x720.mp4');
});

test('管理员设置的整数优先级优先于默认顺序', () => {
    assert.equal(normalizeMediaOrder(-5, false), -5);
    assert.equal(normalizeMediaOrder('12', false), 12);
    assert.equal(normalizeMediaOrder('not-a-number', false), DEFAULT_MEDIA_ORDER);

    const videos = [
        { fileName: '龙餐馆.mp4', order: 1 },
        { fileName: '管理员置顶.mp4', order: 0 }
    ].sort(compareMediaOrder);

    assert.equal(videos[0].fileName, '管理员置顶.mp4');
});

test('分类按优先级升序排列且全部固定在最前', () => {
    assert.equal(normalizeMediaCategoryOrder('12', 0), 12);
    assert.equal(normalizeMediaCategoryOrder('invalid', 20), 20);

    const categories = sortMediaCategories([
        { id: 'all', name: '全部' },
        { id: 'daily', name: '日常', order: 20 },
        { id: 'film', name: '影院', order: -5 },
        { id: 'letters', name: '字母', order: 10 }
    ]);
    assert.deepEqual(categories.map(category => category.id), ['all', 'film', 'letters', 'daily']);
});

test('管理端可直接修改分类优先级', () => {
    const navbarSource = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/navbar.js'), 'utf8');

    assert.match(navbarSource, /onchange="setMediaCategoryPriority\(/);
    assert.match(navbarSource, /body: JSON\.stringify\(\{ newName: category\.name, order \}\)/);
    assert.match(navbarSource, /name: 'order'/);
});

test('分类 PIN 输入框只在选择 PIN 保护时启用', () => {
    const navbarSource = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/navbar.js'), 'utf8');
    const sharedCss = fs.readFileSync(path.join(__dirname, '../frontend/css/shared.css'), 'utf8');

    assert.match(navbarSource, /enabledWhen: \{ field: 'protected', value: 'true' \}/);
    assert.match(navbarSource, /target\.disabled = !enabled/);
    assert.match(navbarSource, /classList\.toggle\('is-disabled', !enabled\)/);
    assert.match(sharedCss, /\.nav-dialog-field\.is-disabled/);
});

test('管理端可修改优先级，影视展播使用服务端排序的第一项', () => {
    const navbarSource = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/navbar.js'), 'utf8');
    const cinemaSource = fs.readFileSync(path.join(__dirname, '../frontend/pages/cinema.html'), 'utf8');

    assert.match(navbarSource, /onchange="setMediaPriority\(/);
    assert.match(navbarSource, /body: JSON\.stringify\(\{ order \}\)/);
    assert.match(cinemaSource, /const defaultFilm = allVideos\[0\]/);
    assert.match(cinemaSource, /applyVideoToPage\(defaultFilm\)/);
});

test('媒体管理不重复渲染全部分类，根目录分类使用分类 ID 筛选', () => {
    const navbarSource = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/navbar.js'), 'utf8');

    assert.match(navbarSource, /categories\.filter\(category => category\.id !== 'all'\)/);
    assert.match(navbarSource, /const filterValue = c\.folder \|\| c\.id/);
    assert.match(navbarSource, /video\.category === category\.id/);
});

test('编辑媒体时可选择分类并提交到服务端', () => {
    const navbarSource = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/navbar.js'), 'utf8');

    assert.match(navbarSource, /name: 'category', label: '所属分类'/);
    assert.match(navbarSource, /category: values\.category/);
    assert.match(navbarSource, /Array\.isArray\(field\.options\)/);
});

test('修改分类会同步移动视频和封面文件', (t) => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-media-move-'));
    t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
    fs.mkdirSync(path.join(sandbox, '旧分类'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, '旧分类', '测试.mp4'), 'video');
    fs.writeFileSync(path.join(sandbox, '旧分类', '测试_poster.jpg'), 'poster');
    const routePath = path.join(__dirname, '../backend/routes/media.js');
    const script = `const media = require(${JSON.stringify(routePath)}); process.stdout.write(media.moveMediaAssetFiles('旧分类/测试.mp4', '新分类'));`;
    const result = spawnSync(process.execPath, ['-e', script], {
        encoding: 'utf8',
        env: { ...process.env, TOOLS_MEDIA_DIR: sandbox }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '新分类/测试.mp4');
    assert.equal(fs.existsSync(path.join(sandbox, '旧分类', '测试.mp4')), false);
    assert.equal(fs.readFileSync(path.join(sandbox, '新分类', '测试.mp4'), 'utf8'), 'video');
    assert.equal(fs.readFileSync(path.join(sandbox, '新分类', '测试_poster.jpg'), 'utf8'), 'poster');
});

test('隐藏分类 PIN 使用加盐哈希存储并严格验证 4 位数字', () => {
    const record = createCategoryPinRecord('2580');
    const category = { protected: true, ...record };

    assert.equal(record.pinHash.includes('2580'), false);
    assert.equal(verifyCategoryPin(category, '2580'), true);
    assert.equal(verifyCategoryPin(category, '2581'), false);
    assert.throws(() => createCategoryPinRecord('12345'), /4 位数字/);
    assert.throws(() => createCategoryPinRecord('12ab'), /4 位数字/);
});

test('影院页对受保护分类先验证 PIN 再加载内容', () => {
    const cinemaSource = fs.readFileSync(path.join(__dirname, '../frontend/pages/cinema.html'), 'utf8');
    const mediaSource = fs.readFileSync(path.join(__dirname, '../backend/routes/media.js'), 'utf8');
    const serverSource = fs.readFileSync(path.join(__dirname, '../backend/server.js'), 'utf8');

    assert.match(cinemaSource, /\/api\/media\/public\/unlock/);
    assert.match(cinemaSource, /category\.protected \? '🔒'/);
    assert.match(mediaSource, /code: 'MEDIA_PIN_REQUIRED'/);
    assert.match(mediaSource, /categories: categories\.map\(category => sanitizeCategory\(category\)\)/);
    assert.match(serverSource, /app\.use\('\/assets\/videos', mediaAssetGuard,/);
});

test('Windows 打包版使用可写媒体目录，不在 app.asar 内创建目录', (t) => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-media-runtime-'));
    t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
    const mediaDir = path.join(sandbox, 'media');
    const routePath = path.join(__dirname, '../backend/routes/media.js');
    const script = `const media = require(${JSON.stringify(routePath)}); process.stdout.write(media.VIDEOS_DIR);`;
    const result = spawnSync(process.execPath, ['-e', script], {
        encoding: 'utf8',
        env: { ...process.env, TOOLS_MEDIA_DIR: mediaDir }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, path.resolve(mediaDir));
    assert.equal(fs.statSync(mediaDir).isDirectory(), true);

    const electronSource = fs.readFileSync(path.join(__dirname, '../electron-main.js'), 'utf8');
    assert.match(electronSource, /if \(app\.isPackaged\) \{\s*process\.env\.TOOLS_MEDIA_DIR = path\.join\(userDataPath, 'media'\);/);
});

test('全局设置影视作品支持飞牛影视对接配置且默认链接为 https://feiniu.fanxiaolong.uk/v', () => {
    assert.equal(DEFAULT_FEINIU_URL, 'https://feiniu.fanxiaolong.uk/v');
    assert.deepEqual(normalizeFeiniuUrl(''), {
        url: 'https://feiniu.fanxiaolong.uk/v',
        origin: 'https://feiniu.fanxiaolong.uk',
        apiPrefix: '/v/api/v1'
    });
    assert.deepEqual(normalizeFeiniuUrl('https://feiniu.fanxiaolong.uk/v/login'), {
        url: 'https://feiniu.fanxiaolong.uk/v',
        origin: 'https://feiniu.fanxiaolong.uk',
        apiPrefix: '/v/api/v1'
    });

    const authx = signFeiniuAuthx('POST', '/v/api/v1/item/list', { page: 1 });
    assert.match(authx, /^nonce=\d{6}&timestamp=\d+&sign=[0-9a-f]{32}$/);

    const navbarSource = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/navbar.js'), 'utf8');
    const mediaSource = fs.readFileSync(path.join(__dirname, '../backend/routes/media.js'), 'utf8');
    const cinemaSource = fs.readFileSync(path.join(__dirname, '../frontend/pages/cinema.html'), 'utf8');

    assert.match(navbarSource, /id="feiniuUrlInput"/);
    assert.match(navbarSource, /id="feiniuUsernameInput"/);
    assert.match(navbarSource, /id="feiniuPasswordInput"/);
    assert.match(navbarSource, /https:\/\/feiniu\.fanxiaolong\.uk\/v/);
    assert.match(navbarSource, /saveFeiniuMediaConfig/);
    assert.match(mediaSource, /\/admin\/feiniu\/config/);
    assert.match(mediaSource, /\/public\/feiniu\/stream\/:guid/);
    assert.match(mediaSource, /\/public\/feiniu\/hls\/:guid\/index\.m3u8/);
    assert.match(mediaSource, /\/public\/feiniu\/image/);
    assert.match(cinemaSource, /item\.hlsSrc && item\.needsTranscode/);
});

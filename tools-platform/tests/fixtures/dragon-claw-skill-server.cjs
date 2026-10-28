// Node backend for dragon-claw-skill-save-browser.cjs; keeps native SQLite outside Electron.
const express = require('../../backend/node_modules/express');
const auth = require('../../backend/middleware/auth');
const sessions = require('../../backend/models/auth-sessions-repository');
const { tenantMiddleware } = require('../../backend/models/tenant-context');
const store = require('../../backend/models/agent-skills-store');
let server, holdCatalog = false, releaseCatalog, failSave = false, saves = 0;

async function start(html) {
    for (const role of ['admin', 'viewer']) await sessions.saveSession(`fixture-${role}`, `skill-${role}`, role, Date.now() + 120000, 'default');
    const web = express(); web.use(express.json()); web.use('/api', auth.checkAuth, tenantMiddleware);
    web.get('/api/ai/skills', (_req, res, next) => {
        if (holdCatalog) {
            holdCatalog = false;
            const json = res.json.bind(res);
            res.json = body => { releaseCatalog = () => json(body); process.send({ event: 'catalogHeld' }); return res; };
        }
        next();
    });
    web.use('/api/ai', (req, res, next) => req.path === '/skills' ? next() : res.json({ items: [], models: [] }));
    web.use('/api/ai', require('../../backend/routes/ai'));
    web.post('/api/agent-skills', (_req, res, next) => {
        if (failSave) { failSave = false; return res.status(500).json({ error: '模拟保存失败' }); }
        saves++; next();
    });
    web.use('/api/agent-skills', require('../../backend/routes/agent-skills'));
    web.use('/api', (_req, res) => res.json({ items: [], models: [] }));
    web.get('/', (_req, res) => res.send(html));
    server = web.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    return `http://127.0.0.1:${server.address().port}`;
}

process.on('message', async ({ id, action, args }) => {
    try {
        let result;
        if (action === 'start') result = await start(args);
        else if (action === 'getSkill') result = await store.getSkill(args);
        else if (action === 'loadAll') result = await store.loadAll(args);
        else if (action === 'saveCount') result = saves;
        else if (action === 'hold') holdCatalog = true;
        else if (action === 'release') { releaseCatalog(); releaseCatalog = null; }
        else if (action === 'failSave') failSave = true;
        else if (action === 'close') {
            server?.closeAllConnections();
            if (server) await new Promise(resolve => server.close(resolve));
            await require('../../backend/models/tenant-sqlite-pool').closeAll();
            await require('../../backend/models/app-db').closeDatabase();
            await require('../../backend/models/platform-db').closeDatabase();
        } else throw new Error(`Unknown fixture action: ${action}`);
        process.send({ id, result });
    } catch (error) { process.send({ id, error: error.stack }); }
});
process.on('disconnect', () => process.exit(0));

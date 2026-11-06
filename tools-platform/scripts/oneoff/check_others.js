const prefsRepo = require('./models/sla-prefs-repository');
const { closeDatabase } = require('./models/app-db');

(async () => {
    const prefs = (await prefsRepo.getPrefsObject()).items;
    let othersCount = 0;
    if (prefs.labelToGroup) {
        for (let k in prefs.labelToGroup) {
            if (prefs.labelToGroup[k] === 'Others') othersCount++;
        }
    }
    console.log('Others count:', othersCount);
    await closeDatabase();
})().catch(async err => {
    console.error(err);
    try { await closeDatabase(); } catch {}
    process.exit(1);
});

// Optional local bridge; set KINDLE_QUOTA_OWNER before the first pm2 start.
module.exports = {
    apps: [{
        name: 'kindle-quota-sync',
        script: './scripts/kindle-quota-sync.js',
        cwd: __dirname,
        instances: 1,
        autorestart: true,
        watch: false,
        env: {
            KINDLE_QUOTA_OWNER: process.env.KINDLE_QUOTA_OWNER,
            KINDLE_QUOTA_TENANT: process.env.KINDLE_QUOTA_TENANT || 'default'
        }
    }]
};

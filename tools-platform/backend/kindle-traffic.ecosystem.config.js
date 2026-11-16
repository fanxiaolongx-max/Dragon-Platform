module.exports = { apps: [{ name: 'kindle-traffic-sync', script: './scripts/kindle-traffic-sync.js', cwd: __dirname, instances: 1, autorestart: true, watch: false }] };

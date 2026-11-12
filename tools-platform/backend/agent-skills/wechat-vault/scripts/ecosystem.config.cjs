// pm2 配置：微信消息库实时增量解密服务。只本机运行、不联网、不发消息。
// 启动：pm2 start ecosystem.config.cjs && pm2 save
const path = require('path');
const YICHEN = '/Volumes/512G/repos/yichen-skills/yichen-wechat-local-vault';
const LOGS = '/Volumes/512G/wechat-local-vault/realtime/logs';
module.exports = {
    apps: [{
        name: 'wechat-realtime',
        script: path.join(__dirname, 'realtime_sync.py'),
        interpreter: path.join(YICHEN, '.venv/bin/python'),
        interpreter_args: '-u',
        cwd: __dirname,
        autorestart: true,
        min_uptime: '30s',
        exp_backoff_restart_delay: 2000, // 开机时 512G 盘可能晚挂载：指数退避一直重试
        max_memory_restart: '600M',
        out_file: path.join(LOGS, 'realtime.out.log'),
        error_file: path.join(LOGS, 'realtime.err.log'),
        merge_logs: true,
        time: false,
        env: {
            WV_NODE: process.execPath,
            WV_DEBOUNCE: '1.5',
            YICHEN_WECHAT_DIR: YICHEN,
            PYTHONDONTWRITEBYTECODE: '1'
        }
    }]
};

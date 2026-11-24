#!/bin/sh
# 让 ChatGPT.app 内置的 Codex 与平台共用 app-server daemon（新版桌面已去掉旧 IPC 路由）。
# 安装一个登录项：每次登录时设置 CODEX_APP_SERVER_USE_LOCAL_DAEMON=1 并启动 daemon。
# 用法：sh codex-daemon-login-agent.sh [install|uninstall]；安装后需重开 ChatGPT.app 才会接入 daemon。
set -e
LABEL=local.codex-app-server-daemon
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
CLI=/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex
DOMAIN="gui/$(id -u)"
if [ "$1" = uninstall ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  launchctl unsetenv CODEX_APP_SERVER_USE_LOCAL_DAEMON
  echo "已卸载；重开 ChatGPT.app 后桌面恢复自带 app-server"
  exit 0
fi
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string><string>-c</string>
    <string>/bin/launchctl setenv CODEX_APP_SERVER_USE_LOCAL_DAEMON 1; $CLI app-server daemon start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/tmp/codex-app-server-daemon.log</string>
  <key>StandardErrorPath</key><string>/tmp/codex-app-server-daemon.log</string>
</dict>
</plist>
EOF
plutil -lint "$PLIST" >/dev/null
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
sleep 2
echo "CODEX_APP_SERVER_USE_LOCAL_DAEMON=$(launchctl getenv CODEX_APP_SERVER_USE_LOCAL_DAEMON)"
"$CLI" app-server daemon version
echo "完成：请退出并重开 ChatGPT.app（Cmd+Q 后从 Dock/启动台打开）"

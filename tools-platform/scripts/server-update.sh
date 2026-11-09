#!/usr/bin/env bash
# Linux 服务器上的安装与自动更新：从 GitHub 拉取 main，装依赖，重启服务，健康检查失败自动回退。
#
#   首次安装（root）：  bash server-update.sh install
#   手动更新：          bash server-update.sh update        （没有新提交时什么都不做）
#   强制重装并重启：    bash server-update.sh update --force
#   查看状态：          bash server-update.sh status
#
# install 会写入 systemd 服务 <SERVICE>.service 和每 5 分钟检查一次的 <SERVICE>-update.timer。
# 可用环境变量覆盖下面的默认值；install 时的取值保存到 /etc/<SERVICE>.conf，之后的 update 自动沿用。
# 只拉取仓库里的 tools-platform/ 目录（稀疏检出），不下载视频等大文件。
set -euo pipefail

main() {
    local action="${1:-update}" force=""
    [ "${2:-}" = "--force" ] && force=1

    SERVICE="${SERVICE:-dragon-claw}"
    [ -f "/etc/${SERVICE}.conf" ] && . "/etc/${SERVICE}.conf"
    REPO_URL="${REPO_URL:-https://github.com/fanxiaolongx-max/Dragon-Platform.git}"
    BRANCH="${BRANCH:-main}"
    INSTALL_DIR="${INSTALL_DIR:-/opt/${SERVICE}}"
    DATA_DIR="${DATA_DIR:-/opt/${SERVICE}-data}"
    PORT="${PORT:-3030}"
    RUN_USER="${RUN_USER:-root}"
    UPDATE_INTERVAL="${UPDATE_INTERVAL:-5min}"
    APP_DIR="${INSTALL_DIR}/tools-platform"

    case "$action" in
        install) install ;;
        update) update ;;
        status) status ;;
        *) echo "用法：$0 install | update [--force] | status" >&2; exit 2 ;;
    esac
}

log() { echo "[$(date '+%F %T')] $*"; }

need() { command -v "$1" >/dev/null 2>&1 || { echo "缺少 $1：$2" >&2; exit 1; }; }

fetch_source() {
    if [ ! -d "${INSTALL_DIR}/.git" ]; then
        log "首次拉取 ${REPO_URL}（仅 tools-platform/）"
        mkdir -p "$INSTALL_DIR"
        git clone --depth 1 --filter=blob:none --sparse --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
        git -C "$INSTALL_DIR" sparse-checkout set tools-platform
        return 0
    fi
    git -C "$INSTALL_DIR" fetch --quiet --depth 1 origin "$BRANCH"
}

deps_hash() {
    cat "${APP_DIR}/package-lock.json" "${APP_DIR}/backend/package-lock.json" 2>/dev/null | sha256sum | cut -d' ' -f1
}

install_deps() {
    local hash; hash="$(deps_hash)"
    if [ -z "${1:-}" ] && [ -d "${APP_DIR}/backend/node_modules" ] && [ "$(cat "${INSTALL_DIR}/.deps-hash" 2>/dev/null)" = "$hash" ]; then
        return 0
    fi
    log "安装依赖"
    # 根目录的依赖里有桌面版（Electron）的安装脚本，服务器上不需要，跳过脚本只装包
    (cd "$APP_DIR" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
    (cd "${APP_DIR}/backend" && npm ci --omit=dev --no-audit --no-fund)
    echo "$hash" > "${INSTALL_DIR}/.deps-hash"
}

prepare_assets() {
    (cd "$APP_DIR" && node scripts/ensure-builtin-assets.js) || log "内置资源准备有告警（不影响启动）"
}

healthy() {
    local i
    for i in $(seq 1 30); do
        if curl -fsS -m 3 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then return 0; fi
        sleep 2
    done
    return 1
}

owned() { [ "$RUN_USER" = "root" ] || chown -R "$RUN_USER" "$INSTALL_DIR" "$DATA_DIR"; }

update() {
    need git "apt install git"; need node "需要 Node.js 20+"; need curl "apt install curl"
    exec 9>"/tmp/${SERVICE}-update.lock"
    flock -n 9 || { log "已有更新在进行，跳过"; exit 0; }

    local before after
    before="$(git -C "$INSTALL_DIR" rev-parse HEAD 2>/dev/null || true)"
    fetch_source
    after="$(git -C "$INSTALL_DIR" rev-parse FETCH_HEAD 2>/dev/null || git -C "$INSTALL_DIR" rev-parse HEAD)"
    if [ -z "$force" ] && [ "$before" = "$after" ] && systemctl is-active --quiet "$SERVICE"; then
        exit 0
    fi

    log "更新 ${before:0:8} → ${after:0:8}"
    git -C "$INSTALL_DIR" reset --quiet --hard "$after"
    install_deps "$force"
    prepare_assets
    owned
    systemctl restart "$SERVICE"
    if healthy; then
        log "更新完成，服务正常：http://$(hostname -I | awk '{print $1}'):${PORT}"
        return 0
    fi

    log "新版本启动后健康检查失败"
    journalctl -u "$SERVICE" -n 30 --no-pager || true
    if [ -n "$before" ] && [ "$before" != "$after" ] && git -C "$INSTALL_DIR" cat-file -e "${before}^{commit}" 2>/dev/null; then
        log "回退到 ${before:0:8}"
        git -C "$INSTALL_DIR" reset --quiet --hard "$before"
        install_deps ""
        owned
        systemctl restart "$SERVICE"
        healthy && log "已回退，服务正常" || log "回退后服务仍不正常，请人工检查"
    fi
    exit 1
}

install() {
    [ "$(id -u)" = "0" ] || { echo "install 需要 root" >&2; exit 1; }
    need git "apt install git"; need node "需要 Node.js 20+"; need npm "需要 npm"; need curl "apt install curl"
    command -v bwrap >/dev/null 2>&1 || log "提醒：没有安装 bubblewrap，团队账号将不能执行命令（apt install bubblewrap）"

    mkdir -p "${DATA_DIR}/data" "${DATA_DIR}/report"
    cat > "/etc/${SERVICE}.conf" <<EOF
REPO_URL="${REPO_URL}"
BRANCH="${BRANCH}"
INSTALL_DIR="${INSTALL_DIR}"
DATA_DIR="${DATA_DIR}"
PORT="${PORT}"
RUN_USER="${RUN_USER}"
UPDATE_INTERVAL="${UPDATE_INTERVAL}"
EOF

    # 服务的环境变量：已有文件不覆盖（里面可能有你手工加的配置）
    if [ ! -f "/etc/${SERVICE}.env" ]; then
        local password="${INITIAL_ADMIN_PASSWORD:-$(head -c 12 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 16)}"
        umask 077
        cat > "/etc/${SERVICE}.env" <<EOF
PORT=${PORT}
NODE_ENV=production
TOOLS_DATA_DIR=${DATA_DIR}/data
TOOLS_REPORT_DATA_DIR=${DATA_DIR}/report
INITIAL_ADMIN_PASSWORD=${password}
EOF
        umask 022
        log "已生成 /etc/${SERVICE}.env；首次启动时 admin 的初始密码在该文件的 INITIAL_ADMIN_PASSWORD 里（仅在还没有账号时生效）"
    fi

    fetch_source
    git -C "$INSTALL_DIR" reset --quiet --hard "$(git -C "$INSTALL_DIR" rev-parse FETCH_HEAD 2>/dev/null || git -C "$INSTALL_DIR" rev-parse HEAD)"
    install_deps 1
    prepare_assets
    owned

    cat > "/etc/systemd/system/${SERVICE}.service" <<EOF
[Unit]
Description=Dragon Claw (${SERVICE})
After=network-online.target
Wants=network-online.target

[Service]
User=${RUN_USER}
WorkingDirectory=${APP_DIR}/backend
EnvironmentFile=/etc/${SERVICE}.env
ExecStart=$(command -v node) server.js
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF
    cat > "/etc/systemd/system/${SERVICE}-update.service" <<EOF
[Unit]
Description=Dragon Claw 自动更新 (${SERVICE})

[Service]
Type=oneshot
Environment=SERVICE=${SERVICE}
ExecStart=/bin/bash ${APP_DIR}/scripts/server-update.sh update
EOF
    cat > "/etc/systemd/system/${SERVICE}-update.timer" <<EOF
[Unit]
Description=Dragon Claw 定时检查更新 (${SERVICE})

[Timer]
OnBootSec=2min
OnUnitActiveSec=${UPDATE_INTERVAL}

[Install]
WantedBy=timers.target
EOF
    systemctl daemon-reload
    systemctl enable --quiet "${SERVICE}.service" "${SERVICE}-update.timer"
    systemctl restart "${SERVICE}.service"
    systemctl start "${SERVICE}-update.timer"
    if healthy; then
        log "安装完成：http://$(hostname -I | awk '{print $1}'):${PORT}  （每 ${UPDATE_INTERVAL} 检查一次更新）"
    else
        log "服务没有通过健康检查"; journalctl -u "$SERVICE" -n 40 --no-pager || true; exit 1
    fi
}

status() {
    echo "版本：$(git -C "$INSTALL_DIR" log -1 --format='%h %s (%cr)' 2>/dev/null || echo 未安装)"
    systemctl --no-pager --lines 0 status "${SERVICE}.service" 2>/dev/null | sed -n 1,5p || true
    systemctl --no-pager list-timers "${SERVICE}-update.timer" 2>/dev/null | sed -n 1,3p || true
}

# 整个脚本读完再执行：更新会改写这个文件本身
main "$@"; exit

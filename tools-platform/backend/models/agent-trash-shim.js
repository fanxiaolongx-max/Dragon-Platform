// Dragon Claw：智能体执行的命令里，rm 改为移到废纸篓（macOS 自带 /usr/bin/trash，可在访达废纸篓里恢复）。
// 做法是把一个同名的 rm 脚本放在 run_command 的 PATH 最前面：防的是模型手滑，不防故意绕过（/bin/rm、脚本内部删除照常生效）。
// - 临时目录里的文件、依赖和构建产物目录（node_modules、dist 等）直接删除，不占废纸篓；
// - 移不进废纸篓时（权限、只读卷等）退回真正的 rm，保证命令照常完成。
// 只在 macOS 且系统有 /usr/bin/trash 时启用，其他平台返回空，PATH 不变。
const fs = require('fs');
const os = require('os');
const path = require('path');

const TRASH = '/usr/bin/trash';
const VERSION = 1;
const DIRECT_DIRS = ['node_modules', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage', '.cache', '__pycache__', '.pytest_cache', 'target', '.turbo', '.parcel-cache'];

const SCRIPT = `#!/bin/sh
# Dragon Claw 智能体命令专用：rm 移到废纸篓（v${VERSION}）
real=/bin/rm
recursive=0; force=0; dironly=0
while [ $# -gt 0 ]; do
  case "$1" in
    --) shift; break ;;
    --recursive) recursive=1 ;;
    --force) force=1 ;;
    --dir) dironly=1 ;;
    --*) ;;
    -) break ;;
    -*) case "$1" in *[rR]*) recursive=1 ;; esac
        case "$1" in *f*) force=1 ;; esac
        case "$1" in *d*) dironly=1 ;; esac ;;
    *) break ;;
  esac
  shift
done
status=0
count=$#
for target do
  if [ ! -e "$target" ] && [ ! -L "$target" ]; then
    [ $force = 1 ] || { echo "rm: $target: No such file or directory" >&2; status=1; }
    continue
  fi
  if [ -d "$target" ] && [ ! -L "$target" ] && [ $recursive = 0 ]; then
    if [ $dironly = 1 ]; then "$real" -d -- "$target" || status=1; else echo "rm: $target: is a directory" >&2; status=1; fi
    continue
  fi
  parent=$(cd "$(dirname -- "$target")" 2>/dev/null && pwd -P) || parent=""
  name=$(basename -- "$target")
  case "$parent/" in
    /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*) "$real" -rf -- "$target" || status=1; continue ;;
  esac
  case "/$name/" in
${DIRECT_DIRS.map(name => `    /${name}/) "$real" -rf -- "$target" || status=1; continue ;;`).join('\n')}
  esac
  if [ -z "$parent" ]; then "$real" -rf -- "$target" || status=1; continue; fi
  set -- "$@" "$parent/$name"
done
shift $count
if [ $# -gt 0 ]; then
  if ! ${TRASH} "$@" >/dev/null 2>&1; then
    for target do [ -e "$target" ] || [ -L "$target" ] && { "$real" -rf -- "$target" || status=1; }; done
  fi
fi
exit $status
`;

let cached;

/** 返回放 rm 脚本的目录（加到 PATH 最前面）；不支持时返回空串 */
function shimDir({ platform = process.platform, trash = TRASH } = {}) {
    if (cached !== undefined) return cached;
    cached = '';
    if (platform !== 'darwin' || !fs.existsSync(trash)) return cached;
    try {
        const dir = path.join(os.tmpdir(), `dragon-claw-shims-v${VERSION}`);
        const file = path.join(dir, 'rm');
        fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== SCRIPT) fs.writeFileSync(file, SCRIPT, { mode: 0o755 });
        fs.chmodSync(file, 0o755);
        cached = dir;
    } catch (error) {
        console.warn('[agent] rm 废纸篓脚本不可用：', error.message || error);
    }
    return cached;
}

/** 给 run_command 的环境变量加上 rm 脚本目录；不支持时原样返回 */
function withShim(env) {
    const dir = shimDir();
    if (!dir) return env;
    if (!fs.existsSync(path.join(dir, 'rm'))) { cached = undefined; return withShim(env); } // 临时目录被清理过
    return { ...env, PATH: [dir, env.PATH].filter(Boolean).join(path.delimiter) };
}

module.exports = { shimDir, withShim, SCRIPT, DIRECT_DIRS };

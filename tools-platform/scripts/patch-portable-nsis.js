#!/usr/bin/env node
/*
 * 绿色版启动衔接补丁。
 *
 * electron-builder 的 portable.nsi 在解压完成后会先 BgImage::Destroy 撤下启动图、再 ExecWait 启动应用，
 * Electron 冷启动到阶段 2 启动窗口出现之间就会有 1~3 秒的空白期。portable 模板不支持自定义脚本，
 * 所以在打包前把这一段改为：异步启动应用 → 等待应用写出 .startup-window-visible 标记（或进程退出 / 20 秒超时）
 * → 再撤下启动图 → 等待应用退出并透传退出码。阶段 2 窗口与启动图同尺寸同位置，两者重叠交接。
 *
 * 脚本可重复执行；若模板结构变化导致无法匹配会直接失败，避免悄悄打出一个衔接断档的包。
 */
const fs = require('fs');
const path = require('path');

const MARKER = '; dragon-platform: splash handoff';

const ORIGINAL = /  !ifdef SPLASH_IMAGE\r?\n    BgImage::Destroy\r?\n  !endif\r?\n\r?\n\s*ExecWait "\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\} \$R0" \$0\r?\n  SetErrorLevel \$0/;

const PATCHED = `  ${MARKER}
  !ifdef SPLASH_IMAGE
    \${StdUtils.ExecShellWaitEx} $1 $2 "$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" "open" "$R0"
    \${If} $1 == "ok"
      StrCpy $3 0
      \${Do}
        \${If} \${FileExists} "$INSTDIR\\.startup-window-visible"
          \${ExitDo}
        \${EndIf}
        ; 40ms sleep that also detects app exit (WAIT_OBJECT_0 == 0)
        System::Call 'kernel32::WaitForSingleObject(p r2, i 40) i .r4'
        \${If} $4 == 0
          \${ExitDo}
        \${EndIf}
        IntOp $3 $3 + 1
        \${If} $3 >= 500
          \${ExitDo}
        \${EndIf}
      \${Loop}
      BgImage::Destroy
      \${StdUtils.WaitForProcEx} $0 $2
    \${Else}
      BgImage::Destroy
      ExecWait "$INSTDIR\\\${APP_EXECUTABLE_FILENAME} $R0" $0
    \${EndIf}
  !else
    ExecWait "$INSTDIR\\\${APP_EXECUTABLE_FILENAME} $R0" $0
  !endif
  SetErrorLevel $0`;

function patchPortableScript(source) {
    if (source.includes(MARKER)) return { changed: false, source };
    if (!ORIGINAL.test(source)) {
        throw new Error('portable.nsi 结构与预期不符，无法应用启动衔接补丁（electron-builder 版本是否已变化？）');
    }
    return { changed: true, source: source.replace(ORIGINAL, PATCHED) };
}

function resolveTemplatePath() {
    const pkg = require.resolve('app-builder-lib/package.json', { paths: [path.join(__dirname, '..')] });
    return path.join(path.dirname(pkg), 'templates/nsis/portable.nsi');
}

if (require.main === module) {
    const templatePath = resolveTemplatePath();
    const { changed, source } = patchPortableScript(fs.readFileSync(templatePath, 'utf8'));
    if (changed) fs.writeFileSync(templatePath, source);
    console.log(`[portable-nsis] ${changed ? '已应用' : '已存在'}启动衔接补丁：${templatePath}`);
}

module.exports = { patchPortableScript, resolveTemplatePath, MARKER };

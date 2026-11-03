#!/usr/bin/env node
/*
 * 绿色版启动衔接补丁。
 *
 * electron-builder 的 portable.nsi 在解压完成后会先 BgImage::Destroy 撤下启动图、再 ExecWait 启动应用，
 * Electron 冷启动到阶段 2 启动窗口出现之间就会有 1~3 秒的空白期。portable 模板不支持自定义脚本，
 * 所以在打包前把这一段改为：异步启动应用 → 等待应用写出 .startup-window-visible 标记（或进程退出 / 20 秒超时）
 * → 再撤下启动图 → 等待应用退出并透传退出码。阶段 2 窗口与启动图同尺寸同位置，两者重叠交接。
 *
 * 另外：electron-builder 默认把绿色版解压到打包时固定的 %TEMP%\<ksuid>，每次启动先 RMDir 再复制。
 * 同一版本已在运行（或退出后残留子进程锁住文件）时复制失败，弹出误导性的「Dragon Claw 无法关闭」。
 * 补丁改为：主程序被占用 → 直接启动已解压的程序，由单实例锁唤起已有窗口；只是残留文件删不掉 → 换一个新目录解压。
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

// BgImage creates its own top-level NSISBGImage window. Promote only this process's
// image, not a splash belonging to another simultaneously launched portable app.
const TOPMOST_MARKER = '; dragon-platform: topmost splash';
const TOPMOST = `    ${TOPMOST_MARKER}
    ; Keep the NSIS parent topmost too: BgImage follows its owner's z-order.
    System::Call 'user32::SetWindowPos(p $HWNDPARENT, p -1, i 0, i 0, i 0, i 0, i 0x0013)'
    Push $R7
    Push $R8
    Push $R9
    System::Call 'kernel32::GetCurrentProcessId() i .R7'
    StrCpy $R8 0
    \${Do}
      System::Call 'user32::FindWindowEx(p 0, p R8, t "NSISBGImage", p 0) p .R8'
      \${If} $R8 == 0
        \${ExitDo}
      \${EndIf}
      System::Call 'user32::GetWindowThreadProcessId(p R8, *i .R9)'
      \${If} $R9 == $R7
        System::Call 'user32::SetWindowPos(p R8, p -1, i 0, i 0, i 0, i 0, i 0x0013)'
        \${ExitDo}
      \${EndIf}
    \${Loop}
    Pop $R9
    Pop $R8
    Pop $R7`;

const REUSE_MARKER = '; dragon-platform: reuse running instance';
const UNPACK = /^  RMDir \/r \$INSTDIR\r?\n  SetOutPath \$INSTDIR$/m;
const REUSE = `  ${REUSE_MARKER}
  \${If} \${FileExists} "$INSTDIR\\\${APP_EXECUTABLE_FILENAME}"
    ClearErrors
    FileOpen $9 "$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" a
    \${If} \${Errors}
      ; 同一版本正在运行（主程序文件被占用）：不再解压，启动已解压的程序，单实例锁会唤起已有窗口
      !ifdef SPLASH_IMAGE
        BgImage::Destroy
      !endif
      System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
      System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
      System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "\${APP_FILENAME}").r0'
      \${StdUtils.GetAllParameters} $R0 0
      Exec '"$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" $R0'
      SetErrorLevel 0
      Quit
    \${EndIf}
    FileClose $9
  \${EndIf}
  RMDir /r $INSTDIR
  \${If} \${FileExists} "$INSTDIR\\*.*"
    ; 上次退出后的残留进程仍锁着部分文件：换新目录解压，避免复制失败弹窗
    System::Call 'kernel32::GetTickCount() i .r9'
    StrCpy $INSTDIR "$INSTDIR-$9"
    RMDir /r $INSTDIR
  \${EndIf}
  SetOutPath $INSTDIR`;

function patchPortableScript(source) {
    const original = source;
    if (!source.includes(MARKER)) {
        if (!ORIGINAL.test(source)) {
            throw new Error('portable.nsi 结构与预期不符，无法应用启动衔接补丁（electron-builder 版本是否已变化？）');
        }
        source = source.replace(ORIGINAL, PATCHED);
    }
    if (!source.includes(TOPMOST_MARKER)) {
        if (!/^[ \t]*BgImage::Redraw[ \t]*$/m.test(source)) {
            throw new Error('portable.nsi 缺少 BgImage::Redraw，无法应用启动置顶补丁');
        }
        source = source.replace(/(^[ \t]*BgImage::Redraw[ \t]*$)/m, '$1\n' + TOPMOST);
    }
    if (!source.includes(REUSE_MARKER)) {
        if (!UNPACK.test(source)) {
            throw new Error('portable.nsi 缺少「RMDir /r $INSTDIR / SetOutPath $INSTDIR」，无法应用运行中实例复用补丁');
        }
        source = source.replace(UNPACK, () => REUSE);
    }
    return { changed: source !== original, source };
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

module.exports = { patchPortableScript, resolveTemplatePath, MARKER, REUSE_MARKER };

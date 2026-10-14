@echo off
chcp 65001 >nul
echo ========================================================
echo  Python 通用外壳热更新启动器 — PyInstaller 本地打包脚本
echo ========================================================
echo.

cd /d "%~dp0"

echo [1/3] 正在安装/检测依赖项...
python -m pip install -r requirements.txt

echo.
echo [2/3] 正在使用 PyInstaller 编译通用外壳 EXE...
python -m PyInstaller ^
    --noconfirm ^
    --onedir ^
    --windowed ^
    --name "PR报告抽查工具" ^
    --add-data "core_script.py;." ^
    --add-data "version.json;." ^
    --add-data "updater_config.json;." ^
    universal_shell.py

echo.
echo [3/3] 整理便携绿色包...
if exist "dist\PR报告抽查工具" (
    copy /Y "core_script.py" "dist\PR报告抽查工具\" >nul
    copy /Y "version.json" "dist\PR报告抽查工具\" >nul
    copy /Y "updater_config.json" "dist\PR报告抽查工具\" >nul
    echo.
    echo ========================================================
    echo  打包完成！输出目录位于：dist\PR报告抽查工具
    echo  双击运行 PR报告抽查工具.exe 即可体验通用外壳与在线热更新！
    echo ========================================================
) else (
    echo [错误] 打包失败，请检查上方日志。
)

pause

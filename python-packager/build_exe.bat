@echo off
setlocal
chcp 65001 >nul
echo ========================================================
echo  Python 通用外壳热更新启动器 — PyInstaller 本地打包脚本
echo ========================================================
echo.

cd /d "%~dp0"

echo [1/2] 正在安装/检测依赖项...
python -m pip install -r requirements.txt
if errorlevel 1 goto :failed

echo.
echo [2/2] 正在编译通用外壳 EXE 并验证便携包...
python build_exe.py
if errorlevel 1 goto :failed

echo.
echo ========================================================
echo  打包和冒烟验证完成！输出目录：dist\PR-Audit-Sampler
echo  双击运行 PR小助手.exe 即可体验通用外壳与在线热更新！
echo ========================================================
pause
exit /b 0

:failed
echo.
echo [错误] 打包或验证失败，请检查上方日志；未生成可发布成功结果。
pause
exit /b 1

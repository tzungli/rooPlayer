@echo off
chcp 65001 >nul
echo =======================================================
echo          rooPlayer 程式版本還原精靈
echo =======================================================
echo.
echo 注意：此操作將會放棄目前所有修改，
echo 並強制將程式代碼還原至【v1.0.0-stable】穩定狀態。
echo.
set /p confirm="確定要進行還原嗎？(輸入 Y 確定，其他鍵取消): "

if /i "%confirm%"=="Y" (
    echo.
    echo 正在還原代碼...
    git reset --hard v1.0.0-stable
    git clean -fd
    echo.
    echo =======================================================
    echo   [成功] 程式已成功還原至 v1.0.0-stable 穩定還原點！
    echo =======================================================
) else (
    echo.
    echo 已取消還原操作。
)

echo.
pause

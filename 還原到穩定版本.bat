@echo off
chcp 65001 >nul
echo =======================================================
echo          rooPlayer 系統一鍵還原精靈
echo =======================================================
echo.
echo 注意：此操作將會捨棄所有未提交的修改，
echo 並強制將程式還原至【v1.8.0-stable】穩定還原點。
echo （包含 全面移除FFmpeg改用純Node音訊引擎、移除precision參數、DSP統一整合至dsp-kernel、TIDAL分段平行快取與背景預取、TIDAL升頻DSD串流至DLNA完整修復、DLNA播放音質與本機一致）
echo.
set /p confirm="確定要進行還原嗎？(輸入 Y 確認，其他取消): "

if /i "%confirm%"=="Y" (
    echo.
    echo 正在還原...
    git reset --hard v1.8.0-stable
    git clean -fd
    echo.
    echo =======================================================
    echo   [✓] 程式已成功還原至 v1.8.0-stable 穩定還原點！
    echo =======================================================
) else (
    echo.
    echo 已取消還原操作。
)

echo.
pause

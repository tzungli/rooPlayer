@echo off
chcp 65001 >nul
echo =======================================================
echo          rooPlayer 系統一鍵還原精靈
echo =======================================================
echo.
echo 注意：此操作將會捨棄所有未提交的修改，
echo 並強制將程式還原至【v1.7.0-stable】穩定還原點。
echo （包含 專輯元資料整合封面旁、推薦藝人/專輯納入TIDAL、依新增順序排序預設、KKBOX重新佈局、TIDAL封面大中小切換、導覽箭頭精準對齊、DLNA/UPnP串流專輯封面完整修復）
echo.
set /p confirm="確定要進行還原嗎？(輸入 Y 確認，其他取消): "

if /i "%confirm%"=="Y" (
    echo.
    echo 正在還原...
    git reset --hard v1.7.0-stable
    git clean -fd
    echo.
    echo =======================================================
    echo   [✓] 程式已成功還原至 v1.7.0-stable 穩定還原點！
    echo =======================================================
) else (
    echo.
    echo 已取消還原操作。
)

echo.
pause

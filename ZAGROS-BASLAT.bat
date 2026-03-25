@echo off
title Zagros OSINT Platform
color 0a
cls

echo.
echo  ==========================================
echo   Z A G R O S   O S I N T   P L A T F O R M
echo  ==========================================
echo.
echo  Jilet Zagros  ^|  Tarik Zagros  ^|  Ceyn Zagros
echo  Itachi Zagros  ^|  Boz Zagros
echo  ==========================================
echo.

cd /d "C:\Users\Shadow\CascadeProjects\sql-manager"

echo  [1/3] Onceki sunucu kapatiliyor...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo  [2/3] Zagros sunucusu baslatiliyor...
start "Zagros-Server" /min cmd /c "cd /d C:\Users\Shadow\CascadeProjects\sql-manager && node server.js"
timeout /t 4 /nobreak >nul

echo  [3/3] Internet tunneli aciliyor...
echo.
echo  =========================================
echo   HAZIR! Telefondan erisim adresi:
echo.
echo   https://zagroschecker.loca.lt
echo.
echo   NOT: Ilk aciliste sifre sorabilir.
echo   Sifre icin: https://loca.lt/mytunnelpassword
echo   (O sayfadaki IP'yi kopyalayip girin)
echo  =========================================
echo.

lt --port 5000 --subdomain zagroschecker --local-host localhost

echo.
echo  Tunnel kapandi. Yeniden baslatmak icin bu dosyayi tekrar calistirin.
pause

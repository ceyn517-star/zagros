# 🎮 Zagros OSINT - DNS Bekleme Listesi

## ⏳ Durum
**DNS ayarları bekleniyor.** Domain hazır olduğunda deployment yapılacak.

## 📋 Hazır Dosyalar
✅ `deploy.sh` - Otomatik kurulum scripti  
✅ `nginx-zagros.conf` - Nginx + SSL yapılandırması  
✅ `ecosystem.config.json` - PM2 process yönetimi  
✅ `DEPLOY.md` - Detaylı kurulum rehberi  

## 🚀 DNS Hazır Olunca Tek Komut

```bash
# VPS'e giriş
ssh root@YOUR_SERVER_IP

# Zagros'u kur
cd /root/zagros
chmod +x deploy.sh
./deploy.sh your-domain.com
```

## 📞 Tekrar Bildir
Domain DNS ayarları tamamlandığında haber ver, deployment yapacağım.

---
⏸️ **Beklemede...**

# Zagros OSINT Platform - VPS Deployment Guide

## 🚀 Hızlı Kurulum (One-Line)

```bash
# 1. VPS'e giriş yap (Ubuntu 20.04+ önerilir)
ssh root@YOUR_SERVER_IP

# 2. Zagros dosyalarını yükle (SCP ile yerelden sunucuya)
# Windows PowerShell'den:
scp -r C:\Users\Shadow\CascadeProjects\sql-manager\* root@YOUR_SERVER_IP:/root/zagros/

# 3. Sunucuda kurulum scriptini çalıştır
cd /root/zagros
chmod +x deploy.sh
./deploy.sh your-domain.com
```

## 📋 Manuel Kurulum Adımları

### 1. Gereksinimler
- Ubuntu 20.04+ veya Debian 11+
- 1GB+ RAM
- Domain name (DNS A kaydı server IP'sine yönlendirilmiş)

### 2. Node.js Kurulumu
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs
```

### 3. Uygulama Kurulumu
```bash
# Dizin oluştur
mkdir -p /var/www/zagros
cd /var/www/zagros

# Dosyaları kopyala (yerelden SCP ile veya git clone)
npm install
cd client && npm install && npm run build && cd ..
```

### 4. PM2 ile Çalıştırma
```bash
npm install -g pm2
pm2 start ecosystem.config.json
pm2 startup
pm2 save
```

### 5. Nginx + SSL Kurulumu
```bash
apt-get install -y nginx certbot python3-certbot-nginx

# Nginx config
cp nginx-zagros.conf /etc/nginx/sites-available/zagros
ln -s /etc/nginx/sites-available/zagros /etc/nginx/sites-enabled/
nginx -t && systemctl restart nginx

# SSL sertifikası
certbot --nginx -d your-domain.com -d www.your-domain.com
```

## 🔧 Yapılandırma

### API URL
`App.js` içinde API URL otomatik algılar:
- Localhost: `http://localhost:5000/api`
- Production: `/api` (relative)

### Çevre Değişkenleri
`.env` dosyası oluştur:
```
NODE_ENV=production
PORT=5000
```

### Upload Limitleri
`server.js` içinde ayarlanmış:
- Max file size: 2GB
- Timeout: 5 dakika

## 📊 Yönetim Komutları

```bash
# Durum kontrolü
pm2 status

# Logları izle
pm2 logs zagros

# Restart
pm2 restart zagros

# Güncelleme (yeni versiyon)
cd /var/www/zagros
git pull  # veya yeni dosyaları kopyala
npm install
cd client && npm run build && cd ..
pm2 restart zagros
```

## 🔒 Güvenlik

- SSL/HTTPS zorunlu (Certbot otomatik)
- Nginx reverse proxy
- PM2 process management
- Firewall (UFW) önerilir:
  ```bash
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw enable
  ```

## 🌐 DNS Ayarları

Domain sağlayıcında şu kayıtları ekle:

| Tip | Host | Değer |
|-----|------|-------|
| A | @ | YOUR_SERVER_IP |
| A | www | YOUR_SERVER_IP |

## 🆘 Sorun Giderme

### Port 5000 kullanımda
```bash
lsof -i :5000
kill -9 <PID>
```

### Nginx hatası
```bash
nginx -t  # config test
journalctl -xe
```

### PM2 başlamıyor
```bash
pm2 delete all
pm2 start ecosystem.config.json
```

## 📞 Destek
Kurulum sırasında hata alırsan `pm2 logs` çıktısını kontrol et.

# 🎮 Zagros OSINT Intelligence Platform

Full-stack OSINT (Open Source Intelligence) platform for analyzing SQL databases with automated intelligence gathering.

## ✨ Features

- **SQL Database Import** - Upload and analyze SQL dump files
- **Universal Search** - Search across all tables simultaneously
- **Automated OSINT** - Auto-detect and lookup:
  - 🎮 **Discord IDs** → username, avatar, creation date
  - 📧 **Email addresses** → breach data, reputation, validation
  - 🌐 **IP addresses** → geolocation (IPv4 + IPv6)
  - 🔐 **SSL certificates** → domain transparency logs
- **Intelligence Summary** - Structured tables with all findings
- **Dark Professional UI** - Investigator-themed interface

## 🚀 Quick Start

### Local Development
```bash
# Install dependencies
npm install
cd client && npm install && cd ..

# Build frontend
npm run build

# Start server
npm start
```
Visit `http://localhost:5000`

### One-Click Deploy (Glitch)
1. Go to [glitch.com](https://glitch.com)
2. Click "New Project" → "Import from Git"
3. Paste this repository URL
4. Wait 2-3 minutes for auto-build
5. Your public Zagros instance is ready!

### Ücretsiz Dağıtım (Render)
1. [render.com](https://render.com) adresine gidin
2. Ücretsiz hesap oluşturun
3. **"New"** → **"Web Service"** tıklayın
4. GitHub deposunuzu bağlayın
5. Build komutu: `npm run render-build`
6. Start komutu: `npm start`
7. **"Free"** planını seçin
8. **"Create Web Service"** tıklayın
9. Dağıtım tamamlandığında siteniz canlı olacak!

## 🛠️ Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: React + TailwindCSS
- **OSINT APIs**: EmailRep.io, XposedOrNot, crt.sh, ip-api.com, japi.rest
- **Database**: In-memory SQLite parsing (no persistent DB needed)

## 📊 OSINT Services (All Free, No Keys Required)

| Service | What it provides |
|---------|------------------|
| 🎮 Discord | Username, avatar, creation date from snowflake IDs |
| 🛡️ Breach | Email breach history via XposedOrNot |
| 🔍 EmailRep | Email reputation and platform registrations |
| 📧 Disify | Email format validation and disposable detection |
| 🔐 crt.sh | SSL certificate transparency logs |
| 🌐 IP-API | IPv4/IPv6 geolocation and ISP data |

## 🎯 Use Cases

- **Security Research** - Analyze leaked databases for patterns
- **Digital Forensics** - Correlate emails, IPs, Discord accounts
- **OSINT Investigations** - Extract actionable intelligence from SQL dumps
- **Academic Research** - Study data breach patterns

## ⚠️ Important

This tool is designed for legitimate security research and digital forensics. Only analyze data you have legal rights to access.

## 📄 License

MIT License - Use responsibly

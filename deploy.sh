#!/bin/bash
# Zagros Deployment Script for VPS with Custom Domain
# Usage: ./deploy.sh your-domain.com

set -e

DOMAIN=${1:-"your-domain.com"}
ZAGROS_DIR="/var/www/zagros"

echo "🎮 Zagros OSINT Platform Deployment"
echo "==================================="
echo "Domain: $DOMAIN"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Please run as root or with sudo"
    exit 1
fi

# Update system
echo "📦 Updating system packages..."
apt-get update -y

# Install Node.js 18+
echo "📦 Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Install PM2
echo "📦 Installing PM2..."
npm install -g pm2

# Install Nginx
echo "📦 Installing Nginx..."
apt-get install -y nginx

# Install Certbot for SSL
echo "📦 Installing Certbot..."
apt-get install -y certbot python3-certbot-nginx

# Create directory
echo "📁 Creating application directory..."
mkdir -p $ZAGROS_DIR
mkdir -p $ZAGROS_DIR/logs
mkdir -p $ZAGROS_DIR/uploads
mkdir -p $ZAGROS_DIR/data

# Copy files (assuming you're in the zagros directory)
echo "📂 Copying application files..."
cp -r client $ZAGROS_DIR/
cp -r server.js package.json package-lock.json ecosystem.config.json nginx-zagros.conf $ZAGROS_DIR/

# Set permissions
echo "🔒 Setting permissions..."
chown -R www-data:www-data $ZAGROS_DIR
chmod -R 755 $ZAGROS_DIR
chmod 777 $ZAGROS_DIR/uploads
chmod 777 $ZAGROS_DIR/data

# Install dependencies and build
echo "🔧 Installing dependencies..."
cd $ZAGROS_DIR
npm install
cd client
npm install
npm run build
cd ..

# Configure Nginx
echo "🌐 Configuring Nginx..."
sed -i "s/your-domain.com/$DOMAIN/g" $ZAGROS_DIR/nginx-zagros.conf
cp $ZAGROS_DIR/nginx-zagros.conf /etc/nginx/sites-available/zagros
ln -sf /etc/nginx/sites-available/zagros /etc/nginx/sites-enabled/zagros
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx

# Setup SSL
echo "🔐 Setting up SSL certificate..."
certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN || true

# Start with PM2
echo "🚀 Starting Zagros with PM2..."
cd $ZAGROS_DIR
pm2 start ecosystem.config.json
pm2 save
pm2 startup systemd -u root --hp /root

# Status
echo ""
echo "✅ Deployment Complete!"
echo "======================"
echo "🌐 Website: https://$DOMAIN"
echo "📊 PM2 Status: pm2 status"
echo "📝 Logs: pm2 logs zagros"
echo "🔄 Restart: pm2 restart zagros"
echo ""
echo "📋 Useful commands:"
echo "  pm2 status           - View process status"
echo "  pm2 logs zagros      - View logs"
echo "  pm2 restart zagros   - Restart application"
echo "  pm2 stop zagros      - Stop application"
echo ""

#!/bin/bash
# Run on the BACKEND instance (Ubuntu 22.04), from inside the cloned repo:
#   sudo bash deploy/setup-backend.sh <DB_PRIVATE_IP> <DB_PASSWORD>
set -e
DB_HOST="$1"
DB_PASS="$2"
if [ -z "$DB_HOST" ] || [ -z "$DB_PASS" ]; then
  echo "Usage: sudo bash deploy/setup-backend.sh <DB_PRIVATE_IP> <DB_PASSWORD>"; exit 1
fi

APP_DIR="$(cd "$(dirname "$0")/../backend" && pwd)"
RUN_USER="${SUDO_USER:-ubuntu}"

apt update -y
apt install -y curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

cd "$APP_DIR"
sudo -u "$RUN_USER" npm install --omit=dev

cat > "$APP_DIR/.env" <<ENV
PORT=5000
DB_HOST=${DB_HOST}
DB_PORT=3306
DB_USER=crud_user
DB_PASSWORD=${DB_PASS}
DB_NAME=cruddb
ENV
chown "$RUN_USER":"$RUN_USER" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"

cat > /etc/systemd/system/crud-backend.service <<UNIT
[Unit]
Description=CRUD Backend (Node.js)
After=network.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable crud-backend
systemctl restart crud-backend
sleep 2
systemctl --no-pager status crud-backend | head -n 5
echo "Test: curl http://localhost:5000/api/health"

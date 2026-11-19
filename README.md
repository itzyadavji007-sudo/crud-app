# 3-Tier CRUD App on AWS EC2 (Frontend · Backend · Database)

Stack: **HTML/JS frontend + Nginx** → **Node.js/Express API** → **MySQL**, with file upload.

```
Internet ──► [Frontend EC2: Nginx]  (public subnet, public IP)
                  │  /api/*  (private IP)
                  ▼
             [Backend EC2: Node/Express :5000]  (private subnet, no public IP)
                  │  3306
                  ▼
             [Database EC2: MySQL]  (private subnet, no public IP)
```

The browser only ever talks to the Frontend. Nginx serves the page and forwards `/api/*`
to the backend's private IP. The backend alone can reach MySQL.

## Project layout
```
frontend/   index.html, app.js, style.css, nginx.conf
backend/    server.js, db.js, package.json, .env.example, uploads/
database/   schema.sql
deploy/     setup-database.sh, setup-backend.sh, setup-frontend.sh
```

---
## 1. Run locally in VS Code

1. Install Node.js 20+ and MySQL 8 on your PC.
2. Create DB + user (MySQL shell):
   ```sql
   CREATE USER 'crud_user'@'localhost' IDENTIFIED BY 'change_me';
   GRANT ALL PRIVILEGES ON *.* TO 'crud_user'@'localhost';
   ```
   then `mysql -u root -p < database/schema.sql`
3. Backend:
   ```bash
   cd backend
   cp .env.example .env      # edit DB_PASSWORD
   npm install
   npm start                 # http://localhost:5000/api/health
   ```
4. Frontend: install the **Live Server** extension, right-click `frontend/index.html` → *Open with Live Server*.
   (On localhost the app calls `http://localhost:5000/api`; on the server it calls `/api`.)

## 2. Push to GitHub
```bash
git init
git add .
git commit -m "CRUD app"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```
Easiest: keep the repo **public** (no secrets are committed; `.env` is git-ignored).
For a private repo use a Personal Access Token when cloning.

## 3. AWS networking (VPC)

1. **VPC** `10.0.0.0/16`.
2. **Subnets**: `public-subnet` 10.0.1.0/24 and `private-subnet` 10.0.2.0/24 (same AZ is fine).
3. **Internet Gateway** → attach to the VPC.
4. **Public route table**: `0.0.0.0/0 → Internet Gateway`, associate with `public-subnet`.
5. **NAT Gateway** in `public-subnet` (with an Elastic IP).
6. **Private route table**: `0.0.0.0/0 → NAT Gateway`, associate with `private-subnet`.
   The NAT lets private servers *download* packages and `git clone`; nothing from the internet can reach them.
   (NAT Gateways cost money per hour — delete it when you're not installing/updating.)

### Security groups
| Group | Inbound rules |
|---|---|
| `sg-frontend` | HTTP 80 & HTTPS 443 from `0.0.0.0/0`; SSH 22 from **My IP** |
| `sg-backend`  | TCP 5000 from `sg-frontend`; SSH 22 from `sg-frontend` |
| `sg-db`       | TCP 3306 from `sg-backend`; SSH 22 from `sg-frontend` |

## 4. Launch 3 EC2 instances (Ubuntu 22.04, t2/t3.micro, same key pair)

| Instance | Subnet | Public IP | Security group |
|---|---|---|---|
| `frontend` | public-subnet | **Enable** | sg-frontend |
| `backend`  | private-subnet | Disable | sg-backend |
| `database` | private-subnet | Disable | sg-db |

Note the **private IPs** of backend and database.

## 5. Connect to the private servers (via the frontend as a jump host)
```bash
chmod 400 key.pem
ssh -i key.pem -J ubuntu@<FRONTEND_PUBLIC_IP> ubuntu@<BACKEND_PRIVATE_IP>
```
(Or use AWS Systems Manager Session Manager.)

## 6. Deploy — in this order: Database → Backend → Frontend

On **each** instance:
```bash
sudo apt update && sudo apt install -y git
git clone https://github.com/<you>/<repo>.git
cd <repo>
```

**Database instance**
```bash
sudo bash deploy/setup-database.sh MyStrongPass123 <BACKEND_PRIVATE_IP>
```

**Backend instance**
```bash
sudo bash deploy/setup-backend.sh <DB_PRIVATE_IP> MyStrongPass123
curl http://localhost:5000/api/health      # {"status":"ok","database":"connected"}
```

**Frontend instance**
```bash
sudo bash deploy/setup-frontend.sh <BACKEND_PRIVATE_IP>
```

Open `http://<FRONTEND_PUBLIC_IP>` — create, edit, delete items and upload files.

## 7. Verify it's locked down
- `http://<BACKEND_PRIVATE_IP>:5000` and the DB are unreachable from your PC (no public IP, SG blocks it).
- `curl http://<FRONTEND_PUBLIC_IP>/api/health` works (through Nginx).

## 8. Updating after code changes
```bash
# on your PC
git add . && git commit -m "change" && git push
# frontend instance
cd <repo> && git pull && sudo bash deploy/setup-frontend.sh <BACKEND_PRIVATE_IP>
# backend instance
cd <repo> && git pull && cd backend && npm install --omit=dev && sudo systemctl restart crud-backend
```

## 9. Optional: HTTPS
Point a domain at the frontend's Elastic IP, then on the frontend:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

## Troubleshooting
- **502 Bad Gateway** → backend down or `sg-backend` doesn't allow 5000 from `sg-frontend`. Check `sudo systemctl status crud-backend` and `sudo journalctl -u crud-backend -n 50`.
- **Backend: "database unreachable"** → check `sg-db` allows 3306 from `sg-backend`, the DB private IP in `backend/.env`, and that you passed the correct backend private IP to `setup-database.sh`.
- **413 Request Entity Too Large** → file over 10 MB (limit set in `nginx.conf` and `server.js`).
- **Private server can't `apt`/`git clone`** → private route table must point `0.0.0.0/0` to the NAT Gateway.
- Nginx logs: `/var/log/nginx/error.log`.

## Notes
- Uploaded files are stored on the backend instance's disk (`backend/uploads`). For production, use S3 or an EBS volume with backups.
- Set a strong DB password and never commit `.env`.

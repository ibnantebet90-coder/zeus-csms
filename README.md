# ZEUS CSMS

Sistem Manajemen Stasiun Pengisian Kendaraan Listrik berbasis OCPP 1.6, dibangun dengan FastAPI (backend) dan Next.js (frontend).

---

## Prasyarat

Pastikan perangkat Anda sudah terinstal:

- **Python** versi 3.11
- **Node.js** versi 18 atau lebih baru
- **MySQL** versi 8.0 atau lebih baru
- **Git**

---

## 1. Clone Repositori

```bash
git clone <url-repositori>
cd zeus-csms
```

---

## 2. Konfigurasi Database MySQL

Buka MySQL dan buat database serta pengguna baru:

```sql
CREATE DATABASE zeus_csms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'zeus_user'@'localhost' IDENTIFIED BY 'zeus_password';
GRANT ALL PRIVILEGES ON zeus_csms.* TO 'zeus_user'@'localhost';
FLUSH PRIVILEGES;
```

Kemudian import skema database:

```bash
mysql -u zeus_user -p zeus_csms < zeus_csms_schema.sql
```

---

## 3. Konfigurasi Backend

### 3a. Buat dan Aktifkan Virtual Environment

```bash
cd ~/Documents/zeus-csms
python3.11 -m venv venv
source venv/bin/activate
```

> Di Windows gunakan: `venv\Scripts\activate`

### 3b. Install Dependensi Python

```bash
cd backend
pip install -r requirements.txt
```

### 3c. Buat File `.env`

Buat file `.env` di dalam folder `backend/` dengan isi berikut:

```env
# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=zeus_user
DB_PASSWORD=zeus_password
DB_NAME=zeus_csms

# JWT
SECRET_KEY=ganti-dengan-secret-key-anda
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60

# OCPP Server
OCPP_HOST=127.0.0.1
OCPP_PORT=9000
HEARTBEAT_INTERVAL=30
```

> **Catatan:** Ganti nilai `SECRET_KEY` dengan string acak yang panjang dan aman.

---

## 4. Konfigurasi Frontend

```bash
cd ~/Documents/zeus-csms/frontend
npm install
```

Buat file `.env.local` di dalam folder `frontend/` dengan isi berikut:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## 5. Menjalankan Aplikasi

Buka **dua terminal** secara bersamaan.

### Terminal 1 — Backend

```bash
cd ~/Documents/zeus-csms/backend
source ../venv/bin/activate
uvicorn app.main:app --reload --port 8000 2>&1 | tee ~/Documents/zeus-csms/backend/csms.log
```

### Terminal 2 — Frontend

```bash
cd ~/Documents/zeus-csms/frontend
npm run dev
```

Buka [http://localhost:3001](http://localhost:3001) di browser.

---

## 6. Struktur Folder

```
zeus-csms/
├── backend/
│   ├── app/
│   │   ├── api/          # Endpoint FastAPI (auth, charge_points, commands, dll)
│   │   ├── core/         # Database, keamanan, WebSocket manager
│   │   ├── models/       # Model SQLAlchemy
│   │   └── schemas/      # Schema Pydantic
│   ├── ocpp_server/
│   │   ├── central_system.py   # OCPP Central System
│   │   ├── charge_point.py     # Simulator charge point
│   │   └── _cp_registry.py     # Registry singleton CP aktif
│   ├── requirements.txt
│   └── .env
├── frontend/
│   ├── app/              # Halaman Next.js (App Router)
│   ├── components/       # Komponen React
│   ├── context/          # AuthContext
│   ├── lib/              # Konfigurasi axios
│   ├── package.json
│   └── .env.local
└── zeus_csms_schema.sql
```

---

## 7. Akses API & Dokumentasi

Setelah backend berjalan, dokumentasi API tersedia di:

- **Swagger UI:** [http://localhost:8000/docs](http://localhost:8000/docs)
- **ReDoc:** [http://localhost:8000/redoc](http://localhost:8000/redoc)

---

## 8. Troubleshooting

| Masalah | Solusi |
|---|---|
| `ModuleNotFoundError` saat jalankan uvicorn | Pastikan virtual environment sudah aktif dan `pip install -r requirements.txt` sudah dijalankan |
| Port 9000 sudah digunakan | Jalankan `lsof -ti :9000 \| xargs kill -9` lalu restart backend |
| Frontend tidak bisa konek ke backend | Pastikan `NEXT_PUBLIC_API_URL` di `.env.local` sudah benar dan backend sedang berjalan |
| Charge point tidak muncul di dashboard | Pastikan `charge_point.py` sudah dijalankan dan log `Registry updated: ['CP_001']` muncul di terminal backend |
| Error CORS | Pastikan port frontend (`3000` atau `3001`) sudah terdaftar di `allow_origins` di `backend/app/main.py` |# zeus-csms

"""
Patch untuk central_system.py — tambahkan _cp_registry
agar remote command bisa mengakses CP instance yang aktif.

Jalankan script ini untuk patch file:
  python3 patch_central_system.py
"""

import os

path = os.path.expanduser(
    "~/Documents/zeus-csms/backend/ocpp_server/central_system.py"
)

content = open(path).read()

# 1. Tambah registry dict setelah import
old1 = "# ── Import ws_manager"
new1 = """# ── CP Registry — menyimpan instance CP yang aktif ──────────
_cp_registry: dict = {}

# ── Import ws_manager"""

# 2. Daftarkan CP saat connect
old2 = """    charge_point = ChargePoint(charge_point_id, websocket)

    try:
        await charge_point.start()"""
new2 = """    charge_point = ChargePoint(charge_point_id, websocket)
    _cp_registry[charge_point_id] = charge_point

    try:
        await charge_point.start()"""

# 3. Hapus dari registry saat disconnect
old3 = """    finally:
        logger.info("Charge point terputus: %s", charge_point_id)
        db_execute("""
new3 = """    finally:
        _cp_registry.pop(charge_point_id, None)
        logger.info("Charge point terputus: %s", charge_point_id)
        db_execute("""

changed = False
for old, new in [(old1, new1), (old2, new2), (old3, new3)]:
    if old in content:
        content = content.replace(old, new)
        changed = True
    else:
        print(f"WARNING: pattern tidak ditemukan:\n{old[:60]}...")

if changed:
    open(path, "w").write(content)
    print("✅ central_system.py berhasil dipatch!")
else:
    print("❌ Tidak ada perubahan — cek manual")

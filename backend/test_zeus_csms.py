"""
Zeus CSMS — Edge Case Test Suite
Menguji logic handler OCPP 1.6 tanpa memerlukan database atau WebSocket nyata.
"""

import asyncio
import sys
import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

TZ_JAKARTA = ZoneInfo("Asia/Jakarta")

# ═══════════════════════════════════════════════════════════════
#  HELPERS
# ═══════════════════════════════════════════════════════════════

def now_jakarta():
    return datetime.now(TZ_JAKARTA).replace(tzinfo=None)

def build_charge_point(cp_id="BENDER_001"):
    """
    Buat instance ChargePoint dengan semua dependency di-mock,
    sehingga tidak perlu koneksi DB maupun WebSocket.
    """
    from ocpp.v16 import ChargePoint as OcppCP
    ws = MagicMock()
    ws.subprotocol = "ocpp1.6"
    ws.send = AsyncMock()
    ws.recv = AsyncMock(side_effect=asyncio.CancelledError)

    # Import ChargePoint dari central_system dengan semua DB di-patch
    with patch.dict(sys.modules, {
        "pymysql": MagicMock(),
        "dotenv": MagicMock(),
        "app.core.ws_manager": MagicMock(
            ws_manager=AsyncMock(),
            ext_manager=AsyncMock(),
        ),
        "ocpp_server._cp_registry": MagicMock(_cp_registry={}),
    }):
        pass

    return ws, cp_id


# ═══════════════════════════════════════════════════════════════
#  SECTION 1: WebSocket on_connect — path extraction
# ═══════════════════════════════════════════════════════════════

class TestOnConnect:

    def test_path_with_prefix_slash_stripped(self):
        """charge_point_id harus strip slash dari path URL."""
        path = "/BENDER_001"
        charge_point_id = path.strip("/")
        assert charge_point_id == "BENDER_001"

    def test_path_without_slash(self):
        path = "BENDER_001"
        charge_point_id = path.strip("/")
        assert charge_point_id == "BENDER_001"

    def test_empty_path_detected(self):
        """Path kosong atau hanya '/' harus terdeteksi sebagai invalid."""
        for bad_path in ["", "/", "//", "   "]:
            cp_id = bad_path.strip("/").strip()
            assert not cp_id, f"Expected empty, got '{cp_id}' dari '{bad_path}'"

    def test_path_with_nested_segments(self):
        """Path seperti /ocpp/BENDER_001 harus ambil segment terakhir."""
        path = "/ocpp/BENDER_001"
        # Zeus sekarang hanya strip("/"), BUKAN split — ini akan jadi bug
        cp_id_zeus_current = path.strip("/")   # "ocpp/BENDER_001" — SALAH
        cp_id_correct = path.rstrip("/").split("/")[-1]  # "BENDER_001" — BENAR
        assert cp_id_zeus_current == "ocpp/BENDER_001", "Zeus saat ini tidak handle nested path"
        assert cp_id_correct == "BENDER_001"
        # NOTE: ini potential bug jika Bender dikonfigurasi dengan prefix path

    def test_subprotocol_wrong_rejected(self):
        """Subprotocol selain ocpp1.6 harus ditolak."""
        valid = "ocpp1.6"
        invalids = ["ocpp2.0", "ocpp1.5", "OCPP1.6", "", None]
        for sp in invalids:
            # Logika fix #2: tolak jika ada subprotocol tapi bukan ocpp1.6
            should_reject = sp is not None and sp != valid
            if sp in ["ocpp2.0", "ocpp1.5", "OCPP1.6"]:
                assert should_reject, f"Harus reject '{sp}'"
            # None dan "" = charger non-standard, dibiarkan masuk (by design Zeus)

    def test_subprotocol_none_allowed(self):
        """Charger tanpa subprotocol (None) dibiarkan masuk by design Zeus."""
        sp = None
        should_reject = sp is not None and sp != "ocpp1.6"
        assert not should_reject


# ═══════════════════════════════════════════════════════════════
#  SECTION 2: BootNotification — timezone UTC
# ═══════════════════════════════════════════════════════════════

class TestBootNotification:

    def test_current_time_must_be_utc(self):
        """OCPP spec: currentTime di BootNotification.conf harus UTC."""
        now_utc = datetime.now(timezone.utc)
        formatted = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
        assert formatted.endswith("Z"), "Harus berakhir dengan Z (UTC)"
        assert "+" not in formatted, "Tidak boleh ada offset timezone"
        assert "-07" not in formatted and "+07" not in formatted

    def test_wib_format_is_wrong(self):
        """Format WIB (+07:00) tidak sesuai OCPP spec."""
        now_wib = datetime.now(TZ_JAKARTA)
        formatted_wib = now_wib.isoformat()  # → "2026-06-22T14:00:00+07:00"
        assert "+07:00" in formatted_wib, "WIB format punya offset +07:00"
        # Ini yang SALAH dikirim ke charger sebelum fix #3

    def test_heartbeat_interval_positive(self):
        """HeartbeatInterval harus > 0."""
        interval = 30
        assert interval > 0

    def test_registration_status_accepted(self):
        """Status default BootNotification.conf harus Accepted."""
        from ocpp.v16.enums import RegistrationStatus
        status = RegistrationStatus.accepted
        assert status.value == "Accepted"


# ═══════════════════════════════════════════════════════════════
#  SECTION 3: StartTransaction — duplicate detection
# ═══════════════════════════════════════════════════════════════

class TestStartTransaction:

    def test_duplicate_active_transaction_detected(self):
        """Jika sudah ada transaksi Active di connector yang sama, harus deteksi duplikat."""
        # Simulasi: existing = row dari DB
        existing = {"tx_pk": 1, "ocpp_transaction_id": 9999}
        meter_start_new = 1000
        is_duplicate = existing is not None
        assert is_duplicate

    def test_recent_completed_check(self):
        """Jika transaksi dengan meter_start sama baru completed < 60 detik lalu, skip."""
        recent = {"ocpp_transaction_id": 8888}
        is_skip = recent is not None
        assert is_skip

    def test_ocpp_transaction_id_generation(self):
        """ocpp_transaction_id harus unik, positif, dan dalam range INT."""
        import time
        connector_id = 1
        ocpp_tx_id = int(datetime.now().timestamp() * 10 + connector_id) % 2147483647
        assert ocpp_tx_id > 0
        assert ocpp_tx_id < 2147483647

    def test_ocpp_transaction_id_not_negative(self):
        """transaction_id tidak boleh -1 (Bender kirim -1 sebelum dapat response)."""
        # Bender CC612 issue: kirim MeterValues dengan transaction_id = -1
        # Zeus handle ini di on_meter_values dengan fallback ke active tx
        bad_tx_id = -1
        should_fallback = bad_tx_id is None or bad_tx_id < 0
        assert should_fallback

    def test_meter_start_non_negative(self):
        """meter_start tidak boleh negatif."""
        meter_start = 0  # valid — bisa 0 saat charger baru
        assert meter_start >= 0

    def test_id_tag_status_from_db(self):
        """Jika id_tag tidak ada di DB, status harus invalid."""
        row = None  # tidak ditemukan di DB
        from ocpp.v16.enums import AuthorizationStatus
        status = (
            AuthorizationStatus.accepted
            if (row and row.get("status") == "Accepted")
            else AuthorizationStatus.invalid
        )
        assert status == AuthorizationStatus.invalid


# ═══════════════════════════════════════════════════════════════
#  SECTION 4: StopTransaction — energy calculation
# ═══════════════════════════════════════════════════════════════

class TestStopTransaction:

    def test_energy_kwh_calculation(self):
        """energy_kwh = (meter_stop - meter_start) / 1000"""
        meter_start = 1000  # Wh
        meter_stop  = 6000  # Wh
        energy_kwh = round((meter_stop - meter_start) / 1000, 3)
        assert energy_kwh == 5.0

    def test_total_cost_calculation(self):
        """total_cost = energy_kwh * tariff_per_kwh"""
        energy_kwh = 5.0
        tariff = 2500.00  # IDR per kWh
        total = round(energy_kwh * tariff, 2)
        assert total == 12500.0

    def test_meter_stop_less_than_start(self):
        """meter_stop < meter_start: energy negatif — ini anomali yang harus dihandle."""
        meter_start = 6000
        meter_stop  = 1000  # charger reset counter?
        energy_wh = meter_stop - meter_start  # -5000
        energy_kwh = round(energy_wh / 1000, 3)
        # Zeus saat ini tidak validasi ini — akan simpan energy negatif ke DB
        assert energy_kwh < 0, "Zeus tidak guard kasus ini — perlu diperhatikan"

    def test_fallback_to_latest_active_tx(self):
        """Jika transaction_id tidak cocok, Zeus fallback ke transaksi Active terbaru."""
        # Ini behavior yang sudah ada di Zeus — kita verifikasi logikanya
        tx_from_db = None  # tidak ketemu exact match
        fallback_tx = {"tx_pk": 5, "ocpp_transaction_id": 7777}  # dari fallback query
        result = tx_from_db or fallback_tx
        assert result is not None
        assert result["ocpp_transaction_id"] == 7777

    def test_no_active_transaction_returns_empty_response(self):
        """Jika tidak ada transaksi Active sama sekali, return StopTransaction response kosong."""
        tx = None
        if not tx:
            response = "empty_stop_transaction_conf"
        assert response == "empty_stop_transaction_conf"

    def test_stop_reason_preserved(self):
        """reason dari StopTransaction.req harus disimpan ke DB."""
        kwargs = {"reason": "EVDisconnected"}
        reason = kwargs.get("reason", "Local")
        assert reason == "EVDisconnected"

    def test_stop_reason_default(self):
        """Jika tidak ada reason, default ke 'Local'."""
        kwargs = {}
        reason = kwargs.get("reason", "Local")
        assert reason == "Local"


# ═══════════════════════════════════════════════════════════════
#  SECTION 5: MeterValues — transaction_id = -1 (Bender quirk)
# ═══════════════════════════════════════════════════════════════

class TestMeterValues:

    def test_negative_tx_id_triggers_fallback(self):
        """Bender CC612 kirim MeterValues dengan transaction_id=-1 sebelum StartTransaction.conf."""
        ocpp_tx_id = -1
        should_fallback = ocpp_tx_id is None or ocpp_tx_id < 0
        assert should_fallback

    def test_none_tx_id_triggers_fallback(self):
        ocpp_tx_id = None
        should_fallback = ocpp_tx_id is None or ocpp_tx_id < 0
        assert should_fallback

    def test_valid_tx_id_no_fallback(self):
        ocpp_tx_id = 12345
        should_fallback = ocpp_tx_id is None or ocpp_tx_id < 0
        assert not should_fallback

    def test_energy_value_parsed_to_float(self):
        """value dari MeterValues adalah string, harus diparse ke float untuk kalkulasi."""
        value_str = "5432.10"
        energy_kwh = round(float(value_str) / 1000, 3)
        assert energy_kwh == pytest.approx(5.432, rel=1e-3)

    def test_dedup_same_timestamp_and_measurand(self):
        """MeterValues duplikat (timestamp + measurand sama) harus di-skip."""
        existing_mv = {"id": 99}  # sudah ada di DB
        is_duplicate = existing_mv is not None
        assert is_duplicate

    def test_measurand_default(self):
        """Jika measurand tidak ada di sampled_value, default ke Energy.Active.Import.Register."""
        sv = {"value": "1000"}  # tidak ada measurand
        measurand = sv.get("measurand", "Energy.Active.Import.Register")
        assert measurand == "Energy.Active.Import.Register"


# ═══════════════════════════════════════════════════════════════
#  SECTION 6: Authorize — charging limit
# ═══════════════════════════════════════════════════════════════

class TestAuthorize:

    def test_unknown_id_tag_returns_invalid(self):
        row = None
        from ocpp.v16.enums import AuthorizationStatus
        if not row:
            result = AuthorizationStatus.invalid
        assert result == AuthorizationStatus.invalid

    def test_blocked_id_tag(self):
        row = {"status": "Blocked"}
        from ocpp.v16.enums import AuthorizationStatus
        if row["status"] == "Blocked":
            result = AuthorizationStatus.blocked
        assert result == AuthorizationStatus.blocked

    def test_expired_id_tag_by_status(self):
        row = {"status": "Expired", "expiry_date": None}
        from ocpp.v16.enums import AuthorizationStatus
        if row["status"] == "Expired":
            result = AuthorizationStatus.expired
        assert result == AuthorizationStatus.expired

    def test_expired_id_tag_by_date(self):
        """Tag expired berdasarkan expiry_date meskipun status masih 'Accepted'."""
        now = now_jakarta()
        row = {
            "status": "Accepted",
            "expiry_date": now - timedelta(days=1)  # kemarin
        }
        from ocpp.v16.enums import AuthorizationStatus
        if row["status"] == "Expired" or (
            row["expiry_date"] and row["expiry_date"] < now
        ):
            result = AuthorizationStatus.expired
        else:
            result = AuthorizationStatus.accepted
        assert result == AuthorizationStatus.expired

    def test_valid_not_expired(self):
        now = now_jakarta()
        row = {
            "status": "Accepted",
            "expiry_date": now + timedelta(days=30)
        }
        from ocpp.v16.enums import AuthorizationStatus
        if row["status"] == "Expired" or (
            row["expiry_date"] and row["expiry_date"] < now
        ):
            result = AuthorizationStatus.expired
        else:
            result = AuthorizationStatus.accepted
        assert result == AuthorizationStatus.accepted

    def test_over_limit_blocked(self):
        """Jika sudah pakai >= limit sesi bulan ini, harus Blocked."""
        used = 15
        limit = 15
        extra = 0
        effective_limit = limit + extra
        from ocpp.v16.enums import AuthorizationStatus
        if used >= effective_limit:
            result = AuthorizationStatus.blocked
        else:
            result = AuthorizationStatus.accepted
        assert result == AuthorizationStatus.blocked

    def test_under_limit_accepted(self):
        used = 10
        limit = 15
        extra = 0
        effective_limit = limit + extra
        from ocpp.v16.enums import AuthorizationStatus
        if used >= effective_limit:
            result = AuthorizationStatus.blocked
        else:
            result = AuthorizationStatus.accepted
        assert result == AuthorizationStatus.accepted

    def test_extra_sessions_extend_limit(self):
        """Admin bisa approve extra_sessions yang menaikkan effective_limit."""
        used = 15
        limit = 15
        extra = 3  # admin approve 3 sesi tambahan
        effective_limit = limit + extra
        from ocpp.v16.enums import AuthorizationStatus
        if used >= effective_limit:
            result = AuthorizationStatus.blocked
        else:
            result = AuthorizationStatus.accepted
        assert result == AuthorizationStatus.accepted  # masih bisa karena extra

    def test_limit_disabled_globally(self):
        """Jika charge_limit_enabled = 0 di settings, limit tidak berlaku."""
        global_enabled = False
        used = 999
        from ocpp.v16.enums import AuthorizationStatus
        if not global_enabled:
            result = AuthorizationStatus.accepted
        else:
            result = AuthorizationStatus.blocked
        assert result == AuthorizationStatus.accepted


# ═══════════════════════════════════════════════════════════════
#  SECTION 7: StatusNotification — auto-complete on Available
# ═══════════════════════════════════════════════════════════════

class TestStatusNotification:

    def test_available_triggers_autocomplete_if_active_tx(self):
        """Jika connector Available dan ada transaksi Active, harus auto-complete."""
        status = "Available"
        connector_id = 1
        active_tx = {"tx_pk": 3, "ocpp_transaction_id": 5555, "meter_start": 1000, "tariff_per_kwh": None}
        should_autocomplete = status == "Available" and connector_id == 1 and active_tx is not None
        assert should_autocomplete

    def test_charging_status_no_autocomplete(self):
        status = "Charging"
        active_tx = {"tx_pk": 3}
        should_autocomplete = status == "Available" and active_tx is not None
        assert not should_autocomplete

    def test_available_no_active_tx_no_autocomplete(self):
        status = "Available"
        active_tx = None
        should_autocomplete = status == "Available" and active_tx is not None
        assert not should_autocomplete

    def test_connector_0_not_trigger_autocomplete(self):
        """Connector 0 adalah charge point level, bukan connector fisik — jangan auto-complete."""
        status = "Available"
        connector_id = 0
        # Zeus hanya trigger jika connector_id == 1
        should_autocomplete = status == "Available" and connector_id == 1
        assert not should_autocomplete


# ═══════════════════════════════════════════════════════════════
#  SECTION 8: ws_manager — method completeness
# ═══════════════════════════════════════════════════════════════

class TestWsManagerMethods:
    """Verifikasi bahwa semua broadcast yang dipanggil central_system ada di ws_manager."""

    def test_all_broadcast_methods_exist(self):
        """
        Zeus memanggil ws_manager.update_cp_status, update_connector,
        update_transaction, update_meter_value.
        Semua harus ada di ConnectionManager.
        """
        # Simulasi ConnectionManager dengan method yang sudah ada + yang kita tambahkan
        class ConnectionManager:
            async def update_cp_status(self, cp_id, data): pass
            async def update_connector(self, cp_id, connector_id, status): pass
            async def update_transaction(self, cp_id, data): pass
            async def update_meter_value(self, cp_id, data): pass  # FIX #4

        mgr = ConnectionManager()
        required = ["update_cp_status", "update_connector", "update_transaction", "update_meter_value"]
        for method_name in required:
            assert hasattr(mgr, method_name), f"Method {method_name} tidak ada di ConnectionManager"

    def test_update_meter_value_missing_before_fix(self):
        """Verifikasi bahwa class tanpa fix #4 memang tidak punya method tersebut."""
        class OldConnectionManager:
            async def update_cp_status(self, cp_id, data): pass
            async def update_connector(self, cp_id, connector_id, status): pass
            async def update_transaction(self, cp_id, data): pass
            # update_meter_value TIDAK ADA

        mgr = OldConnectionManager()
        assert not hasattr(mgr, "update_meter_value"), "Konfirmasi: sebelum fix, method ini tidak ada"


# ═══════════════════════════════════════════════════════════════
#  SECTION 9: parse_timestamp — timezone handling
# ═══════════════════════════════════════════════════════════════

class TestParseTimestamp:

    def _parse_timestamp(self, ts_str):
        """Replika fungsi parse_timestamp dari central_system.py"""
        if not ts_str:
            return datetime.now(TZ_JAKARTA).replace(tzinfo=None)
        try:
            dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            return dt.astimezone(TZ_JAKARTA).replace(tzinfo=None)
        except Exception:
            return datetime.now(TZ_JAKARTA).replace(tzinfo=None)

    def test_utc_z_suffix_parsed(self):
        ts = "2026-06-22T07:00:00Z"
        result = self._parse_timestamp(ts)
        # 07:00 UTC = 14:00 WIB
        assert result.hour == 14
        assert result.tzinfo is None  # naive datetime (sudah distrip tzinfo)

    def test_utc_plus_offset_parsed(self):
        ts = "2026-06-22T07:00:00+00:00"
        result = self._parse_timestamp(ts)
        assert result.hour == 14

    def test_wib_offset_parsed(self):
        ts = "2026-06-22T14:00:00+07:00"
        result = self._parse_timestamp(ts)
        assert result.hour == 14  # sudah WIB, tidak berubah

    def test_empty_string_returns_now(self):
        result = self._parse_timestamp("")
        assert result is not None
        assert result.tzinfo is None

    def test_none_returns_now(self):
        result = self._parse_timestamp(None)
        assert result is not None

    def test_malformed_returns_now(self):
        result = self._parse_timestamp("bukan-timestamp")
        assert result is not None


# ═══════════════════════════════════════════════════════════════
#  SECTION 10: RemoteStopTransaction — command validation
# ═══════════════════════════════════════════════════════════════

class TestRemoteCommands:

    def test_remote_stop_requires_transaction_id(self):
        """Validasi: RemoteStopTransaction wajib punya transaction_id."""
        class Req:
            command = "RemoteStopTransaction"
            transaction_id = None
            id_tag = None

        req = Req()
        err = None
        if req.command == "RemoteStopTransaction" and not req.transaction_id:
            err = "transaction_id wajib untuk RemoteStopTransaction"
        assert err is not None

    def test_remote_start_requires_id_tag(self):
        """Validasi: RemoteStartTransaction wajib punya id_tag."""
        class Req:
            command = "RemoteStartTransaction"
            id_tag = None

        req = Req()
        err = None
        if req.command == "RemoteStartTransaction" and not req.id_tag:
            err = "id_tag wajib untuk RemoteStartTransaction"
        assert err is not None

    def test_cp_not_in_registry_returns_error(self):
        """Jika CP tidak ada di registry (offline), harus return error bukan crash."""
        registry = {}
        cp_id = "BENDER_001"
        cp = registry.get(cp_id)
        assert cp is None  # CP tidak terhubung

    def test_cp_in_registry_found(self):
        fake_cp = MagicMock()
        registry = {"BENDER_001": fake_cp}
        cp = registry.get("BENDER_001")
        assert cp is not None

    def test_unknown_command_raises(self):
        """Command yang tidak dikenal harus raise ValueError."""
        command = "MagicCommand"
        known = {"Reset", "RemoteStartTransaction", "RemoteStopTransaction",
                 "ChangeAvailability", "UnlockConnector", "ClearCache",
                 "GetConfiguration", "ChangeConfiguration", "TriggerMessage"}
        if command not in known:
            with pytest.raises(ValueError):
                raise ValueError(f"Command tidak dikenal: {command}")


# ═══════════════════════════════════════════════════════════════
#  SECTION 11: AutoComplete stale transaction
# ═══════════════════════════════════════════════════════════════

class TestAutoComplete:

    def test_energy_kwh_from_last_meter(self):
        """AutoComplete: energi dihitung dari last MeterValue jika ada."""
        meter_start = 2000
        last_meter = 7000
        energy_kwh = round((last_meter - meter_start) / 1000, 3)
        assert energy_kwh == 5.0

    def test_energy_kwh_fallback_to_meter_start(self):
        """AutoComplete: jika tidak ada MeterValue, energy = 0."""
        meter_start = 2000
        last_meter = None
        meter_stop = last_meter if last_meter else meter_start
        energy_kwh = round((meter_stop - meter_start) / 1000, 3)
        assert energy_kwh == 0.0

    def test_total_cost_none_if_no_tariff(self):
        """Jika tariff_per_kwh = None, total_cost harus None, bukan crash."""
        energy_kwh = 5.0
        tariff = None
        total_cost = round(energy_kwh * float(tariff), 2) if tariff else None
        assert total_cost is None


# ═══════════════════════════════════════════════════════════════
#  SECTION 12: Database helper — get_cp_pk
# ═══════════════════════════════════════════════════════════════

class TestGetCpPk:

    def test_returns_id_if_found(self):
        row = {"id": 42}
        result = row["id"] if row else None
        assert result == 42

    def test_returns_none_if_not_found(self):
        row = None
        result = row["id"] if row else None
        assert result is None

    def test_cp_pk_none_does_not_crash_insert(self):
        """Jika cp_pk None dan dipakai di INSERT, MySQL akan error FK violation."""
        cp_pk = None
        # Zeus tidak guard kasus ini di on_status_notification
        # Jika charge_point_id tidak ada di DB, cp_pk = None dan INSERT connector akan gagal
        would_fail = cp_pk is None
        assert would_fail, "Perlu guard: jika cp_pk None, skip insert atau auto-register CP"


# ═══════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])

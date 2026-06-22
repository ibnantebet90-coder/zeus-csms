-- ============================================================
--  ZEUS CSMS — Database Schema
--  Engine  : MySQL 8.x
--  Charset : utf8mb4 / utf8mb4_unicode_ci
--  Version : 0.5
-- ============================================================
--
--  CHANGELOG dari v0.4:
--  [1] Hapus id_tag_token, expiry_date_time, status dari `customers`
--      → data tag sepenuhnya di tabel `id_tags`
--  [2] Semua FK ke charge_points pakai cp.id (INT) bukan cp.charge_point_id (VARCHAR)
--      → charge_point_id tetap ada sebagai denormalized string OCPP
--  [3] Hapus charge_points.tariff_per_kwh (duplikat dengan tabel tariffs)
--  [4] Rename energy_trafo.energy_trafo_2 → reading_kwh
--      Rename energy_trafo.time_stamp     → recorded_at
--  [5] Rename connectors.timestamp        → last_status_at
--  [6] Ganti charging_limit_config (singleton) → tabel settings key-value
--  [7] Tambah FK pada charge_limit_requests ke charge_points dan users
--  [8] Hapus SET TZ (sintaks tidak valid di MySQL)
--  [9] transactions: rename transaction_id → ocpp_transaction_id
--      Tambah kolom auto_completed
--  [10] meter_values: tambah transaction_pk (FK ke transactions.id)
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------------------------------------------
-- 1. USERS  (pengguna sistem / operator)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    username        VARCHAR(64)     NOT NULL,
    password_hash   VARCHAR(255)    NOT NULL,
    role            ENUM('SuperAdmin','Admin','Guest') NOT NULL DEFAULT 'Guest',
    is_active       TINYINT(1)      NOT NULL DEFAULT 1,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Pengguna sistem — operator dan admin ZEUS CSMS';

-- ------------------------------------------------------------
-- 2. CUSTOMERS  (pelanggan / pemilik kendaraan)
--    [v0.5] Hapus id_tag_token, expiry_date_time, status
--           → data tag sepenuhnya di tabel id_tags
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    id                    INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    name                  VARCHAR(128)    NOT NULL,
    email                 VARCHAR(128)    NOT NULL,
    phone                 VARCHAR(32)         NULL,
    car_brand             VARCHAR(64)         NULL,
    car_model             VARCHAR(64)         NULL,
    car_type              ENUM('private','public') NOT NULL DEFAULT 'private',
    charge_limit_enabled  TINYINT(1)      NOT NULL DEFAULT 1
                          COMMENT 'Apakah limit bulanan berlaku untuk customer ini',
    monthly_charge_limit  TINYINT UNSIGNED    NULL
                          COMMENT 'Override limit sesi per bulan (NULL = pakai global dari settings)',
    created_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_customers_email  (email),
    INDEX idx_customers_car_brand  (car_brand)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Pelanggan / pemilik kendaraan listrik';

-- ------------------------------------------------------------
-- 3. CHARGE_POINTS  (charging station)
--    [v0.5] Hapus tariff_per_kwh (duplikat dengan tabel tariffs)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS charge_points (
    id                   INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    charge_point_id      VARCHAR(64)     NOT NULL  COMMENT 'ID string dari OCPP BootNotification',
    name                 VARCHAR(128)    NOT NULL,
    address              TEXT                NULL,
    latitude             DECIMAL(10,7)       NULL,
    longitude            DECIMAL(10,7)       NULL,
    number_of_connectors TINYINT UNSIGNED NOT NULL DEFAULT 1,
    cp_status            ENUM('Available','Preparing','Charging','SuspendedEVSE',
                              'SuspendedEV','Finishing','Reserved','Unavailable',
                              'Faulted','Unknown')
                         NOT NULL DEFAULT 'Unknown',
    is_online            TINYINT(1)      NOT NULL DEFAULT 0,
    last_heartbeat       DATETIME            NULL,
    vendor_name          VARCHAR(64)         NULL,
    model                VARCHAR(64)         NULL,
    serial_number        VARCHAR(64)         NULL,
    firmware_version     VARCHAR(64)         NULL,
    iccid                VARCHAR(64)         NULL,
    imsi                 VARCHAR(64)         NULL,
    created_at           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_cp_charge_point_id (charge_point_id),
    INDEX idx_cp_status              (cp_status),
    INDEX idx_cp_location            (latitude, longitude)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Data charging station yang terdaftar di sistem';

-- ------------------------------------------------------------
-- 4. CONNECTORS  (konektor per charge point)
--    [v0.5] FK pakai charge_points.id (INT)
--           Rename timestamp → last_status_at
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connectors (
    id                  INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    charge_point_pk     INT UNSIGNED    NOT NULL  COMMENT 'FK ke charge_points.id',
    charge_point_id     VARCHAR(64)     NOT NULL  COMMENT 'Denormalized untuk query OCPP',
    connector_id        TINYINT UNSIGNED NOT NULL,
    status              ENUM('Available','Preparing','Charging','SuspendedEVSE',
                             'SuspendedEV','Finishing','Reserved','Unavailable',
                             'Faulted','Unknown')
                        NOT NULL DEFAULT 'Unknown',
    error_code          VARCHAR(64)         NULL,
    vendor_id           VARCHAR(64)         NULL,
    vendor_error_code   VARCHAR(64)         NULL,
    info                VARCHAR(255)        NULL,
    last_status_at      DATETIME            NULL  COMMENT 'Waktu StatusNotification terakhir',
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_connector    (charge_point_pk, connector_id),
    INDEX idx_connector_status (status),
    CONSTRAINT fk_connectors_cp
        FOREIGN KEY (charge_point_pk)
        REFERENCES charge_points (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Status tiap konektor pada setiap charging station';

-- ------------------------------------------------------------
-- 5. ALERTS  (notifikasi status / error dari OCPP)
--    [v0.5] FK pakai charge_points.id (INT)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alerts (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    charge_point_pk     INT UNSIGNED    NOT NULL  COMMENT 'FK ke charge_points.id',
    charge_point_id     VARCHAR(64)     NOT NULL  COMMENT 'Denormalized untuk query',
    connector_id        TINYINT UNSIGNED    NULL,
    timestamp           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status              VARCHAR(64)     NOT NULL,
    error_code          VARCHAR(64)         NULL,
    vendor_id           VARCHAR(64)         NULL,
    vendor_error_code   VARCHAR(64)         NULL,
    info                VARCHAR(255)        NULL,
    is_resolved         TINYINT(1)      NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    INDEX idx_alerts_cp        (charge_point_pk),
    INDEX idx_alerts_timestamp (timestamp),
    INDEX idx_alerts_resolved  (is_resolved),
    CONSTRAINT fk_alerts_cp
        FOREIGN KEY (charge_point_pk)
        REFERENCES charge_points (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Log alert dan error dari charge point via OCPP StatusNotification';

-- ------------------------------------------------------------
-- 6. ID_TAGS  (OCPP authorization tags)
--    [v0.5] Tidak ada perubahan struktural;
--           kini menjadi SATU-SATUNYA sumber data tag
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS id_tags (
    id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    id_tag          VARCHAR(64)     NOT NULL,
    customer_id     INT UNSIGNED        NULL  COMMENT 'NULL = tag tanpa akun customer',
    expiry_date     DATETIME            NULL,
    status          ENUM('Accepted','Blocked','Expired','Invalid','ConcurrentTx')
                    NOT NULL DEFAULT 'Accepted',
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_id_tags_tag   (id_tag),
    INDEX idx_id_tags_status    (status),
    INDEX idx_id_tags_customer  (customer_id),
    CONSTRAINT fk_id_tags_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='OCPP authorization id_tags — satu-satunya sumber kebenaran data tag';

-- ------------------------------------------------------------
-- 7. TRANSACTIONS  (sesi pengisian daya)
--    [v0.5] FK pakai charge_points.id (INT)
--           Rename transaction_id → ocpp_transaction_id
--           Tambah kolom auto_completed
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    ocpp_transaction_id     INT UNSIGNED    NOT NULL  COMMENT 'transaction_id dari OCPP StartTransaction response',
    charge_point_pk         INT UNSIGNED    NOT NULL  COMMENT 'FK ke charge_points.id',
    charge_point_id         VARCHAR(64)     NOT NULL  COMMENT 'Denormalized untuk query OCPP',
    connector_id            TINYINT UNSIGNED NOT NULL,
    id_tag                  VARCHAR(64)         NULL,
    customer_id             INT UNSIGNED        NULL,
    start_timestamp         DATETIME            NULL,
    stop_timestamp          DATETIME            NULL,
    meter_start             INT UNSIGNED        NULL   COMMENT 'Wh saat StartTransaction',
    meter_stop              INT UNSIGNED        NULL   COMMENT 'Wh saat StopTransaction',
    energy_consumed_kwh     DECIMAL(10,3)       NULL   COMMENT 'kWh = (meter_stop - meter_start) / 1000',
    stop_reason             VARCHAR(64)         NULL,
    tariff_per_kwh          DECIMAL(10,2)       NULL   COMMENT 'Snapshot tarif saat transaksi',
    total_cost              DECIMAL(12,2)       NULL,
    status                  ENUM('Active','Completed','Invalid')
                            NOT NULL DEFAULT 'Active',
    auto_completed          TINYINT(1)      NOT NULL DEFAULT 0
                            COMMENT '1 = ditutup otomatis Zeus karena StopTransaction tidak diterima',
    created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ocpp_transaction  (ocpp_transaction_id, charge_point_pk),
    INDEX idx_tx_cp                 (charge_point_pk),
    INDEX idx_tx_connector          (charge_point_pk, connector_id),
    INDEX idx_tx_start              (start_timestamp),
    INDEX idx_tx_status             (status),
    INDEX idx_tx_customer           (customer_id),
    CONSTRAINT fk_tx_cp
        FOREIGN KEY (charge_point_pk)
        REFERENCES charge_points (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_tx_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Sesi pengisian daya — start/stop dari OCPP StartTransaction & StopTransaction';

-- ------------------------------------------------------------
-- 8. METER_VALUES  (pembacaan meter real-time dari OCPP)
--    [v0.5] FK pakai charge_points.id (INT)
--           Tambah transaction_pk (FK ke transactions.id)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meter_values (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    transaction_pk      BIGINT UNSIGNED     NULL  COMMENT 'FK ke transactions.id; NULL jika belum resolve',
    ocpp_transaction_id INT UNSIGNED        NULL  COMMENT 'Fallback: OCPP transactionId dari charger',
    charge_point_pk     INT UNSIGNED    NOT NULL  COMMENT 'FK ke charge_points.id',
    charge_point_id     VARCHAR(64)     NOT NULL  COMMENT 'Denormalized',
    connector_id        TINYINT UNSIGNED NOT NULL,
    timestamp           DATETIME        NOT NULL,
    measurand           VARCHAR(64)     NOT NULL DEFAULT 'Energy.Active.Import.Register',
    value               DECIMAL(14,4)       NULL,
    unit                VARCHAR(16)         NULL,
    context             VARCHAR(32)         NULL,
    format              VARCHAR(16)         NULL,
    phase               VARCHAR(16)         NULL,
    location            VARCHAR(16)         NULL,
    PRIMARY KEY (id),
    INDEX idx_mv_tx_pk      (transaction_pk),
    INDEX idx_mv_cp         (charge_point_pk),
    INDEX idx_mv_timestamp  (timestamp),
    INDEX idx_mv_measurand  (measurand),
    CONSTRAINT fk_mv_cp
        FOREIGN KEY (charge_point_pk)
        REFERENCES charge_points (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_mv_tx
        FOREIGN KEY (transaction_pk)
        REFERENCES transactions (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Data meter real-time dari OCPP MeterValues — untuk grafik monitoring';

-- ------------------------------------------------------------
-- 9. ENERGY_TRAFO  (pembacaan Modbus dari trafo / energy meter)
--    [v0.5] Rename time_stamp → recorded_at
--           Rename energy_trafo_2 → reading_kwh
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS energy_trafo (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    recorded_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                 COMMENT 'Waktu pembacaan Modbus',
    reading_kwh  DECIMAL(14,4)       NULL
                 COMMENT 'kWh dari Modbus register (sebelumnya: energy_trafo_2)',
    source       VARCHAR(64)         NULL
                 COMMENT 'Identifier perangkat Modbus',
    PRIMARY KEY (id),
    INDEX idx_trafo_recorded_at (recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Pembacaan energi trafo via Modbus — untuk halaman monitoring energi';

-- ------------------------------------------------------------
-- 10. TARIFFS  (konfigurasi tarif per charge point)
--     [v0.5] FK pakai charge_points.id (INT)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tariffs (
    id                  INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    charge_point_pk     INT UNSIGNED    NOT NULL  COMMENT 'FK ke charge_points.id',
    charge_point_id     VARCHAR(64)     NOT NULL  COMMENT 'Denormalized',
    cost_per_kwh        DECIMAL(10,2)   NOT NULL,
    currency            VARCHAR(8)      NOT NULL DEFAULT 'IDR',
    valid_from          DATETIME            NULL,
    valid_until         DATETIME            NULL,
    is_active           TINYINT(1)      NOT NULL DEFAULT 1,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_tariff_cp     (charge_point_pk),
    INDEX idx_tariff_active (is_active),
    CONSTRAINT fk_tariff_cp
        FOREIGN KEY (charge_point_pk)
        REFERENCES charge_points (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Konfigurasi tarif pengisian per charge point';

-- ------------------------------------------------------------
-- 11. OPENADR_EVENTS  (OpenADR VEN — event dari server VTN)
--     [v0.5] Tidak ada perubahan
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS openadr_events (
    id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    event_id        VARCHAR(128)    NOT NULL,
    signal_name     VARCHAR(64)         NULL,
    signal_type     VARCHAR(64)         NULL,
    signal_value    DECIMAL(14,4)       NULL,
    dtstart         DATETIME            NULL,
    duration        VARCHAR(32)         NULL,
    status          VARCHAR(32)         NULL,
    raw_payload     JSON                NULL,
    received_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_oadr_event_id (event_id),
    INDEX idx_oadr_dtstart (dtstart)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Event OpenADR yang diterima VEN client dari server VTN';

-- ------------------------------------------------------------
-- 12. SEND_COMMANDS  (log perintah yang dikirim ke charge point)
--     [v0.5] FK pakai charge_points.id (INT)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS send_commands (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    charge_point_pk     INT UNSIGNED    NOT NULL  COMMENT 'FK ke charge_points.id',
    charge_point_id     VARCHAR(64)     NOT NULL  COMMENT 'Denormalized',
    command             VARCHAR(64)     NOT NULL  COMMENT 'e.g. RemoteStartTransaction',
    payload             JSON                NULL,
    response            JSON                NULL,
    status              ENUM('Pending','Sent','Accepted','Rejected','Failed')
                        NOT NULL DEFAULT 'Pending',
    sent_by_user_id     INT UNSIGNED        NULL,
    sent_at             DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    responded_at        DATETIME            NULL,
    PRIMARY KEY (id),
    INDEX idx_cmd_cp     (charge_point_pk),
    INDEX idx_cmd_status (status),
    CONSTRAINT fk_cmd_cp
        FOREIGN KEY (charge_point_pk)
        REFERENCES charge_points (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_cmd_user
        FOREIGN KEY (sent_by_user_id)
        REFERENCES users (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Log perintah yang dikirim operator ke charge point via OCPP';

-- ------------------------------------------------------------
-- 13. SETTINGS  (konfigurasi sistem — key-value)
--     [v0.5] Ganti charging_limit_config singleton → generik key-value
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
    id          INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    key_name    VARCHAR(64)     NOT NULL  COMMENT 'Nama konfigurasi, e.g. monthly_charge_limit',
    value       VARCHAR(255)    NOT NULL  COMMENT 'Nilai sebagai string; parse di aplikasi',
    description VARCHAR(255)        NULL  COMMENT 'Penjelasan singkat konfigurasi',
    updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_settings_key (key_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Konfigurasi sistem global sebagai pasangan key-value';

-- ------------------------------------------------------------
-- 14. CHARGE_LIMIT_REQUESTS  (request penambahan sesi oleh customer)
--     [v0.5] Tambah FK ke charge_points dan users (resolver)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS charge_limit_requests (
    id                  INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    customer_id         INT UNSIGNED    NOT NULL,
    id_tag              VARCHAR(64)         NULL,
    charge_point_pk     INT UNSIGNED        NULL  COMMENT 'FK ke charge_points.id',
    charge_point_id     VARCHAR(64)         NULL  COMMENT 'Denormalized',
    reason              TEXT                NULL,
    status              ENUM('Pending','Approved','Rejected')
                        NOT NULL DEFAULT 'Pending',
    extra_sessions      TINYINT UNSIGNED NOT NULL DEFAULT 0
                        COMMENT 'Sesi tambahan yang disetujui admin',
    requested_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at         DATETIME            NULL,
    resolved_by_user_id INT UNSIGNED        NULL  COMMENT 'User admin yang approve/reject',
    PRIMARY KEY (id),
    INDEX idx_clr_customer     (customer_id),
    INDEX idx_clr_status       (status),
    INDEX idx_clr_charge_point (charge_point_pk),
    CONSTRAINT fk_clr_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_clr_cp
        FOREIGN KEY (charge_point_pk)
        REFERENCES charge_points (id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_clr_resolver
        FOREIGN KEY (resolved_by_user_id)
        REFERENCES users (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Request penambahan sesi pengisian oleh customer yang sudah over limit';

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
--  SEED DATA
-- ============================================================

-- SuperAdmin default
--  Password: admin123  (bcrypt hash — ganti setelah login pertama)
INSERT INTO users (username, password_hash, role) VALUES
('superadmin', '$2b$12$KIXsB5z6LbEvTQDSANLkDuW6TjBg7VrN.J.Gp/H2XKk6VGz3uWqq2', 'SuperAdmin')
ON DUPLICATE KEY UPDATE username = username;

-- Konfigurasi sistem default
INSERT INTO settings (key_name, value, description) VALUES
('monthly_charge_limit', '15', 'Batas sesi pengisian per bulan (global)'),
('charge_limit_enabled', '1',  '1 = limit aktif, 0 = limit dinonaktifkan')
ON DUPLICATE KEY UPDATE value = VALUES(value);
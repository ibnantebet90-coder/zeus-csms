-- ============================================================
--  ZEUS CSMS — Database Schema
--  Engine  : MySQL 8.x
--  Charset : utf8mb4 / utf8mb4_unicode_ci
--  Version : 0.4
-- ============================================================

SET NAMES utf8mb4;
SET TZ = Asia/Jakarta;          -- WIB (Asia/Jakarta)
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
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    id                    INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    name                  VARCHAR(128)    NOT NULL,
    email                 VARCHAR(128)    NOT NULL,
    phone                 VARCHAR(32)         NULL,
    car_brand             VARCHAR(64)         NULL,
    car_model             VARCHAR(64)         NULL,
    car_type              ENUM('private','public') NOT NULL DEFAULT 'private',
    id_tag_token          VARCHAR(64)     NOT NULL,
    expiry_date_time      DATETIME            NULL,
    status                ENUM('Accepted','Blocked','Expired','Invalid','ConcurrentTx')
                          NOT NULL DEFAULT 'Accepted',
    charge_limit_enabled  TINYINT(1)      NOT NULL DEFAULT 1
                          COMMENT 'Apakah limit bulanan berlaku untuk customer ini',
    monthly_charge_limit  TINYINT UNSIGNED    NULL
                          COMMENT 'Override limit sesi per bulan (NULL = pakai global)',
    created_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_customers_email     (email),
    UNIQUE KEY uq_customers_id_tag    (id_tag_token),
    INDEX idx_customers_status        (status),
    INDEX idx_customers_car_brand     (car_brand)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Pelanggan / pemilik kendaraan listrik';

-- ------------------------------------------------------------
-- 3. CHARGE_POINTS  (charging station)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS charge_points (
    id                   INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    charge_point_id      VARCHAR(64)     NOT NULL,
    name                 VARCHAR(128)    NOT NULL,
    address              TEXT                NULL,
    latitude             DECIMAL(10,7)       NULL,
    longitude            DECIMAL(10,7)       NULL,
    number_of_connectors TINYINT UNSIGNED NOT NULL DEFAULT 1,
    tariff_per_kwh       DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
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
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connectors (
    id                  INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    charge_point_id     VARCHAR(64)     NOT NULL,
    connector_id        TINYINT UNSIGNED NOT NULL,
    status              ENUM('Available','Preparing','Charging','SuspendedEVSE',
                             'SuspendedEV','Finishing','Reserved','Unavailable',
                             'Faulted','Unknown')
                        NOT NULL DEFAULT 'Unknown',
    error_code          VARCHAR(64)         NULL,
    vendor_id           VARCHAR(64)         NULL,
    vendor_error_code   VARCHAR(64)         NULL,
    info                VARCHAR(255)        NULL,
    timestamp           DATETIME            NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_connector (charge_point_id, connector_id),
    INDEX idx_connector_status (status),
    CONSTRAINT fk_connectors_cp
        FOREIGN KEY (charge_point_id)
        REFERENCES charge_points (charge_point_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Status tiap konektor pada setiap charging station';

-- ------------------------------------------------------------
-- 5. ALERTS  (notifikasi status / error dari OCPP)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alerts (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    charge_point_id     VARCHAR(64)     NOT NULL,
    connector_id        TINYINT UNSIGNED    NULL,
    timestamp           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status              VARCHAR(64)     NOT NULL,
    error_code          VARCHAR(64)         NULL,
    vendor_id           VARCHAR(64)         NULL,
    vendor_error_code   VARCHAR(64)         NULL,
    info                VARCHAR(255)        NULL,
    is_resolved         TINYINT(1)      NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    INDEX idx_alerts_cp        (charge_point_id),
    INDEX idx_alerts_timestamp (timestamp),
    INDEX idx_alerts_resolved  (is_resolved),
    CONSTRAINT fk_alerts_cp
        FOREIGN KEY (charge_point_id)
        REFERENCES charge_points (charge_point_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Log alert dan error dari charge point via OCPP StatusNotification';

-- ------------------------------------------------------------
-- 6. ID_TAGS  (OCPP authorization tags)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS id_tags (
    id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    id_tag          VARCHAR(64)     NOT NULL,
    customer_id     INT UNSIGNED        NULL,
    expiry_date     DATETIME            NULL,
    status          ENUM('Accepted','Blocked','Expired','Invalid','ConcurrentTx')
                    NOT NULL DEFAULT 'Accepted',
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_id_tags_tag (id_tag),
    INDEX idx_id_tags_status (status),
    CONSTRAINT fk_id_tags_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='OCPP authorization id_tags — terhubung ke tabel customers';

-- ------------------------------------------------------------
-- 7. TRANSACTIONS  (sesi pengisian daya)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    transaction_id          INT UNSIGNED    NOT NULL,
    charge_point_id         VARCHAR(64)     NOT NULL,
    connector_id            TINYINT UNSIGNED NOT NULL,
    id_tag                  VARCHAR(64)         NULL,
    customer_id             INT UNSIGNED        NULL,
    start_timestamp         DATETIME            NULL,
    stop_timestamp          DATETIME            NULL,
    meter_start             INT UNSIGNED        NULL   COMMENT 'Wh saat start',
    meter_stop              INT UNSIGNED        NULL   COMMENT 'Wh saat stop',
    energy_consumed_kwh     DECIMAL(10,3)       NULL   COMMENT 'kWh terpakai',
    stop_reason             VARCHAR(64)         NULL,
    tariff_per_kwh          DECIMAL(10,2)       NULL,
    total_cost              DECIMAL(12,2)       NULL,
    status                  ENUM('Active','Completed','Invalid')
                            NOT NULL DEFAULT 'Active',
    created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_transaction_id (transaction_id, charge_point_id),
    INDEX idx_tx_cp             (charge_point_id),
    INDEX idx_tx_connector      (charge_point_id, connector_id),
    INDEX idx_tx_start          (start_timestamp),
    INDEX idx_tx_status         (status),
    INDEX idx_tx_customer       (customer_id),
    CONSTRAINT fk_tx_cp
        FOREIGN KEY (charge_point_id)
        REFERENCES charge_points (charge_point_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_tx_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Sesi pengisian daya — start/stop dari OCPP StartTransaction & StopTransaction';

-- ------------------------------------------------------------
-- 8. METER_VALUES  (pembacaan meter real-time dari OCPP)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meter_values (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    transaction_id      INT UNSIGNED        NULL,
    charge_point_id     VARCHAR(64)     NOT NULL,
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
    INDEX idx_mv_tx         (transaction_id),
    INDEX idx_mv_cp         (charge_point_id),
    INDEX idx_mv_timestamp  (timestamp),
    INDEX idx_mv_measurand  (measurand),
    CONSTRAINT fk_mv_cp
        FOREIGN KEY (charge_point_id)
        REFERENCES charge_points (charge_point_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Data meter real-time dari OCPP MeterValues — untuk grafik monitoring';

-- ------------------------------------------------------------
-- 9. ENERGY_TRAFO  (pembacaan Modbus dari trafo / energy meter)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS energy_trafo (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    time_stamp      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    energy_trafo_2  DECIMAL(14,4)       NULL  COMMENT 'kWh dari Modbus register',
    source          VARCHAR(64)         NULL  COMMENT 'Identifier perangkat Modbus',
    PRIMARY KEY (id),
    INDEX idx_trafo_timestamp (time_stamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Pembacaan energi trafo via Modbus — untuk halaman monitoring energi';

-- ------------------------------------------------------------
-- 10. TARIFFS  (konfigurasi tarif per charge point)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tariffs (
    id                  INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    charge_point_id     VARCHAR(64)     NOT NULL,
    cost_per_kwh        DECIMAL(10,2)   NOT NULL,
    currency            VARCHAR(8)      NOT NULL DEFAULT 'IDR',
    valid_from          DATETIME            NULL,
    valid_until         DATETIME            NULL,
    is_active           TINYINT(1)      NOT NULL DEFAULT 1,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_tariff_cp     (charge_point_id),
    INDEX idx_tariff_active (is_active),
    CONSTRAINT fk_tariff_cp
        FOREIGN KEY (charge_point_id)
        REFERENCES charge_points (charge_point_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Konfigurasi tarif pengisian per charge point';

-- ------------------------------------------------------------
-- 11. OPENADR_EVENTS  (OpenADR VEN — event dari server VTN)
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
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS send_commands (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    charge_point_id     VARCHAR(64)     NOT NULL,
    command             VARCHAR(64)     NOT NULL COMMENT 'e.g. RemoteStartTransaction',
    payload             JSON                NULL,
    response            JSON                NULL,
    status              ENUM('Pending','Sent','Accepted','Rejected','Failed')
                        NOT NULL DEFAULT 'Pending',
    sent_by_user_id     INT UNSIGNED        NULL,
    sent_at             DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    responded_at        DATETIME            NULL,
    PRIMARY KEY (id),
    INDEX idx_cmd_cp     (charge_point_id),
    INDEX idx_cmd_status (status),
    CONSTRAINT fk_cmd_user
        FOREIGN KEY (sent_by_user_id)
        REFERENCES users (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Log perintah yang dikirim operator ke charge point via OCPP';

-- ------------------------------------------------------------
-- 13. CHARGING_LIMIT_CONFIG  (konfigurasi global limit sesi bulanan)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS charging_limit_config (
    id            INT UNSIGNED     NOT NULL AUTO_INCREMENT,
    monthly_limit TINYINT UNSIGNED NOT NULL DEFAULT 15
                  COMMENT 'Batas sesi pengisian per bulan (global)',
    is_enabled    TINYINT(1)       NOT NULL DEFAULT 1
                  COMMENT '1 = limit aktif, 0 = limit dinonaktifkan',
    updated_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP
                  ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Konfigurasi global batas sesi pengisian bulanan';

-- ------------------------------------------------------------
-- 14. CHARGE_LIMIT_REQUESTS  (request penambahan sesi oleh customer)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS charge_limit_requests (
    id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    customer_id     INT UNSIGNED    NOT NULL,
    id_tag          VARCHAR(64)         NULL,
    charge_point_id VARCHAR(64)         NULL,
    reason          TEXT                NULL,
    status          ENUM('Pending','Approved','Rejected')
                    NOT NULL DEFAULT 'Pending',
    extra_sessions  TINYINT UNSIGNED    NOT NULL DEFAULT 0
                    COMMENT 'Sesi tambahan yang disetujui admin',
    requested_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at     DATETIME            NULL,
    PRIMARY KEY (id),
    INDEX idx_clr_customer (customer_id),
    INDEX idx_clr_status   (status),
    CONSTRAINT fk_clr_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers (id)
        ON DELETE CASCADE ON UPDATE CASCADE
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

-- Konfigurasi limit pengisian default (15 sesi/bulan, aktif)
INSERT INTO charging_limit_config (id, monthly_limit, is_enabled)
VALUES (1, 15, 1)
ON DUPLICATE KEY UPDATE id = id;
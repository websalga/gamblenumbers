-- =============================================================================
-- GambleNumbers — DDL das tabelas do banco "bitcoin" (SQL Server / lsql2019)
-- Gerado em: 2026-08-11
-- Tabelas: snapshots | Site_Textos | FX_Snapshots
-- =============================================================================

-- =============================================================================
-- SQL SERVER (T-SQL)
-- =============================================================================

CREATE TABLE [dbo].[snapshots] (
    [id]                    INT             IDENTITY(1,1)   NOT NULL,
    [ts_utc]                DATETIME                        NOT NULL,
    [price_brl]             REAL                            NULL,
    [price_brl_binance]     REAL                            NULL,
    [price_brl_kraken]      REAL                            NULL,
    [price_brl_coinbase]    REAL                            NULL,
    [btc_usd]               DECIMAL(19,2)                   NULL,
    [price_usd_binance]     DECIMAL(19,6)                   NULL,
    [price_usd_kraken]      DECIMAL(19,6)                   NULL,
    [price_usd_coinbase]    DECIMAL(19,6)                   NULL,
    [price_eur]             DECIMAL(19,6)                   NULL,
    [price_eur_binance]     DECIMAL(19,6)                   NULL,
    [price_eur_kraken]      DECIMAL(19,6)                   NULL,
    [price_eur_coinbase]    DECIMAL(19,6)                   NULL,
    [price_gbp]             DECIMAL(19,6)                   NULL,
    [price_gbp_binance]     DECIMAL(19,6)                   NULL,
    [price_gbp_kraken]      DECIMAL(19,6)                   NULL,
    [price_gbp_coinbase]    DECIMAL(19,6)                   NULL,
    [media_exchanges_brl]   DECIMAL(19,6)                   NULL,
    [media_exchanges_usd]   DECIMAL(19,6)                   NULL,
    [media_exchanges_eur]   DECIMAL(19,6)                   NULL,
    [media_exchanges_gbp]   DECIMAL(19,6)                   NULL,
    [usd_brl]               DECIMAL(19,6)                   NULL,
    [est_2_satvb]           REAL                            NULL,
    [est_6_satvb]           REAL                            NULL,
    [est_12_satvb]          REAL                            NULL,
    [mempool_size]          INT                             NULL,
    [mempool_bytes]         INT                             NULL,
    [mempool_usage]         INT                             NULL,
    [mempoolmin_satvb]      REAL                            NULL,
    [minrelay_satvb]        REAL                            NULL,
    [confirmed_sats]        INT                             NULL,
    [confirmed_usd]         DECIMAL(38,10)                  NULL,
    [wallet_sats]           INT                             NULL,
    [cln_onchain_sats]      INT                             NULL,
    [ok]                    INT             NOT NULL        DEFAULT 1,
    [err]                   TEXT                            NULL,
    CONSTRAINT [PK_snapshots] PRIMARY KEY CLUSTERED ([id])
);
CREATE UNIQUE INDEX [UQ_snapshots_ts_utc] ON [dbo].[snapshots] ([ts_utc]);

CREATE TABLE [dbo].[FX_Snapshots] (
    [id]        INT             IDENTITY(1,1)   NOT NULL,
    [ts_utc]    DATETIME                        NOT NULL,
    [usd_brl]   DECIMAL(19,6)                   NULL,
    [usd_eur]   DECIMAL(19,6)                   NULL,
    [usd_gbp]   DECIMAL(19,6)                   NULL,
    [source]    VARCHAR(50)                     NULL,
    [usd_jpy]   DECIMAL(19,6)                   NULL,
    [usd_cny]   DECIMAL(19,6)                   NULL,
    [usd_try]   DECIMAL(19,6)                   NULL,
    [usd_rub]   DECIMAL(19,6)                   NULL,
    [ok]        INT             NOT NULL        DEFAULT 1,
    [err]       TEXT                            NULL,
    CONSTRAINT [PK_FX_Snapshots] PRIMARY KEY CLUSTERED ([id])
);

CREATE TABLE [dbo].[Site_Textos] (
    [id]            INT             IDENTITY(1,1)   NOT NULL,
    [chave]         VARCHAR(60)                     NOT NULL,
    [idioma]        VARCHAR(10)                     NOT NULL,
    [texto]         NVARCHAR(500)                   NOT NULL,
    [atualizado_em] DATETIME        NOT NULL        DEFAULT GETUTCDATE(),
    CONSTRAINT [PK_Site_Textos] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_Site_Textos_chave_idioma] UNIQUE ([chave], [idioma])
);

-- =============================================================================
-- MySQL / MariaDB
-- =============================================================================

CREATE TABLE `snapshots` (
    `id`                    INT             NOT NULL AUTO_INCREMENT,
    `ts_utc`                DATETIME        NOT NULL,
    `price_brl`             FLOAT                           DEFAULT NULL,
    `price_brl_binance`     FLOAT                           DEFAULT NULL,
    `price_brl_kraken`      FLOAT                           DEFAULT NULL,
    `price_brl_coinbase`    FLOAT                           DEFAULT NULL,
    `btc_usd`               DECIMAL(19,2)                   DEFAULT NULL,
    `price_usd_binance`     DECIMAL(19,6)                   DEFAULT NULL,
    `price_usd_kraken`      DECIMAL(19,6)                   DEFAULT NULL,
    `price_usd_coinbase`    DECIMAL(19,6)                   DEFAULT NULL,
    `price_eur`             DECIMAL(19,6)                   DEFAULT NULL,
    `price_eur_binance`     DECIMAL(19,6)                   DEFAULT NULL,
    `price_eur_kraken`      DECIMAL(19,6)                   DEFAULT NULL,
    `price_eur_coinbase`    DECIMAL(19,6)                   DEFAULT NULL,
    `price_gbp`             DECIMAL(19,6)                   DEFAULT NULL,
    `price_gbp_binance`     DECIMAL(19,6)                   DEFAULT NULL,
    `price_gbp_kraken`      DECIMAL(19,6)                   DEFAULT NULL,
    `price_gbp_coinbase`    DECIMAL(19,6)                   DEFAULT NULL,
    `media_exchanges_brl`   DECIMAL(19,6)                   DEFAULT NULL,
    `media_exchanges_usd`   DECIMAL(19,6)                   DEFAULT NULL,
    `media_exchanges_eur`   DECIMAL(19,6)                   DEFAULT NULL,
    `media_exchanges_gbp`   DECIMAL(19,6)                   DEFAULT NULL,
    `usd_brl`               DECIMAL(19,6)                   DEFAULT NULL,
    `est_2_satvb`           FLOAT                           DEFAULT NULL,
    `est_6_satvb`           FLOAT                           DEFAULT NULL,
    `est_12_satvb`          FLOAT                           DEFAULT NULL,
    `mempool_size`          INT                             DEFAULT NULL,
    `mempool_bytes`         INT                             DEFAULT NULL,
    `mempool_usage`         INT                             DEFAULT NULL,
    `mempoolmin_satvb`      FLOAT                           DEFAULT NULL,
    `minrelay_satvb`        FLOAT                           DEFAULT NULL,
    `confirmed_sats`        INT                             DEFAULT NULL,
    `confirmed_usd`         DECIMAL(38,10)                  DEFAULT NULL,
    `wallet_sats`           INT                             DEFAULT NULL,
    `cln_onchain_sats`      INT                             DEFAULT NULL,
    `ok`                    INT             NOT NULL        DEFAULT 1,
    `err`                   LONGTEXT                        DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `UQ_snapshots_ts_utc` (`ts_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `FX_Snapshots` (
    `id`        INT             NOT NULL AUTO_INCREMENT,
    `ts_utc`    DATETIME        NOT NULL,
    `usd_brl`   DECIMAL(19,6)               DEFAULT NULL,
    `usd_eur`   DECIMAL(19,6)               DEFAULT NULL,
    `usd_gbp`   DECIMAL(19,6)               DEFAULT NULL,
    `source`    VARCHAR(50)                 DEFAULT NULL,
    `usd_jpy`   DECIMAL(19,6)               DEFAULT NULL,
    `usd_cny`   DECIMAL(19,6)               DEFAULT NULL,
    `usd_try`   DECIMAL(19,6)               DEFAULT NULL,
    `usd_rub`   DECIMAL(19,6)               DEFAULT NULL,
    `ok`        INT             NOT NULL    DEFAULT 1,
    `err`       LONGTEXT                    DEFAULT NULL,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `Site_Textos` (
    `id`            INT             NOT NULL AUTO_INCREMENT,
    `chave`         VARCHAR(60)     NOT NULL,
    `idioma`        VARCHAR(10)     NOT NULL,
    `texto`         VARCHAR(500)    NOT NULL,
    `atualizado_em` DATETIME        NOT NULL DEFAULT (UTC_TIMESTAMP()),
    PRIMARY KEY (`id`),
    UNIQUE KEY `UQ_Site_Textos_chave_idioma` (`chave`, `idioma`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================================================
-- PostgreSQL
-- =============================================================================

CREATE TABLE snapshots (
    id                    SERIAL          PRIMARY KEY,
    ts_utc                TIMESTAMP       NOT NULL,
    price_brl             REAL,
    price_brl_binance     REAL,
    price_brl_kraken      REAL,
    price_brl_coinbase    REAL,
    btc_usd               NUMERIC(19,2),
    price_usd_binance     NUMERIC(19,6),
    price_usd_kraken      NUMERIC(19,6),
    price_usd_coinbase    NUMERIC(19,6),
    price_eur             NUMERIC(19,6),
    price_eur_binance     NUMERIC(19,6),
    price_eur_kraken      NUMERIC(19,6),
    price_eur_coinbase    NUMERIC(19,6),
    price_gbp             NUMERIC(19,6),
    price_gbp_binance     NUMERIC(19,6),
    price_gbp_kraken      NUMERIC(19,6),
    price_gbp_coinbase    NUMERIC(19,6),
    media_exchanges_brl   NUMERIC(19,6),
    media_exchanges_usd   NUMERIC(19,6),
    media_exchanges_eur   NUMERIC(19,6),
    media_exchanges_gbp   NUMERIC(19,6),
    usd_brl               NUMERIC(19,6),
    est_2_satvb           REAL,
    est_6_satvb           REAL,
    est_12_satvb          REAL,
    mempool_size          INTEGER,
    mempool_bytes         INTEGER,
    mempool_usage         INTEGER,
    mempoolmin_satvb      REAL,
    minrelay_satvb        REAL,
    confirmed_sats        INTEGER,
    confirmed_usd         NUMERIC(38,10),
    wallet_sats           INTEGER,
    cln_onchain_sats      INTEGER,
    ok                    INTEGER         NOT NULL DEFAULT 1,
    err                   TEXT
);
CREATE UNIQUE INDEX uq_snapshots_ts_utc ON snapshots (ts_utc);

CREATE TABLE fx_snapshots (
    id        SERIAL          PRIMARY KEY,
    ts_utc    TIMESTAMP       NOT NULL,
    usd_brl   NUMERIC(19,6),
    usd_eur   NUMERIC(19,6),
    usd_gbp   NUMERIC(19,6),
    source    VARCHAR(50),
    usd_jpy   NUMERIC(19,6),
    usd_cny   NUMERIC(19,6),
    usd_try   NUMERIC(19,6),
    usd_rub   NUMERIC(19,6),
    ok        INTEGER         NOT NULL DEFAULT 1,
    err       TEXT
);

CREATE TABLE site_textos (
    id            SERIAL          PRIMARY KEY,
    chave         VARCHAR(60)     NOT NULL,
    idioma        VARCHAR(10)     NOT NULL,
    texto         VARCHAR(500)    NOT NULL,
    atualizado_em TIMESTAMP       NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT uq_site_textos_chave_idioma UNIQUE (chave, idioma)
);

-- =============================================================================
-- Oracle
-- =============================================================================

CREATE TABLE snapshots (
    id                    NUMBER          GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ts_utc                TIMESTAMP       NOT NULL,
    price_brl             BINARY_FLOAT,
    price_brl_binance     BINARY_FLOAT,
    price_brl_kraken      BINARY_FLOAT,
    price_brl_coinbase    BINARY_FLOAT,
    btc_usd               NUMBER(19,2),
    price_usd_binance     NUMBER(19,6),
    price_usd_kraken      NUMBER(19,6),
    price_usd_coinbase    NUMBER(19,6),
    price_eur             NUMBER(19,6),
    price_eur_binance     NUMBER(19,6),
    price_eur_kraken      NUMBER(19,6),
    price_eur_coinbase    NUMBER(19,6),
    price_gbp             NUMBER(19,6),
    price_gbp_binance     NUMBER(19,6),
    price_gbp_kraken      NUMBER(19,6),
    price_gbp_coinbase    NUMBER(19,6),
    media_exchanges_brl   NUMBER(19,6),
    media_exchanges_usd   NUMBER(19,6),
    media_exchanges_eur   NUMBER(19,6),
    media_exchanges_gbp   NUMBER(19,6),
    usd_brl               NUMBER(19,6),
    est_2_satvb           BINARY_FLOAT,
    est_6_satvb           BINARY_FLOAT,
    est_12_satvb          BINARY_FLOAT,
    mempool_size          NUMBER(10),
    mempool_bytes         NUMBER(10),
    mempool_usage         NUMBER(10),
    mempoolmin_satvb      BINARY_FLOAT,
    minrelay_satvb        BINARY_FLOAT,
    confirmed_sats        NUMBER(10),
    confirmed_usd         NUMBER(38,10),
    wallet_sats           NUMBER(10),
    cln_onchain_sats      NUMBER(10),
    ok                    NUMBER(1)       DEFAULT 1 NOT NULL,
    err                   CLOB
);
CREATE UNIQUE INDEX uq_snapshots_ts_utc ON snapshots (ts_utc);

CREATE TABLE fx_snapshots (
    id        NUMBER          GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ts_utc    TIMESTAMP       NOT NULL,
    usd_brl   NUMBER(19,6),
    usd_eur   NUMBER(19,6),
    usd_gbp   NUMBER(19,6),
    source    VARCHAR2(50),
    ok        NUMBER(1)       DEFAULT 1 NOT NULL,
    err       CLOB
);

CREATE TABLE site_textos (
    id            NUMBER          GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    chave         VARCHAR2(60)    NOT NULL,
    idioma        VARCHAR2(10)    NOT NULL,
    texto         NVARCHAR2(500)  NOT NULL,
    atualizado_em TIMESTAMP       DEFAULT SYS_EXTRACT_UTC(SYSTIMESTAMP) NOT NULL,
    CONSTRAINT uq_site_textos_chave_idioma UNIQUE (chave, idioma)
);

-- =============================================================================
-- MIGRACAO 2026-08-16 — Adição de moedas fiat (JPY, CNY, TRY, RUB) a FX_Snapshots
-- =============================================================================

-- SQL Server / T-SQL
ALTER TABLE [dbo].[FX_Snapshots] ADD
    [usd_jpy]   DECIMAL(19,6)   NULL,
    [usd_cny]   DECIMAL(19,6)   NULL,
    [usd_try]   DECIMAL(19,6)   NULL,
    [usd_rub]   DECIMAL(19,6)   NULL;

-- MySQL / MariaDB
ALTER TABLE `FX_Snapshots`
    ADD COLUMN `usd_jpy` DECIMAL(19,6) DEFAULT NULL,
    ADD COLUMN `usd_cny` DECIMAL(19,6) DEFAULT NULL,
    ADD COLUMN `usd_try` DECIMAL(19,6) DEFAULT NULL,
    ADD COLUMN `usd_rub` DECIMAL(19,6) DEFAULT NULL;

-- PostgreSQL
ALTER TABLE fx_snapshots
    ADD COLUMN usd_jpy NUMERIC(19,6),
    ADD COLUMN usd_cny NUMERIC(19,6),
    ADD COLUMN usd_try NUMERIC(19,6),
    ADD COLUMN usd_rub NUMERIC(19,6);

-- Oracle
ALTER TABLE fx_snapshots ADD (
    usd_jpy NUMBER(19,6),
    usd_cny NUMBER(19,6),
    usd_try NUMBER(19,6),
    usd_rub NUMBER(19,6)
);

-- One row per page view. No IP address and no cookie: `vid` is a salted hash of
-- (ip, user agent, Malaysian calendar day) that counts a visitor once per day and
-- cannot be turned back into either input.
CREATE TABLE IF NOT EXISTS hits (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,            -- epoch milliseconds, UTC
  day     TEXT    NOT NULL,            -- YYYY-MM-DD in Asia/Kuala_Lumpur
  vid     TEXT    NOT NULL,            -- daily visitor hash, 16 hex chars
  path    TEXT    NOT NULL,
  ref     TEXT,                        -- referrer host, if any
  country TEXT,                        -- ISO 3166-1 alpha-2, e.g. MY
  state   TEXT,                        -- region name from the connection, e.g. Selangor
  city    TEXT,
  device  TEXT,                        -- phone | tablet | desktop
  browser TEXT,
  os      TEXT
);
CREATE INDEX IF NOT EXISTS hits_ts      ON hits (ts);
CREATE INDEX IF NOT EXISTS hits_day     ON hits (day);
CREATE INDEX IF NOT EXISTS hits_country ON hits (country, ts);

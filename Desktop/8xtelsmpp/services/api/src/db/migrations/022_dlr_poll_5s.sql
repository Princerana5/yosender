-- 022_dlr_poll_5s — realtime DLR polling every 5 seconds.
-- ADDITIVE ONLY: lowers the poll interval floor from 30s/10s to 5s.
ALTER TABLE vendor_http_configs ALTER COLUMN dlr_poll_interval_sec SET DEFAULT 5;
UPDATE vendor_http_configs SET dlr_poll_interval_sec = 5 WHERE dlr_poll_interval_sec > 5;

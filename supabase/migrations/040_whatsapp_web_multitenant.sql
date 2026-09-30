-- ============================================================
-- 040_whatsapp_web_multitenant.sql
-- ============================================================
-- Permitir que las conexiones directas con WhatsApp Web (QR) no
-- requieran credenciales de Meta Cloud API (access_token, verify_token, etc).

ALTER TABLE whatsapp_config ALTER COLUMN access_token DROP NOT NULL;
ALTER TABLE whatsapp_config ALTER COLUMN phone_number_id DROP NOT NULL;

-- Permitir estados adicionales de conexión
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_status_check;
ALTER TABLE whatsapp_config ADD CONSTRAINT whatsapp_config_status_check
  CHECK (status IN ('connected', 'disconnected', 'qr', 'ready', 'authenticated', 'stopped', 'error'));

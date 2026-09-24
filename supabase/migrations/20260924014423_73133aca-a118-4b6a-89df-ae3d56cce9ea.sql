ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS equipment_code text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS consecutive text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS interval_value integer NOT NULL DEFAULT 12;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS interval_unit text NOT NULL DEFAULT 'meses';
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_interval_unit_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_interval_unit_check
  CHECK (interval_unit IN ('dias', 'meses', 'anios'));
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_interval_value_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_interval_value_check
  CHECK (interval_value BETWEEN 1 AND 3650);
UPDATE public.clients SET interval_value = interval_days, interval_unit = 'dias';
ALTER TABLE public.clients ALTER COLUMN interval_days SET DEFAULT 30;
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_numero_nombre_key;
ALTER TABLE public.clients ADD CONSTRAINT clients_numero_nombre_key
  UNIQUE NULLS NOT DISTINCT (equipment_code, consecutive, name);
CREATE INDEX IF NOT EXISTS clients_numero_idx ON public.clients (equipment_code, consecutive);
CREATE INDEX IF NOT EXISTS clients_last_service_idx ON public.clients (last_service_date)
  WHERE last_service_date IS NOT NULL;
ALTER TABLE public.service_history ADD COLUMN IF NOT EXISTS client_number text;
NOTIFY pgrst, 'reload schema';
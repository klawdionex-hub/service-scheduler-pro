-- Catálogo importado desde Excel + intervalo en días/meses/años

-- Número de cliente: columna A (tipo de equipo/instalación) + columna B (consecutivo)
ALTER TABLE public.clients ADD COLUMN equipment_code text;
ALTER TABLE public.clients ADD COLUMN consecutive text;

-- Intervalo flexible: cada N días / meses / años
ALTER TABLE public.clients ADD COLUMN interval_value integer NOT NULL DEFAULT 12;
ALTER TABLE public.clients ADD COLUMN interval_unit text NOT NULL DEFAULT 'meses';
ALTER TABLE public.clients ADD CONSTRAINT clients_interval_unit_check
  CHECK (interval_unit IN ('dias', 'meses', 'anios'));
ALTER TABLE public.clients ADD CONSTRAINT clients_interval_value_check
  CHECK (interval_value BETWEEN 1 AND 3650);

-- Los clientes existentes conservan su intervalo en días
UPDATE public.clients SET interval_value = interval_days, interval_unit = 'dias';

-- interval_days ya no se usa; se deja con valor por defecto para no romper nada
ALTER TABLE public.clients ALTER COLUMN interval_days SET DEFAULT 30;

-- Evita duplicados al reimportar el Excel (NULLS NOT DISTINCT: clientes sin A/B tampoco se duplican)
ALTER TABLE public.clients ADD CONSTRAINT clients_numero_nombre_key
  UNIQUE NULLS NOT DISTINCT (equipment_code, consecutive, name);

CREATE INDEX clients_numero_idx ON public.clients (equipment_code, consecutive);
CREATE INDEX clients_last_service_idx ON public.clients (last_service_date)
  WHERE last_service_date IS NOT NULL;

-- Historial: número de cliente visible (A/B)
ALTER TABLE public.service_history ADD COLUMN client_number text;

-- Quitar los clientes de ejemplo que se crearon al inicio
DELETE FROM public.clients
WHERE (name, phone) IN (
  ('María Ortega', '+52 55 1188 2240'),
  ('Carlos Vega', '+52 55 4402 7719'),
  ('Ana Rivas', '+52 55 9033 1275'),
  ('Familia Peña', '+52 55 8890 1276'),
  ('Ing. Delgado', '+52 55 6642 9031')
);

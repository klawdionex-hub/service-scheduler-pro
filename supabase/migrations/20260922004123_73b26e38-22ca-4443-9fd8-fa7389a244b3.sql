CREATE TABLE public.clients (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  phone text,
  address text,
  service_type text,
  notes text,
  interval_days integer NOT NULL DEFAULT 30,
  last_service_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access" ON public.clients FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
INSERT INTO public.clients (name, phone, address, service_type, notes, interval_days, last_service_date) VALUES
('María Ortega', '+52 55 1188 2240', 'Col. Centro 45', 'A/C de 2 toneladas', 'Revisar compresor', 30, (current_date - interval '35 days')::date),
('Carlos Vega', '+52 55 4402 7719', 'Av. Reforma 210', 'Boiler', '', 30, (current_date - interval '26 days')::date),
('Ana Rivas', '+52 55 9033 1275', 'Calle Pino 8', 'Ventilador de techo', '', 60, (current_date - interval '10 days')::date),
('Familia Peña', '+52 55 8890 1276', 'Col. Roma Norte 122', 'Lavadora', 'Mantenimiento preventivo', 30, (current_date - interval '40 days')::date),
('Ing. Delgado', '+52 55 6642 9031', 'Col. Juárez 87', 'Aire acondicionado', 'Contrato anual', 90, (current_date - interval '20 days')::date);
CREATE TABLE public.service_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  client_name text NOT NULL,
  service_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_history TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_history TO authenticated;
GRANT ALL ON public.service_history TO service_role;

ALTER TABLE public.service_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "historial abierto" ON public.service_history FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX service_history_client_idx ON public.service_history (client_id, service_date DESC);
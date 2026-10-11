ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS maps_url text;

NOTIFY pgrst, 'reload schema';
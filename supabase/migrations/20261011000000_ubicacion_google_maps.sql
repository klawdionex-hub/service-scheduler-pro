-- Ubicación de Google Maps de cada cliente (enlace pegado desde Maps)
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS maps_url text;

NOTIFY pgrst, 'reload schema';

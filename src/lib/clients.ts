import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Client = Database["public"]["Tables"]["clients"]["Row"];
export type NewClient = Database["public"]["Tables"]["clients"]["Insert"];

export type ServiceStatus = "vencido" | "proximo" | "aldia";

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Próxima fecha en la que le toca servicio al cliente. */
export function dueDate(client: Client): Date | null {
  if (!client.last_service_date) return null;
  const last = new Date(`${client.last_service_date}T00:00:00`);
  return new Date(last.getTime() + client.interval_days * DAY_MS);
}

export function getStatus(client: Client, today = startOfToday()): ServiceStatus {
  const due = dueDate(client);
  if (!due) return "vencido";
  const diffDays = Math.round((due.getTime() - today.getTime()) / DAY_MS);
  if (diffDays < 0) return "vencido";
  if (diffDays <= 7) return "proximo";
  return "aldia";
}

export function daysOverdue(client: Client, today = startOfToday()): number {
  const due = dueDate(client);
  if (!due) return 0;
  return Math.max(0, Math.round((today.getTime() - due.getTime()) / DAY_MS));
}

const MONTHS_SHORT = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export async function fetchClients(): Promise<Client[]> {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createClient(input: NewClient): Promise<Client> {
  const { data, error } = await supabase
    .from("clients")
    .insert(input)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Marca al cliente como atendido hoy:
 * 1. Guarda la atención en el historial.
 * 2. Actualiza la fecha de último servicio, con lo que el siguiente aviso
 *    queda automáticamente programado (último servicio + cada N días).
 * El estado nunca se congela en "atendido": se recalcula solo en cada carga.
 */
export async function registerServiceToday(client: {
  id: string;
  name: string;
}): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  const { error: histError } = await supabase.from("service_history").insert({
    client_id: client.id,
    client_name: client.name,
    service_date: today,
  });
  if (histError) throw new Error(histError.message);

  const { error } = await supabase
    .from("clients")
    .update({ last_service_date: today })
    .eq("id", client.id);
  if (error) throw new Error(error.message);
}

export type HistoryEntry = {
  id: string;
  client_id: string;
  client_name: string;
  service_date: string;
};

export async function fetchHistory(): Promise<HistoryEntry[]> {
  const { data, error } = await supabase
    .from("service_history")
    .select("id, client_id, client_name, service_date")
    .order("service_date", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function deleteClient(id: string): Promise<void> {
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

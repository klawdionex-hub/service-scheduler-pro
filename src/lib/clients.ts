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

export async function registerServiceToday(id: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase
    .from("clients")
    .update({ last_service_date: today })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteClient(id: string): Promise<void> {
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

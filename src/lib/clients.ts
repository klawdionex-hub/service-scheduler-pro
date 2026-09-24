import { addDays, addMonths, addYears } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Client = Database["public"]["Tables"]["clients"]["Row"];
export type NewClient = Database["public"]["Tables"]["clients"]["Insert"];
export type HistoryEntry = Database["public"]["Tables"]["service_history"]["Row"];

export type IntervalUnit = "dias" | "meses" | "anios";

/**
 * Estado del cliente, calculado siempre al vuelo (nunca se guarda):
 * - sinprogramar: aún no tiene fecha de último servicio.
 * - atrasado: su fecha objetivo ya pasó y no se ha registrado la atención.
 * - hoy / manana: le toca hoy o mañana (aviso con 1 día de anticipación).
 * - pendiente: su siguiente servicio está más adelante.
 */
export type ServiceStatus = "sinprogramar" | "atrasado" | "hoy" | "manana" | "pendiente";

export const UNIT_LABEL: Record<IntervalUnit, [singular: string, plural: string]> = {
  dias: ["día", "días"],
  meses: ["mes", "meses"],
  anios: ["año", "años"],
};

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 1000; // Supabase devuelve como máximo 1000 filas por consulta

/* ---------------- Fechas (siempre en hora local) ---------------- */

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Fecha local a "AAAA-MM-DD" (toISOString usa UTC y puede adelantar un día). */
export function toLocalISO(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function parseISODate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

const MONTHS_SHORT = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

export function formatDate(value: string | Date | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? parseISODate(value) : value;
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/* ---------------- Cálculo de servicios ---------------- */

function unitOf(client: Client): IntervalUnit {
  return client.interval_unit === "dias" || client.interval_unit === "anios"
    ? client.interval_unit
    : "meses";
}

function addInterval(base: Date, amount: number, unit: IntervalUnit): Date {
  if (unit === "dias") return addDays(base, amount);
  if (unit === "anios") return addYears(base, amount);
  return addMonths(base, amount);
}

export function intervalLabel(client: Pick<Client, "interval_value" | "interval_unit">): string {
  const unit = (
    client.interval_unit in UNIT_LABEL ? client.interval_unit : "meses"
  ) as IntervalUnit;
  const [one, many] = UNIT_LABEL[unit];
  return `cada ${client.interval_value} ${client.interval_value === 1 ? one : many}`;
}

/** Servicio número k contado desde el último servicio (k = 1 es el siguiente). */
function occurrence(client: Client, k: number): Date | null {
  if (!client.last_service_date) return null;
  // Se calcula siempre desde la fecha base para no perder el día del mes (ej. 31)
  return addInterval(
    parseISODate(client.last_service_date),
    k * client.interval_value,
    unitOf(client),
  );
}

/** Siguiente fecha objetivo = último servicio + intervalo. */
export function nextDueDate(client: Client): Date | null {
  return occurrence(client, 1);
}

/** Todas las fechas de servicio del cliente entre `from` y `to` (inclusive). */
export function projectedDates(client: Client, from: Date, to: Date): { date: Date; k: number }[] {
  const out: { date: Date; k: number }[] = [];
  if (!client.last_service_date || client.interval_value < 1) return out;
  for (let k = 1; k <= 20000; k++) {
    const d = occurrence(client, k)!;
    if (d > to) break;
    if (d >= from) out.push({ date: d, k });
  }
  return out;
}

export function getStatus(client: Client, today = startOfToday()): ServiceStatus {
  const due = nextDueDate(client);
  if (!due) return "sinprogramar";
  const diff = Math.round((due.getTime() - today.getTime()) / DAY_MS);
  if (diff < 0) return "atrasado";
  if (diff === 0) return "hoy";
  if (diff === 1) return "manana";
  return "pendiente";
}

export function daysOverdue(client: Client, today = startOfToday()): number {
  const due = nextDueDate(client);
  if (!due) return 0;
  return Math.max(0, Math.round((today.getTime() - due.getTime()) / DAY_MS));
}

/* ---------------- Presentación ---------------- */

/** Número de cliente: columna A (tipo de equipo) / columna B (consecutivo). */
export function clientNumber(client: Pick<Client, "equipment_code" | "consecutive">): string {
  const a = client.equipment_code?.trim();
  const b = client.consecutive?.trim();
  if (a && b) return `${a}/${b}`;
  return a || b || "";
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/* ---------------- Búsqueda ---------------- */

/** Valor seguro para un filtro de PostgREST (entre comillas). */
function pgValue(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Filtro de búsqueda por número (A/B), nombre o teléfono.
 * El número se acepta como "1/800", "1-800" o "1 800"; como la columna A
 * puede traer "/" (ej. "9/110"), se separa por el último separador.
 */
function searchFilter(raw: string): string {
  const q = raw.trim().replace(/\s+/g, " ");
  const like = `%${q.replace(/ /g, "%")}%`;
  const parts = [
    `name.ilike.${pgValue(like)}`,
    `phone.ilike.${pgValue(like)}`,
    `equipment_code.ilike.${pgValue(q)}`,
    `consecutive.ilike.${pgValue(q)}`,
  ];
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 4 && digits !== q) {
    // Teléfono escrito con espacios o guiones: "55 1802 8458"
    parts.push(`phone.ilike.${pgValue(`%${digits}%`)}`);
  }
  const m = q.match(/^(.+)[/\- ]([^/\- ]+)$/);
  if (m) {
    parts.push(
      `and(equipment_code.ilike.${pgValue(m[1]!.trim())},consecutive.ilike.${pgValue(m[2]!)})`,
    );
  }
  return parts.join(",");
}

export async function searchClients(query: string, limit = 20): Promise<Client[]> {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .or(searchFilter(query))
    .order("name", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Página de clientes para la pestaña "Todos los clientes" (con buscador opcional). */
export async function fetchClientsPage(
  query: string,
  page: number,
  pageSize = 50,
): Promise<{ rows: Client[]; total: number }> {
  let req = supabase.from("clients").select("*", { count: "exact" });
  if (query.trim()) req = req.or(searchFilter(query));
  const { data, error, count } = await req
    .order("name", { ascending: true })
    .range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) throw new Error(error.message);
  return { rows: data ?? [], total: count ?? 0 };
}

export async function countClients(): Promise<number> {
  const { count, error } = await supabase
    .from("clients")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Clientes con último servicio capturado (los que generan avisos y calendario). */
export async function fetchScheduledClients(): Promise<Client[]> {
  const all: Client[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .not("last_service_date", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return all.sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/* ---------------- Altas, cambios y bajas ---------------- */

export async function createClient(input: NewClient): Promise<Client> {
  const { data, error } = await supabase.from("clients").insert(input).select().single();
  if (error) throw new Error(error.message);
  return data;
}

/** Captura/edición del último servicio y su frecuencia (no crea historial). */
export async function setSchedule(
  id: string,
  input: {
    last_service_date: string | null;
    interval_value: number;
    interval_unit: IntervalUnit;
    service_type: string | null;
    notes: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from("clients").update(input).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Registra que el cliente fue atendido:
 * 1. Guarda la visita en el historial.
 * 2. Pone "Último servicio" = fecha de atención.
 * Con eso la siguiente fecha objetivo se recalcula sola (último + intervalo)
 * y el cliente vuelve a "pendiente"; el ciclo se repite indefinidamente.
 */
export async function markAttended(
  client: Client,
  date: string = toLocalISO(new Date()),
): Promise<void> {
  const { error: histError } = await supabase.from("service_history").insert({
    client_id: client.id,
    client_name: client.name,
    client_number: clientNumber(client) || null,
    service_date: date,
  });
  if (histError) throw new Error(histError.message);

  const { error } = await supabase
    .from("clients")
    .update({ last_service_date: date })
    .eq("id", client.id);
  if (error) throw new Error(error.message);
}

export async function deleteClient(id: string): Promise<void> {
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/* ---------------- Historial ---------------- */

export async function fetchHistory(limit = 500): Promise<HistoryEntry[]> {
  const { data, error } = await supabase
    .from("service_history")
    .select("*")
    .order("service_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchAllHistory(): Promise<HistoryEntry[]> {
  const all: HistoryEntry[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("service_history")
      .select("*")
      .order("service_date", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

/* ---------------- Importación desde Excel ---------------- */

export type ImportRow = {
  equipment_code: string | null;
  consecutive: string | null;
  name: string;
  phone: string | null;
  address: string | null;
};

export function importKey(r: Pick<ImportRow, "equipment_code" | "consecutive" | "name">): string {
  return `${r.equipment_code ?? ""}\u0000${r.consecutive ?? ""}\u0000${r.name}`;
}

/** Claves (A, B, nombre) de los clientes que ya existen, para la vista previa. */
export async function fetchExistingKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("clients")
      .select("equipment_code, consecutive, name")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) keys.add(importKey(r));
    if (!data || data.length < PAGE) break;
  }
  return keys;
}

/**
 * Alta/actualización masiva. Solo envía número, nombre, teléfono y dirección:
 * las fechas de servicio y frecuencias ya capturadas nunca se tocan.
 */
export async function importClients(
  rows: ImportRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from("clients")
      .upsert(batch, { onConflict: "equipment_code,consecutive,name" });
    if (error) throw new Error(error.message);
    onProgress?.(Math.min(i + BATCH, rows.length), rows.length);
  }
}

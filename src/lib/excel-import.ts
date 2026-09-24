import type { WorkBook } from "xlsx";
import { importKey, toLocalISO, type HistoryEntry, type ImportRow } from "@/lib/clients";

// SheetJS se carga solo cuando se usa (no pesa en la carga inicial de la página)
const loadXlsx = () => import("xlsx");

export async function readWorkbook(file: File): Promise<WorkBook> {
  const XLSX = await loadXlsx();
  return XLSX.read(await file.arrayBuffer(), { type: "array" });
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\s+/g, " ").trim();
}

/**
 * Lee una hoja del catálogo por posición de columna (no tiene fila de títulos):
 * A = tipo de equipo/instalación, B = consecutivo, C = nombre,
 * D–F = calle, colonia, municipio, H = teléfono.
 * Se descartan filas sin nombre y filas repetidas (mismo A, B y nombre).
 */
export async function parseCatalogSheet(wb: WorkBook, sheetName: string): Promise<ImportRow[]> {
  const XLSX = await loadXlsx();
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const raw = XLSX.utils.sheet_to_json<
    Partial<Record<"A" | "B" | "C" | "D" | "E" | "F" | "H", unknown>>
  >(ws, {
    header: "A",
    raw: true,
    defval: "",
    blankrows: false,
  });

  const seen = new Set<string>();
  const rows: ImportRow[] = [];
  for (const r of raw) {
    const name = cell(r.C).slice(0, 100);
    if (!name) continue;
    const row: ImportRow = {
      equipment_code: cell(r.A) || null,
      consecutive: cell(r.B) || null,
      name,
      phone: cell(r.H).slice(0, 60) || null,
      address: [cell(r.D), cell(r.E), cell(r.F)].filter(Boolean).join(", ").slice(0, 200) || null,
    };
    const key = importKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows;
}

/** Descarga el historial como .xlsx con una hoja "Historial". */
export async function exportHistoryXlsx(entries: HistoryEntry[]): Promise<void> {
  const XLSX = await loadXlsx();
  const data = entries.map((h) => ({
    Número: h.client_number ?? "",
    Cliente: h.client_name,
    "Fecha de atención": new Date(`${h.service_date}T00:00:00`),
  }));
  const ws = XLSX.utils.json_to_sheet(data, { cellDates: true, dateNF: "dd/mm/yyyy" });
  ws["!cols"] = [{ wch: 12 }, { wch: 40 }, { wch: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Historial");
  XLSX.writeFile(wb, `historial-servicios-${toLocalISO(new Date())}.xlsx`);
}

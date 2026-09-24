import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkBook } from "xlsx";
import { z } from "zod";
import {
  UNIT_LABEL,
  clientNumber,
  countClients,
  createClient,
  daysOverdue,
  deleteClient,
  fetchAllHistory,
  fetchClientsPage,
  fetchExistingKeys,
  fetchHistory,
  fetchScheduledClients,
  formatDate,
  getStatus,
  importClients,
  importKey,
  initials,
  intervalLabel,
  markAttended,
  nextDueDate,
  parseISODate,
  projectedDates,
  searchClients,
  setSchedule,
  startOfToday,
  toLocalISO,
  type Client,
  type HistoryEntry,
  type ImportRow,
  type IntervalUnit,
  type ServiceStatus,
} from "@/lib/clients";
import { exportHistoryXlsx, parseCatalogSheet, readWorkbook } from "@/lib/excel-import";

type Tab = "diario" | "todos" | "historial";

const STATUS_META: Record<ServiceStatus, { label: string; badge: string; chip: string }> = {
  atrasado: {
    label: "Atrasado",
    badge: "bg-destructive/10 text-destructive border-destructive/20",
    chip: "bg-destructive/10 text-destructive border-destructive/20",
  },
  hoy: {
    label: "Hoy",
    badge: "bg-warning/15 text-warning-foreground border-warning/30",
    chip: "bg-warning/20 text-warning-foreground border-warning/40",
  },
  manana: {
    label: "Mañana",
    badge: "bg-warning/10 text-warning-foreground border-warning/30",
    chip: "bg-warning/15 text-warning-foreground border-warning/30",
  },
  pendiente: {
    label: "Pendiente",
    badge: "bg-primary/10 text-primary border-primary/20",
    chip: "bg-primary/10 text-primary border-primary/20",
  },
  sinprogramar: {
    label: "Sin programar",
    badge: "bg-muted text-muted-foreground border-border",
    chip: "bg-muted text-muted-foreground border-border",
  },
};

/** Servicios futuros proyectados (2º, 3º… a partir del último servicio). */
const PROJECTED_CHIP = "border-dashed bg-card text-muted-foreground border-border";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 16 }, (_, i) => CURRENT_YEAR - 5 + i);

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

const inputCls =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20";
const labelCls = "mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground";

export function ServiceDashboard() {
  const [scheduled, setScheduled] = useState<Client[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [totalClients, setTotalClients] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("diario");
  const [viewYear, setViewYear] = useState(() => startOfToday().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => startOfToday().getMonth());
  // Se incrementa cada vez que cambian los datos, para refrescar búsquedas abiertas
  const [version, setVersion] = useState(0);

  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query);
  const [suggestions, setSuggestions] = useState<Client[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const [openClient, setOpenClient] = useState<Client | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cs, hs, total] = await Promise.all([
        fetchScheduledClients(),
        fetchHistory(),
        countClients(),
      ]);
      setScheduled(cs);
      setHistory(hs);
      setTotalClients(total);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la información");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const q = debouncedQuery.trim();
    if (!q) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    searchClients(q, 12)
      .then((rows) => !cancelled && setSuggestions(rows))
      .catch(() => !cancelled && setSuggestions([]));
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, version]);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3500);
  };

  const goToMonth = (y: number, m: number) => {
    const d = new Date(y, m, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const attend = async (client: Client, date?: string) => {
    try {
      await markAttended(client, date);
      flash(`Atención registrada para ${client.name}`);
      await reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Error al registrar");
    }
  };

  const removeClient = async (client: Client) => {
    if (!window.confirm(`¿Eliminar a ${client.name}? También se borrará su historial.`)) return;
    try {
      await deleteClient(client.id);
      flash(`${client.name} eliminado`);
      await reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Error al eliminar");
    }
  };

  const notices = useMemo(() => {
    const byDue = (a: Client, b: Client) =>
      (nextDueDate(a)?.getTime() ?? 0) - (nextDueDate(b)?.getTime() ?? 0);
    const group = (s: ServiceStatus) => scheduled.filter((c) => getStatus(c) === s).sort(byDue);
    return { atrasado: group("atrasado"), hoy: group("hoy"), manana: group("manana") };
  }, [scheduled]);
  const pendingCount = notices.atrasado.length + notices.hoy.length + notices.manana.length;

  const stats = useMemo(() => {
    const today = startOfToday();
    const thisMonth = history.filter((h) => {
      const d = parseISODate(h.service_date);
      return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    }).length;
    return { total: totalClients, programados: scheduled.length, thisMonth };
  }, [history, scheduled, totalClients]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header
        onAdd={() => setShowNew(true)}
        onImport={() => setShowImport(true)}
        pending={pendingCount}
        tab={tab}
        onTab={setTab}
      />

      <main className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
        {notice && (
          <div className="mb-6 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm font-medium text-primary">
            {notice}
          </div>
        )}
        {error && (
          <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">
            {error}
          </div>
        )}

        {/* Buscador de la base de datos */}
        <section className="mb-8">
          <div className="relative">
            <div className="rounded-xl border border-border/60 bg-card p-1 shadow-sm ring-1 ring-black/5">
              <div className="relative">
                <svg
                  className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-primary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSuggestOpen(true);
                  }}
                  onFocus={() => setSuggestOpen(true)}
                  onBlur={() => window.setTimeout(() => setSuggestOpen(false), 150)}
                  onKeyDown={(e) => e.key === "Escape" && setSuggestOpen(false)}
                  placeholder="Buscar cliente por número (ej. 1/800), nombre o teléfono…"
                  aria-label="Buscar cliente"
                  autoComplete="off"
                  role="combobox"
                  aria-expanded={suggestOpen}
                  className="h-14 w-full rounded-lg bg-transparent pl-12 pr-4 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            {suggestOpen && query.trim() !== "" && (
              <ul className="absolute left-0 right-0 top-full z-40 mt-1 max-h-[26rem] overflow-auto rounded-xl border border-border bg-card py-1 shadow-xl ring-1 ring-black/5">
                {suggestions.length === 0 ? (
                  <li className="px-4 py-3 text-sm text-muted-foreground">
                    Sin coincidencias para «{query}»
                  </li>
                ) : (
                  suggestions.map((c) => {
                    const status = getStatus(c);
                    return (
                      <li
                        key={c.id}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted"
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        <NumberBadge client={c} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{c.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {c.phone || "Sin teléfono"}
                            {c.last_service_date &&
                              ` · Último: ${formatDate(c.last_service_date)} · ${intervalLabel(c)}`}
                          </span>
                        </span>
                        <StatusBadge status={status} />
                        {status !== "sinprogramar" && (
                          <button
                            type="button"
                            onClick={() => {
                              setSuggestOpen(false);
                              void attend(c);
                            }}
                            className="hidden shrink-0 cursor-pointer rounded-md border border-border px-2 py-1 text-[10px] font-semibold transition-colors hover:bg-success hover:text-success-foreground sm:block"
                            title="Registrar atención con fecha de hoy"
                          >
                            Atendido ✓
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setSuggestOpen(false);
                            setOpenClient(c);
                          }}
                          className="shrink-0 cursor-pointer rounded-md bg-foreground px-2.5 py-1 text-[10px] font-semibold text-background transition-colors hover:bg-primary"
                        >
                          {status === "sinprogramar" ? "Último servicio" : "Ficha"}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 px-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Base de datos
            </span>
            <span className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-[10px] text-foreground">
              {stats.total} clientes · {stats.programados} programados
            </span>
            {query && (
              <button
                onClick={() => setQuery("")}
                className="text-[10px] font-bold uppercase tracking-widest text-primary hover:underline"
              >
                Limpiar
              </button>
            )}
          </div>
        </section>

        {tab === "todos" && (
          <AllClientsView
            query={debouncedQuery}
            version={version}
            onOpen={setOpenClient}
            onDelete={(c) => void removeClient(c)}
          />
        )}

        {tab === "historial" && <HistoryView history={history} loading={loading} />}

        {tab === "diario" && (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            {/* Calendario */}
            <div className="space-y-6 lg:col-span-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-semibold tracking-tight">Calendario de servicios</h2>
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Mes"
                    value={viewMonth}
                    onChange={(e) => setViewMonth(Number(e.target.value))}
                    className="h-8 cursor-pointer rounded-md border border-border bg-card px-2 text-xs font-medium shadow-sm outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    {MONTHS.map((m, i) => (
                      <option key={m} value={i}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Año"
                    value={viewYear}
                    onChange={(e) => setViewYear(Number(e.target.value))}
                    className="h-8 cursor-pointer rounded-md border border-border bg-card px-2 font-mono text-xs font-medium shadow-sm outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    {YEARS.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1 rounded-lg border border-border bg-muted p-0.5">
                    <button
                      onClick={() => goToMonth(viewYear, viewMonth - 1)}
                      aria-label="Mes anterior"
                      className="cursor-pointer rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      ‹
                    </button>
                    <button
                      onClick={() =>
                        goToMonth(startOfToday().getFullYear(), startOfToday().getMonth())
                      }
                      className="cursor-pointer rounded-md bg-card px-3 py-1 text-xs font-medium shadow-sm ring-1 ring-black/5"
                    >
                      Hoy
                    </button>
                    <button
                      onClick={() => goToMonth(viewYear, viewMonth + 1)}
                      aria-label="Mes siguiente"
                      className="cursor-pointer rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      ›
                    </button>
                  </div>
                </div>
              </div>

              <CalendarMonth
                clients={scheduled}
                year={viewYear}
                month={viewMonth}
                onOpen={setOpenClient}
              />
            </div>

            {/* Avisos */}
            <aside className="space-y-6 lg:col-span-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold tracking-tight">Avisos de servicio</h2>
                <span className="font-mono text-[11px] font-bold text-primary">
                  {pendingCount} pendientes
                </span>
              </div>

              {loading ? (
                <p className="text-sm text-muted-foreground">Cargando…</p>
              ) : pendingCount === 0 ? (
                <div className="rounded-xl bg-card p-5 text-sm text-muted-foreground shadow-sm ring-1 ring-black/5">
                  No hay servicios atrasados, ni para hoy ni para mañana.
                </div>
              ) : (
                <div className="space-y-6">
                  <NoticeGroup
                    title="Mañana les toca"
                    hint="Aviso con 1 día de anticipación"
                    clients={notices.manana}
                    onAttend={(c) => void attend(c)}
                    onOpen={setOpenClient}
                  />
                  <NoticeGroup
                    title="Les toca hoy"
                    clients={notices.hoy}
                    onAttend={(c) => void attend(c)}
                    onOpen={setOpenClient}
                  />
                  <NoticeGroup
                    title="Atrasados"
                    clients={notices.atrasado}
                    onAttend={(c) => void attend(c)}
                    onOpen={setOpenClient}
                  />
                </div>
              )}

              {/* Estado de la base de datos */}
              <div className="relative overflow-hidden rounded-xl bg-foreground p-6 text-background">
                <div className="absolute -mr-16 -mt-16 right-0 top-0 size-32 rounded-full border border-primary/30 bg-primary/10" />
                <h4 className="mb-6 text-[10px] font-bold uppercase tracking-[0.2em] text-background/60">
                  Base de datos
                </h4>
                <div className="relative z-10 grid grid-cols-3 gap-2">
                  <Stat value={stats.total} label="Clientes" />
                  <Stat value={stats.programados} label="Programados" />
                  <Stat value={stats.thisMonth} label="Atendidos este mes" accent />
                </div>
              </div>
            </aside>
          </div>
        )}

        <footer className="mt-16 flex items-start justify-between gap-6 border-t border-border pt-8">
          <p className="max-w-[64ch] text-pretty text-[11px] text-muted-foreground">
            Cada cliente programado tiene un último servicio y una frecuencia. Su siguiente servicio
            es «último servicio + frecuencia»: se avisa un día antes, y si la fecha pasa sin
            registrar la atención aparece como «atrasado». Al marcarlo como atendido se guarda en el
            historial, el último servicio pasa a ser esa fecha y el ciclo vuelve a empezar.
          </p>
          <span className="font-mono text-[10px] text-muted-foreground">V2.0</span>
        </footer>
      </main>

      {openClient && (
        <ClientDialog
          client={openClient}
          onClose={() => setOpenClient(null)}
          onSaved={async (msg) => {
            setOpenClient(null);
            flash(msg);
            await reload();
          }}
        />
      )}

      {showNew && (
        <NewClientDialog
          onClose={() => setShowNew(false)}
          onSaved={async (client) => {
            setShowNew(false);
            flash(`Cliente ${client.name} agregado`);
            await reload();
            setOpenClient(client);
          }}
        />
      )}

      {showImport && (
        <ImportDialog
          onClose={() => setShowImport(false)}
          onDone={async (n) => {
            flash(`${n} clientes importados desde Excel`);
            await reload();
          }}
        />
      )}
    </div>
  );
}

/* ---------------- Piezas pequeñas ---------------- */

function StatusBadge({ status }: { status: ServiceStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${meta.badge}`}
    >
      {meta.label}
    </span>
  );
}

function NumberBadge({ client }: { client: Client }) {
  const num = clientNumber(client);
  return (
    <span
      className="grid h-7 min-w-12 shrink-0 place-items-center rounded-md bg-muted px-1.5 font-mono text-[10px] font-bold"
      title="Número de cliente (tipo de equipo / consecutivo)"
    >
      {num || initials(client.name)}
    </span>
  );
}

function Stat({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <div>
      <div className={`text-2xl font-semibold tracking-tighter ${accent ? "text-success" : ""}`}>
        {value}
      </div>
      <div className="text-[9px] font-bold uppercase tracking-wider text-background/50">
        {label}
      </div>
    </div>
  );
}

function Dialog({
  label,
  onClose,
  children,
  wide,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-foreground/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`my-auto w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-xl bg-card p-6 shadow-xl ring-1 ring-black/10`}
      >
        {children}
      </div>
    </div>
  );
}

/* ---------------- Header ---------------- */

function Header({
  onAdd,
  onImport,
  pending,
  tab,
  onTab,
}: {
  onAdd: () => void;
  onImport: () => void;
  pending: number;
  tab: Tab;
  onTab: (t: Tab) => void;
}) {
  const tabCls = (active: boolean) =>
    `cursor-pointer whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
      active
        ? "bg-card text-foreground shadow-sm ring-1 ring-black/5"
        : "text-muted-foreground hover:text-foreground"
    }`;
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="grid size-8 place-items-center rounded-md bg-foreground text-background">
              <span className="font-mono text-sm font-medium">SD</span>
            </div>
            <span className="text-sm font-semibold uppercase tracking-tight">Servicio Diario</span>
          </div>
          <nav className="flex items-center gap-1 overflow-x-auto rounded-lg border border-border bg-muted p-0.5">
            <button className={tabCls(tab === "diario")} onClick={() => onTab("diario")}>
              Servicio diario
            </button>
            <button className={tabCls(tab === "todos")} onClick={() => onTab("todos")}>
              Todos los clientes
            </button>
            <button className={tabCls(tab === "historial")} onClick={() => onTab("historial")}>
              Historial
            </button>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 rounded-full bg-muted px-3 py-1 ring-1 ring-black/5 lg:flex">
            <span
              className={`size-1.5 rounded-full ${pending > 0 ? "bg-warning" : "bg-success"}`}
            />
            <span className="font-mono text-[10px] font-medium uppercase text-muted-foreground">
              {pending > 0 ? `${pending} avisos pendientes` : "Todo al día"}
            </span>
          </div>
          <button
            onClick={onImport}
            className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-3 text-xs font-medium shadow-sm transition-colors hover:bg-muted"
          >
            Importar Excel
          </button>
          <button
            onClick={onAdd}
            className="flex h-9 cursor-pointer items-center gap-2 rounded-md bg-primary py-2 pl-2 pr-3 text-xs font-medium text-primary-foreground shadow-sm ring-1 ring-primary transition-all hover:brightness-110"
          >
            <svg
              className="size-4 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span>Nuevo cliente</span>
          </button>
        </div>
      </div>
    </header>
  );
}

/* ---------------- Calendario mensual ---------------- */

function CalendarMonth({
  clients,
  year: viewYear,
  month: viewMonth,
  onOpen,
}: {
  clients: Client[];
  year: number;
  month: number;
  onOpen: (c: Client) => void;
}) {
  const today = startOfToday();
  const view = new Date(viewYear, viewMonth, 1);
  const year = view.getFullYear();
  const month = view.getMonth();

  // Semanas completas empezando en lunes
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  // Todas las fechas de servicio de cada cliente que caen en este mes
  const byDay = useMemo(() => {
    const from = new Date(year, month, 1);
    const to = new Date(year, month, daysInMonth);
    const map = new Map<string, { client: Client; k: number }[]>();
    for (const c of clients) {
      for (const { date, k } of projectedDates(c, from, to)) {
        const key = dateKey(date);
        map.set(key, [...(map.get(key) ?? []), { client: c, k }]);
      }
    }
    return map;
  }, [clients, year, month, daysInMonth]);

  return (
    <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-black/5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/50 px-4 py-3">
        <h3 className="text-sm font-semibold">
          {MONTHS[month]} {year}
        </h3>
        <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-destructive" /> Atrasado
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-warning" /> Hoy / mañana
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-primary" /> Siguiente
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full border border-dashed border-muted-foreground" />{" "}
            Futuro
          </span>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-border bg-muted/50">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="py-2.5 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 divide-x divide-y divide-border">
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} className="min-h-[96px] bg-muted/30" />;
          const items = byDay.get(dateKey(day)) ?? [];
          const isToday = dateKey(day) === dateKey(today);
          return (
            <div
              key={day.toISOString()}
              className={
                isToday
                  ? "min-h-[96px] min-w-0 bg-primary/5 p-1.5 ring-1 ring-inset ring-primary/20"
                  : "min-h-[96px] min-w-0 p-1.5"
              }
            >
              <div
                className={
                  isToday
                    ? "mb-1 font-mono text-[11px] font-bold text-primary"
                    : "mb-1 font-mono text-[11px] text-muted-foreground"
                }
              >
                {String(day.getDate()).padStart(2, "0")}
                {isToday && <span className="ml-1 text-[9px] uppercase">hoy</span>}
              </div>
              <div className="space-y-1">
                {items.slice(0, 3).map(({ client: c, k }) => {
                  const cls = k === 1 ? STATUS_META[getStatus(c)].chip : PROJECTED_CHIP;
                  const num = clientNumber(c);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onOpen(c)}
                      title={`${num ? `${num} · ` : ""}${c.name} — ${c.service_type || "Servicio"}${c.phone ? ` · ${c.phone}` : ""}`}
                      className={`block w-full cursor-pointer truncate rounded border px-1.5 py-0.5 text-left text-[10px] font-semibold ${cls}`}
                    >
                      {c.name}
                    </button>
                  );
                })}
                {items.length > 3 && (
                  <details className="font-mono text-[9px] text-muted-foreground">
                    <summary className="cursor-pointer px-1">+{items.length - 3} más</summary>
                    <div className="mt-1 space-y-1">
                      {items.slice(3).map(({ client: c }) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => onOpen(c)}
                          className="block w-full cursor-pointer truncate rounded border border-border px-1.5 py-0.5 text-left text-[10px] font-semibold text-foreground"
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Avisos ---------------- */

function NoticeGroup({
  title,
  hint,
  clients,
  onAttend,
  onOpen,
}: {
  title: string;
  hint?: string;
  clients: Client[];
  onAttend: (c: Client) => void;
  onOpen: (c: Client) => void;
}) {
  if (clients.length === 0) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider">{title}</h3>
        <span className="font-mono text-[10px] text-muted-foreground">
          {hint ? `${hint} · ` : ""}
          {clients.length}
        </span>
      </div>
      {clients.map((c) => (
        <NoticeCard key={c.id} client={c} onAttend={() => onAttend(c)} onOpen={() => onOpen(c)} />
      ))}
    </div>
  );
}

function NoticeCard({
  client,
  onAttend,
  onOpen,
}: {
  client: Client;
  onAttend: () => void;
  onOpen: () => void;
}) {
  const status = getStatus(client);
  const overdue = daysOverdue(client);
  const due = nextDueDate(client);
  const num = clientNumber(client);

  return (
    <div
      className={`rounded-lg bg-card p-4 shadow-sm ring-1 ring-black/5 ${
        status === "atrasado" ? "border-l-4 border-l-destructive" : "border-l-4 border-l-warning"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onOpen} className="min-w-0 cursor-pointer text-left">
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_META[status].badge}`}
          >
            {status === "atrasado"
              ? `Atrasado · ${overdue} ${overdue === 1 ? "día" : "días"}`
              : STATUS_META[status].label}
          </span>
          <h4 className="mt-2 text-sm font-semibold leading-tight hover:underline">
            {client.name}
          </h4>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {[client.service_type, client.address].filter(Boolean).join(" · ") ||
              intervalLabel(client)}
          </p>
        </button>
        {num && <span className="shrink-0 font-mono text-[11px] font-bold">{num}</span>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4 border-t border-dashed border-border pt-3">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            Teléfono
          </p>
          <p className="font-mono text-xs">{client.phone || "—"}</p>
        </div>
        <div>
          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            Último servicio
          </p>
          <p className="font-mono text-xs">{formatDate(client.last_service_date)}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-muted-foreground">
          Le toca: {formatDate(due)}
        </span>
        <button
          onClick={onAttend}
          className="cursor-pointer rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-background transition-colors hover:bg-primary"
          title="Registrar atención con fecha de hoy"
        >
          Atendido hoy
        </button>
      </div>
    </div>
  );
}

/* ---------------- Ficha del cliente: último servicio, frecuencia y atención ---------------- */

const scheduleSchema = z.object({
  last_service_date: z.string().min(1, "Indica la fecha del último servicio"),
  interval_value: z.coerce.number().int().min(1, "La frecuencia mínima es 1").max(3650),
  interval_unit: z.enum(["dias", "meses", "anios"]),
  service_type: z.string().trim().max(80),
  notes: z.string().trim().max(500),
});

function ClientDialog({
  client,
  onClose,
  onSaved,
}: {
  client: Client;
  onClose: () => void;
  onSaved: (msg: string) => Promise<void>;
}) {
  const [form, setForm] = useState({
    last_service_date: client.last_service_date ?? "",
    interval_value: String(client.interval_value || 12),
    interval_unit: (client.interval_unit in UNIT_LABEL
      ? client.interval_unit
      : "meses") as IntervalUnit,
    service_type: client.service_type ?? "",
    notes: client.notes ?? "",
  });
  const [attendDate, setAttendDate] = useState(() => toLocalISO(new Date()));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const status = getStatus(client);
  const num = clientNumber(client);

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  // Vista previa de los próximos servicios con lo que está en el formulario
  const preview = useMemo(() => {
    const value = Number(form.interval_value);
    if (!form.last_service_date || !Number.isInteger(value) || value < 1) return [];
    const draft = {
      ...client,
      last_service_date: form.last_service_date,
      interval_value: value,
      interval_unit: form.interval_unit,
    };
    const from = parseISODate(form.last_service_date);
    const to = new Date(from.getFullYear() + 20, 0, 1);
    return projectedDates(draft, from, to)
      .slice(0, 4)
      .map((o) => o.date);
  }, [client, form.last_service_date, form.interval_value, form.interval_unit]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = scheduleSchema.safeParse(form);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Revisa los datos");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await setSchedule(client.id, {
        last_service_date: parsed.data.last_service_date,
        interval_value: parsed.data.interval_value,
        interval_unit: parsed.data.interval_unit,
        service_type: parsed.data.service_type || null,
        notes: parsed.data.notes || null,
      });
      await onSaved(`Servicio programado para ${client.name}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "No se pudo guardar");
      setSaving(false);
    }
  };

  const attend = async () => {
    if (!attendDate) return;
    setSaving(true);
    setFormError(null);
    try {
      // Si cambió la frecuencia en el formulario, se guarda junto con la atención
      const parsed = scheduleSchema.safeParse({ ...form, last_service_date: attendDate });
      if (parsed.success) {
        await setSchedule(client.id, {
          last_service_date: client.last_service_date,
          interval_value: parsed.data.interval_value,
          interval_unit: parsed.data.interval_unit,
          service_type: parsed.data.service_type || null,
          notes: parsed.data.notes || null,
        });
      }
      await markAttended(client, attendDate);
      await onSaved(`Atención registrada para ${client.name} (${formatDate(attendDate)})`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "No se pudo registrar");
      setSaving(false);
    }
  };

  return (
    <Dialog label={`Ficha de ${client.name}`} onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {num && <p className="font-mono text-xs font-bold text-primary">{num}</p>}
          <h2 className="text-lg font-semibold leading-tight tracking-tight">{client.name}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {[client.phone || "Sin teléfono", client.address].filter(Boolean).join(" · ")}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Registrar atención */}
      <div className="mt-5 rounded-lg border border-border bg-muted/40 p-4">
        <p className="text-xs font-semibold">Registrar atención</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Se guarda en el historial y esta fecha pasa a ser el último servicio.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            type="date"
            aria-label="Fecha de atención"
            className={inputCls}
            value={attendDate}
            onChange={(e) => setAttendDate(e.target.value)}
          />
          <button
            type="button"
            onClick={() => void attend()}
            disabled={saving || !attendDate}
            className="shrink-0 cursor-pointer rounded-md bg-success px-4 text-xs font-semibold text-success-foreground transition-all hover:brightness-110 disabled:opacity-50"
          >
            Atendido ✓
          </button>
        </div>
      </div>

      {/* Programación */}
      <form onSubmit={save} className="mt-5 space-y-4">
        <p className="text-xs font-semibold">
          Programación{" "}
          <span className="font-normal text-muted-foreground">
            (corrige la fecha a mano si hace falta)
          </span>
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor="c-last">
              Último servicio *
            </label>
            <input
              id="c-last"
              type="date"
              className={inputCls}
              value={form.last_service_date}
              onChange={set("last_service_date")}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="c-interval">
              Se repite cada *
            </label>
            <div className="flex gap-1.5">
              <input
                id="c-interval"
                type="number"
                min={1}
                max={3650}
                className={`${inputCls} w-20`}
                value={form.interval_value}
                onChange={set("interval_value")}
              />
              <select
                aria-label="Unidad"
                className={`${inputCls} cursor-pointer px-2`}
                value={form.interval_unit}
                onChange={set("interval_unit")}
              >
                <option value="dias">días</option>
                <option value="meses">meses</option>
                <option value="anios">años</option>
              </select>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            [3, "meses", "3 meses"],
            [6, "meses", "6 meses"],
            [1, "anios", "1 año"],
            [2, "anios", "2 años"],
          ].map(([v, u, label]) => (
            <button
              key={label}
              type="button"
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  interval_value: String(v),
                  interval_unit: u as IntervalUnit,
                }))
              }
              className="cursor-pointer rounded-full border border-border px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              {label}
            </button>
          ))}
        </div>
        <div>
          <label className={labelCls} htmlFor="c-service">
            Tipo de servicio
          </label>
          <input
            id="c-service"
            className={inputCls}
            value={form.service_type}
            onChange={set("service_type")}
            maxLength={80}
            placeholder="Ej. Mantenimiento preventivo"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="c-notes">
            Notas
          </label>
          <textarea
            id="c-notes"
            className="min-h-[56px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            value={form.notes}
            onChange={set("notes")}
            maxLength={500}
          />
        </div>

        {preview.length > 0 && (
          <div className="rounded-md border border-dashed border-border px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Próximos servicios
            </p>
            <p className="mt-1 font-mono text-xs">
              {preview.map((d) => formatDate(d)).join(" · ")} …
            </p>
          </div>
        )}

        {formError && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive">
            {formError}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md border border-border px-4 py-2 text-xs font-medium transition-colors hover:bg-muted"
          >
            Cerrar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="cursor-pointer rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-all hover:brightness-110 disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar programación"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/* ---------------- Nuevo cliente ---------------- */

const clientSchema = z.object({
  equipment_code: z.string().trim().max(20),
  consecutive: z.string().trim().max(20),
  name: z.string().trim().min(1, "El nombre es obligatorio").max(100),
  phone: z.string().trim().max(60),
  address: z.string().trim().max(200),
});

function NewClientDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (client: Client) => Promise<void>;
}) {
  const [form, setForm] = useState({
    equipment_code: "",
    consecutive: "",
    name: "",
    phone: "",
    address: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = clientSchema.safeParse(form);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Revisa los datos");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const client = await createClient({
        equipment_code: parsed.data.equipment_code || null,
        consecutive: parsed.data.consecutive || null,
        name: parsed.data.name,
        phone: parsed.data.phone || null,
        address: parsed.data.address || null,
      });
      await onSaved(client);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo guardar";
      setFormError(
        msg.includes("clients_numero_nombre_key")
          ? "Ya existe un cliente con ese número y nombre"
          : msg,
      );
      setSaving(false);
    }
  };

  return (
    <Dialog label="Nuevo cliente" onClose={onClose}>
      <form onSubmit={submit}>
        <h2 className="text-lg font-semibold tracking-tight">Nuevo cliente</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Al guardarlo se abre su ficha para capturar el último servicio y la frecuencia.
        </p>
        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="f-a">
                Tipo de equipo (col. A)
              </label>
              <input
                id="f-a"
                className={inputCls}
                value={form.equipment_code}
                onChange={set("equipment_code")}
                maxLength={20}
                placeholder="Ej. 1"
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="f-b">
                Consecutivo (col. B)
              </label>
              <input
                id="f-b"
                className={inputCls}
                value={form.consecutive}
                onChange={set("consecutive")}
                maxLength={20}
                placeholder="Ej. 882"
              />
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="f-name">
              Nombre *
            </label>
            <input
              id="f-name"
              className={inputCls}
              value={form.name}
              onChange={set("name")}
              maxLength={100}
              required
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="f-phone">
              Teléfono
            </label>
            <input
              id="f-phone"
              className={inputCls}
              value={form.phone}
              onChange={set("phone")}
              maxLength={60}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="f-address">
              Dirección
            </label>
            <input
              id="f-address"
              className={inputCls}
              value={form.address}
              onChange={set("address")}
              maxLength={200}
            />
          </div>
        </div>

        {formError && (
          <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive">
            {formError}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md border border-border px-4 py-2 text-xs font-medium transition-colors hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="cursor-pointer rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-all hover:brightness-110 disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar cliente"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/* ---------------- Importar Excel ---------------- */

function ImportDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (imported: number) => Promise<void>;
}) {
  const [wb, setWb] = useState<WorkBook | null>(null);
  const [fileName, setFileName] = useState("");
  const [sheet, setSheet] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [newCount, setNewCount] = useState<number | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [finished, setFinished] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSheet = async (book: WorkBook, name: string) => {
    setSheet(name);
    setNewCount(null);
    const parsed = await parseCatalogSheet(book, name);
    setRows(parsed);
    try {
      const existing = await fetchExistingKeys();
      setNewCount(parsed.filter((r) => !existing.has(importKey(r))).length);
    } catch {
      setNewCount(null);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    setBusy(true);
    setFinished(false);
    setProgress(null);
    try {
      const book = await readWorkbook(file);
      setWb(book);
      setFileName(file.name);
      const def =
        book.SheetNames.find((n) => n.trim().toUpperCase() === "GENERAL") ??
        book.SheetNames[0] ??
        "";
      await loadSheet(book, def);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo leer el archivo");
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    setBusy(true);
    setErr(null);
    try {
      await importClients(rows, (done, total) => setProgress({ done, total }));
      setFinished(true);
      await onDone(rows.length);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al importar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog label="Importar clientes desde Excel" onClose={() => !busy && onClose()} wide>
      <h2 className="text-lg font-semibold tracking-tight">Importar clientes desde Excel</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Se leen las columnas <b>A</b> (tipo de equipo), <b>B</b> (consecutivo), <b>C</b> (nombre),{" "}
        <b>H</b> (teléfono) y <b>D–F</b> (dirección). Puedes volver a importar cuando actualices el
        Excel: se agregan los nuevos y se actualizan nombre, teléfono y dirección, sin tocar las
        fechas de servicio ya capturadas.
      </p>

      <div className="mt-5 flex flex-wrap items-end gap-3">
        <label className="flex-1">
          <span className={labelCls}>Archivo (.xlsx)</span>
          <input
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv"
            disabled={busy}
            onChange={(e) => void onFile(e.target.files?.[0])}
            className="block w-full text-xs file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-xs file:font-semibold"
          />
        </label>
        {wb && (
          <label>
            <span className={labelCls}>Hoja</span>
            <select
              className={`${inputCls} cursor-pointer`}
              value={sheet}
              disabled={busy}
              onChange={(e) => void loadSheet(wb, e.target.value)}
            >
              {wb.SheetNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {wb && (
        <div className="mt-5">
          <p className="text-xs">
            <b>{fileName}</b> · hoja <b>{sheet}</b>: {rows.length} clientes
            {newCount !== null && (
              <>
                {" "}
                ({newCount} nuevos, {rows.length - newCount} ya existen y se actualizarán)
              </>
            )}
          </p>
          <div className="mt-2 max-h-56 overflow-auto rounded-md border border-border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-muted text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5">Número</th>
                  <th className="px-2 py-1.5">Nombre</th>
                  <th className="px-2 py-1.5">Teléfono</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.slice(0, 8).map((r) => (
                  <tr key={importKey(r)}>
                    <td className="px-2 py-1 font-mono">{clientNumber(r)}</td>
                    <td className="px-2 py-1">{r.name}</td>
                    <td className="px-2 py-1 font-mono">{r.phone ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 8 && (
            <p className="mt-1 text-[10px] text-muted-foreground">… y {rows.length - 8} más</p>
          )}
        </div>
      )}

      {progress && (
        <div className="mt-4">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            {finished ? "Importación terminada: " : "Importando… "}
            {progress.done} de {progress.total}
          </p>
        </div>
      )}

      {err && (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive">
          {err}
        </p>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="cursor-pointer rounded-md border border-border px-4 py-2 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
        >
          {finished ? "Cerrar" : "Cancelar"}
        </button>
        {!finished && (
          <button
            type="button"
            onClick={() => void runImport()}
            disabled={busy || rows.length === 0}
            className="cursor-pointer rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-all hover:brightness-110 disabled:opacity-50"
          >
            {busy && progress ? "Importando…" : `Importar ${rows.length || ""} clientes`}
          </button>
        )}
      </div>
    </Dialog>
  );
}

/* ---------------- Pestaña: todos los clientes ---------------- */

function AllClientsView({
  query,
  version,
  onOpen,
  onDelete,
}: {
  query: string;
  version: number;
  onOpen: (c: Client) => void;
  onDelete: (c: Client) => void;
}) {
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => setPage(0), [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchClientsPage(query, page, PAGE_SIZE)
      .then((r) => {
        if (cancelled) return;
        setRows(r.rows);
        setTotal(r.total);
        setErr(null);
      })
      .catch((e) => !cancelled && setErr(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query, page, version]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Todos los clientes</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Usa el buscador de arriba para filtrar. Abre la ficha para capturar el último servicio.
          </p>
        </div>
        <Pager page={page} pages={pages} total={total} onPage={setPage} />
      </div>

      <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-black/5">
        {err ? (
          <p className="px-4 py-10 text-center text-sm text-destructive">{err}</p>
        ) : loading && rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">Cargando clientes…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {query
              ? "Ningún cliente coincide con la búsqueda."
              : "Aún no hay clientes. Usa «Importar Excel» o «Nuevo cliente»."}
          </p>
        ) : (
          <div className={`divide-y divide-border ${loading ? "opacity-60" : ""}`}>
            {rows.map((c) => {
              const due = nextDueDate(c);
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50"
                >
                  <NumberBadge client={c} />
                  <button
                    type="button"
                    onClick={() => onOpen(c)}
                    className="w-48 min-w-0 cursor-pointer truncate text-left text-sm font-medium hover:underline"
                  >
                    {c.name}
                  </button>
                  <div className="hidden w-40 truncate font-mono text-xs text-muted-foreground md:block">
                    {c.phone || "—"}
                  </div>
                  <div className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground lg:block">
                    {c.service_type || c.address || ""}
                  </div>
                  <div className="hidden text-right font-mono text-[11px] text-muted-foreground sm:block">
                    {c.last_service_date ? (
                      <>
                        <span className="block">Último: {formatDate(c.last_service_date)}</span>
                        <span className="block text-[9px] uppercase tracking-wider">
                          {intervalLabel(c)} · le toca {formatDate(due)}
                        </span>
                      </>
                    ) : (
                      <span>—</span>
                    )}
                  </div>
                  <span className="ml-auto" />
                  <StatusBadge status={getStatus(c)} />
                  <button
                    onClick={() => onOpen(c)}
                    className="shrink-0 cursor-pointer rounded-md border border-border px-2 py-1 text-[10px] font-semibold transition-colors hover:bg-primary hover:text-primary-foreground"
                  >
                    Ficha
                  </button>
                  <button
                    onClick={() => onDelete(c)}
                    aria-label={`Eliminar a ${c.name}`}
                    className="shrink-0 cursor-pointer rounded-md px-1.5 py-1 text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {pages > 1 && (
        <div className="flex justify-end">
          <Pager page={page} pages={pages} total={total} onPage={setPage} />
        </div>
      )}
    </div>
  );
}

function Pager({
  page,
  pages,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const btn =
    "cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-40";
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] text-muted-foreground">{total} clientes</span>
      <div className="flex items-center gap-1 rounded-lg border border-border bg-muted p-0.5">
        <button
          className={btn}
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
          aria-label="Página anterior"
        >
          ‹
        </button>
        <span className="px-1 font-mono text-[10px]">
          {page + 1} / {pages}
        </span>
        <button
          className={btn}
          disabled={page >= pages - 1}
          onClick={() => onPage(page + 1)}
          aria-label="Página siguiente"
        >
          ›
        </button>
      </div>
    </div>
  );
}

/* ---------------- Pestaña: historial ---------------- */

function HistoryView({ history, loading }: { history: HistoryEntry[]; loading: boolean }) {
  const [exporting, setExporting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const exportAll = async () => {
    setExporting(true);
    setErr(null);
    try {
      await exportHistoryXlsx(await fetchAllHistory());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo exportar");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Historial de atenciones</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Cada vez que marcas a un cliente como atendido se agrega aquí.
          </p>
        </div>
        <button
          onClick={() => void exportAll()}
          disabled={exporting}
          className="h-9 cursor-pointer rounded-md border border-border bg-card px-3 text-xs font-medium shadow-sm transition-colors hover:bg-muted disabled:opacity-50"
        >
          {exporting ? "Exportando…" : "Exportar a Excel"}
        </button>
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}

      <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-black/5">
        {loading && history.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">Cargando…</p>
        ) : history.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Todavía no hay atenciones registradas.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/50 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Número</th>
                <th className="px-4 py-2.5">Cliente</th>
                <th className="px-4 py-2.5 text-right">Fecha de atención</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="px-4 py-2 font-mono text-xs">{h.client_number || "—"}</td>
                  <td className="px-4 py-2">{h.client_name}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {formatDate(h.service_date)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {history.length >= 500 && (
        <p className="text-[10px] text-muted-foreground">
          Se muestran las 500 atenciones más recientes; «Exportar a Excel» incluye todas.
        </p>
      )}
    </div>
  );
}

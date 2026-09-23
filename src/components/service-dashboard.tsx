import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  daysOverdue,
  deleteClient,
  dueDate,
  fetchClients,
  fetchHistory,
  formatDate,
  getStatus,
  initials,
  registerServiceToday,
  startOfToday,
  createClient,
  type Client,
  type HistoryEntry,
  type ServiceStatus,
} from "@/lib/clients";

const STATUS_META: Record<
  ServiceStatus,
  { label: string; badge: string; chip: string; dot: string }
> = {
  vencido: {
    label: "Vencido",
    badge: "bg-destructive/10 text-destructive border-destructive/20",
    chip: "bg-destructive/10 text-destructive border-destructive/20",
    dot: "bg-destructive",
  },
  proximo: {
    label: "Próximo",
    badge: "bg-warning/10 text-warning-foreground border-warning/30",
    chip: "bg-warning/15 text-warning-foreground border-warning/30",
    dot: "bg-warning",
  },
  aldia: {
    label: "Al día",
    badge: "bg-success/10 text-success border-success/20",
    chip: "bg-success/10 text-success border-success/20",
    dot: "bg-success",
  },
};

const clientSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio").max(100),
  phone: z.string().trim().max(25).optional(),
  address: z.string().trim().max(150).optional(),
  service_type: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(500).optional(),
  interval_days: z.coerce.number().int().min(1, "Mínimo 1 día").max(3650),
  last_service_date: z.string().min(1, "Indica la fecha del último servicio"),
});

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function ServiceDashboard() {
  const [clients, setClients] = useState<Client[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"diario" | "todos">("diario");
  const [viewYear, setViewYear] = useState(() => startOfToday().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => startOfToday().getMonth());

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cs, hs] = await Promise.all([fetchClients(), fetchHistory()]);
      setClients(cs);
      setHistory(hs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la lista");
    } finally {
      setLoading(false);
    }
  }, []);

  const goToMonth = (y: number, m: number) => {
    const d = new Date(y, m, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  useEffect(() => {
    void reload();
  }, [reload]);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3500);
  };

  const markServiced = async (client: Client) => {
    try {
      await registerServiceToday({ id: client.id, name: client.name });
      flash(`Servicio registrado para ${client.name}`);
      await reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Error al registrar");
    }
  };

  const removeClient = async (client: Client) => {
    try {
      await deleteClient(client.id);
      flash(`${client.name} eliminado`);
      await reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Error al eliminar");
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) =>
      [c.name, c.phone, c.address, c.service_type, c.notes]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    );
  }, [clients, query]);

  const notices = useMemo(() => {
    return clients
      .filter((c) => getStatus(c) !== "aldia")
      .sort((a, b) => {
        const da = dueDate(a)?.getTime() ?? 0;
        const db = dueDate(b)?.getTime() ?? 0;
        return da - db;
      });
  }, [clients]);

  const stats = useMemo(() => {
    const today = startOfToday();
    const thisMonth = clients.filter((c) => {
      if (!c.last_service_date) return false;
      const d = new Date(`${c.last_service_date}T00:00:00`);
      return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    }).length;
    const overdue = clients.filter((c) => getStatus(c) === "vencido").length;
    return { total: clients.length, thisMonth, overdue };
  }, [clients]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header
        onAdd={() => setShowForm(true)}
        pending={notices.length}
      />

      <main className="mx-auto max-w-[1400px] px-6 py-8">
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
          <div className="rounded-xl border border-border/60 bg-card p-1 shadow-sm ring-1 ring-black/5">
            <div className="relative">
              <svg
                className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-primary"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar cliente por nombre, teléfono, dirección o tipo de servicio…"
                aria-label="Buscar cliente"
                className="h-14 w-full rounded-lg bg-transparent pl-12 pr-4 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3 px-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Base de datos
            </span>
            <span className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-[10px] text-foreground">
              {filtered.length} de {clients.length} clientes
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

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Calendario */}
          <div className="space-y-6 lg:col-span-8">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold tracking-tight">
                Calendario de servicios
              </h2>
              <div className="flex items-center gap-1 rounded-lg border border-border bg-muted p-0.5">
                <button
                  onClick={() => setMonthOffset((v) => v - 1)}
                  aria-label="Mes anterior"
                  className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  ‹
                </button>
                <button
                  onClick={() => setMonthOffset(0)}
                  className="rounded-md bg-card px-3 py-1 text-xs font-medium shadow-sm ring-1 ring-black/5"
                >
                  Hoy
                </button>
                <button
                  onClick={() => setMonthOffset((v) => v + 1)}
                  aria-label="Mes siguiente"
                  className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  ›
                </button>
              </div>
            </div>

            <CalendarMonth clients={clients} monthOffset={monthOffset} />

            {/* Lista de clientes */}
            <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-black/5">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold tracking-tight">Clientes</h3>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {filtered.length} resultados
                </span>
              </div>
              {loading ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Cargando clientes…
                </p>
              ) : filtered.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {query
                    ? "Ningún cliente coincide con la búsqueda."
                    : "Aún no hay clientes. Agrega el primero con el botón «Nuevo cliente»."}
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {filtered.map((c) => (
                    <ClientRow
                      key={c.id}
                      client={c}
                      onServiced={() => void markServiced(c)}
                      onDelete={() => void removeClient(c)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Avisos */}
          <aside className="space-y-6 lg:col-span-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">
                Avisos de servicio
              </h2>
              <span className="font-mono text-[11px] font-bold text-primary">
                {notices.length} pendientes
              </span>
            </div>

            <div className="space-y-4 pt-2">
              {loading ? (
                <p className="text-sm text-muted-foreground">Cargando…</p>
              ) : notices.length === 0 ? (
                <div className="rounded-xl bg-card p-5 text-sm text-muted-foreground shadow-sm ring-1 ring-black/5">
                  Todos los clientes están al día. No hay servicios pendientes.
                </div>
              ) : (
                notices.map((c, i) => (
                  <NoticeCard
                    key={c.id}
                    client={c}
                    highlight={i === 0}
                    onServiced={() => void markServiced(c)}
                  />
                ))
              )}

              {/* Estado de la base de datos */}
              <div className="relative overflow-hidden rounded-xl bg-foreground p-6 text-background">
                <div className="absolute -mr-16 -mt-16 right-0 top-0 size-32 rounded-full border border-primary/30 bg-primary/10" />
                <h4 className="mb-6 text-[10px] font-bold uppercase tracking-[0.2em] text-background/60">
                  Base de datos
                </h4>
                <div className="relative z-10 space-y-4">
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="text-2xl font-semibold tracking-tighter">
                        {stats.total}
                      </div>
                      <div className="text-[9px] font-bold uppercase tracking-wider text-background/50">
                        Clientes
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-semibold tracking-tighter text-success">
                        {stats.thisMonth}
                      </div>
                      <div className="text-[9px] font-bold uppercase tracking-wider text-background/50">
                        Servicios este mes
                      </div>
                    </div>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-background/20">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{
                        width: `${stats.total ? Math.min(100, (stats.thisMonth / stats.total) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>

        <footer className="mt-16 flex items-start justify-between border-t border-border pt-8">
          <p className="max-w-[56ch] text-pretty text-[11px] text-muted-foreground">
            Los avisos se calculan automáticamente: cada cliente aparece como
            «vencido» cuando ya pasó el intervalo desde su último servicio, y
            como «próximo» cuando faltan 7 días o menos. Registra cada servicio
            con un clic para reiniciar el conteo.
          </p>
          <span className="font-mono text-[10px] text-muted-foreground">
            V1.0
          </span>
        </footer>
      </main>

      {showForm && (
        <ClientFormDialog
          onClose={() => setShowForm(false)}
          onSaved={async (name) => {
            setShowForm(false);
            flash(`Cliente ${name} agregado`);
            await reload();
          }}
        />
      )}
    </div>
  );
}

/* ---------------- Header ---------------- */

function Header({ onAdd, pending }: { onAdd: () => void; pending: number }) {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-6">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="grid size-8 place-items-center rounded-md bg-foreground text-background">
              <span className="font-mono text-sm font-medium">SD</span>
            </div>
            <span className="text-sm font-semibold uppercase tracking-tight">
              Servicio Diario
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-2 rounded-full bg-muted px-3 py-1 ring-1 ring-black/5 lg:flex">
            <span className="size-1.5 rounded-full bg-success" />
            <span className="font-mono text-[10px] font-medium uppercase text-muted-foreground">
              {pending > 0 ? `${pending} avisos pendientes` : "Todo al día"}
            </span>
          </div>
          <button
            onClick={onAdd}
            className="flex h-9 cursor-pointer items-center gap-2 rounded-md bg-primary py-2 pl-2 pr-3 text-xs font-medium text-primary-foreground shadow-sm ring-1 ring-primary transition-all hover:brightness-110"
          >
            <svg className="size-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
  monthOffset,
}: {
  clients: Client[];
  monthOffset: number;
}) {
  const today = startOfToday();
  const view = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const year = view.getFullYear();
  const month = view.getMonth();

  // Días a mostrar: semanas completas empezando en lunes
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // 0 = lunes
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const byDay = new Map<string, Client[]>();
  for (const c of clients) {
    const due = dueDate(c);
    if (!due) continue;
    const key = dateKey(due);
    byDay.set(key, [...(byDay.get(key) ?? []), c]);
  }

  return (
    <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-black/5">
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-3">
        <h3 className="text-sm font-semibold">
          {MONTHS[month]} {year}
        </h3>
        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-destructive" /> Vencido
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-warning" /> Próximo
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-success" /> Al día
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
          if (!day) {
            return <div key={`e${i}`} className="min-h-[96px] bg-muted/30" />;
          }
          const items = byDay.get(dateKey(day)) ?? [];
          const isToday = dateKey(day) === dateKey(today);
          return (
            <div
              key={day.toISOString()}
              className={
                isToday
                  ? "min-h-[96px] bg-primary/5 p-1.5 ring-1 ring-inset ring-primary/20"
                  : "min-h-[96px] p-1.5"
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
                {items.slice(0, 3).map((c) => {
                  const st = STATUS_META[getStatus(c)];
                  return (
                    <div
                      key={c.id}
                      title={`${c.name} — ${c.service_type ?? "Servicio"}`}
                      className={`truncate rounded border px-1.5 py-0.5 text-[10px] font-semibold ${st.chip}`}
                    >
                      {c.name}
                    </div>
                  );
                })}
                {items.length > 3 && (
                  <div className="px-1 font-mono text-[9px] text-muted-foreground">
                    +{items.length - 3} más
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Tarjeta de aviso ---------------- */

function NoticeCard({
  client,
  highlight,
  onServiced,
}: {
  client: Client;
  highlight: boolean;
  onServiced: () => void;
}) {
  const status = getStatus(client);
  const meta = STATUS_META[status];
  const overdue = daysOverdue(client);
  const due = dueDate(client);

  return (
    <div
      className={`rounded-lg bg-card p-5 shadow-sm ring-1 ring-black/5 ${
        highlight ? "industrial-tape border-l-4 border-l-primary" : "border border-border/50"
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.badge} border`}
          >
            {status === "vencido"
              ? `Vencido${overdue > 0 ? ` · ${overdue} días` : ""}`
              : "Próximo"}
          </span>
          <h3 className="mt-2 text-sm font-semibold leading-tight">{client.name}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[client.service_type, client.address].filter(Boolean).join(" · ")}
          </p>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          #{client.id.slice(0, 4).toUpperCase()}
        </span>
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
      <div className="mt-3 flex items-center justify-between">
        <span className="font-mono text-[10px] text-muted-foreground">
          {due ? `Tocaba: ${formatDate(due.toISOString().slice(0, 10))}` : "Sin fecha previa"}
        </span>
        <button
          onClick={onServiced}
          className="cursor-pointer rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-background transition-colors hover:bg-primary"
        >
          Registrar servicio
        </button>
      </div>
    </div>
  );
}

/* ---------------- Fila de cliente ---------------- */

function ClientRow({
  client,
  onServiced,
  onDelete,
}: {
  client: Client;
  onServiced: () => void;
  onDelete: () => void;
}) {
  const meta = STATUS_META[getStatus(client)];
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50">
      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-muted font-mono text-[11px] font-bold">
        {initials(client.name)}
      </div>
      <div className="w-40 truncate text-sm font-medium">{client.name}</div>
      <div className="hidden w-36 font-mono text-xs text-muted-foreground md:block">
        {client.phone || "—"}
      </div>
      <div className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground lg:block">
        {[client.service_type, client.address].filter(Boolean).join(" · ")}
      </div>
      <div className="hidden font-mono text-[11px] text-muted-foreground sm:block">
        {formatDate(client.last_service_date)}
      </div>
      <span
        className={`ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${meta.badge}`}
      >
        {meta.label}
      </span>
      <button
        onClick={onServiced}
        title="Registrar servicio realizado hoy"
        className="shrink-0 cursor-pointer rounded-md border border-border px-2 py-1 text-[10px] font-semibold text-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
      >
        Servicio ✓
      </button>
      <button
        onClick={onDelete}
        title="Eliminar cliente"
        aria-label={`Eliminar a ${client.name}`}
        className="shrink-0 cursor-pointer rounded-md px-1.5 py-1 text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
      >
        ✕
      </button>
    </div>
  );
}

/* ---------------- Formulario de nuevo cliente ---------------- */

function ClientFormDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (name: string) => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    address: "",
    service_type: "",
    notes: "",
    interval_days: "30",
    last_service_date: new Date().toISOString().slice(0, 10),
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => setForm((f) => ({ ...f, [k]: e.target.value }));

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
      await createClient({
        name: parsed.data.name,
        phone: parsed.data.phone || null,
        address: parsed.data.address || null,
        service_type: parsed.data.service_type || null,
        notes: parsed.data.notes || null,
        interval_days: parsed.data.interval_days,
        last_service_date: parsed.data.last_service_date,
      });
      await onSaved(parsed.data.name);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20";
  const labelCls =
    "mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Nuevo cliente"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl ring-1 ring-black/10"
      >
        <h2 className="text-lg font-semibold tracking-tight">Nuevo cliente</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          El aviso se programará según la fecha del último servicio y el
          intervalo.
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label className={labelCls} htmlFor="f-name">Nombre *</label>
            <input id="f-name" className={inputCls} value={form.name} onChange={set("name")} maxLength={100} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="f-phone">Teléfono</label>
              <input id="f-phone" className={inputCls} value={form.phone} onChange={set("phone")} maxLength={25} />
            </div>
            <div>
              <label className={labelCls} htmlFor="f-service">Tipo de servicio</label>
              <input id="f-service" className={inputCls} value={form.service_type} onChange={set("service_type")} maxLength={80} />
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="f-address">Dirección</label>
            <input id="f-address" className={inputCls} value={form.address} onChange={set("address")} maxLength={150} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="f-last">Último servicio *</label>
              <input id="f-last" type="date" className={inputCls} value={form.last_service_date} onChange={set("last_service_date")} required />
            </div>
            <div>
              <label className={labelCls} htmlFor="f-interval">Cada (días) *</label>
              <input id="f-interval" type="number" min={1} max={3650} className={inputCls} value={form.interval_days} onChange={set("interval_days")} required />
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="f-notes">Notas</label>
            <textarea
              id="f-notes"
              className="min-h-[64px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              value={form.notes}
              onChange={set("notes")}
              maxLength={500}
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
    </div>
  );
}

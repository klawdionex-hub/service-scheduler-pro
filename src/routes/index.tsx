import { createFileRoute } from "@tanstack/react-router";
import { ServiceDashboard } from "@/components/service-dashboard";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Servicio Diario — Calendario de servicios a clientes" },
      {
        name: "description",
        content:
          "Calendario que te avisa a qué cliente le toca servicio: avisos con sus datos y fecha del último servicio, y buscador rápido de tu base de clientes.",
      },
      { property: "og:title", content: "Servicio Diario — Calendario de servicios a clientes" },
      {
        property: "og:description",
        content:
          "Avisos de servicios pendientes por cliente, calendario mensual y base de datos con buscador.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  return <ServiceDashboard />;
}

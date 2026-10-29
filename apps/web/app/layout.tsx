import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import "./map-workspace.css";

export const metadata: Metadata = {
  title: "Global Watch Coffee | Análise geoespacial",
  description:
    "Análise exploratória de áreas candidatas a café em imagens Sentinel-2",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

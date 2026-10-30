"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ChevronRight,
  FolderClosed,
  LoaderCircle,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { requestJSON, isAborted } from "@/lib/client-api";
import type { AnalysisStatus, HistoryItem } from "../analysis-types";
import {
  analysisTitle,
  formatDate,
  sceneDate,
  STATUS_LABELS,
} from "../analysis-types";
import { usePlatform } from "./PlatformShell";
import PageHeader from "./PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

export function AnalysisStatusLabel({
  status,
}: {
  status: AnalysisStatus | "all";
}) {
  return (
    <span className={`status-label status-${status}`}>
      <span className="status-dot" aria-hidden="true" />
      {status === "all" ? "Todos os status" : STATUS_LABELS[status]}
    </span>
  );
}
function createdDate(value: number) {
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

export default function AnalysesPage() {
  const { newAnalysis } = usePlatform();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [ascending, setAscending] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const data = await requestJSON<HistoryItem[]>("/api/analyses", {
        signal,
      });
      if (!signal?.aborted) {
        setItems(data);
        setError("");
      }
    } catch (caught) {
      if (!isAborted(caught))
        setError("Não foi possível carregar as análises.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    if (
      !items.some((item) => ["processing", "uploading"].includes(item.status))
    )
      return;
    const controller = new AbortController();
    const timer = setInterval(() => void load(controller.signal), 15000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [items, load]);
  const filtered = useMemo(
    () =>
      items
        .filter(
          (item) =>
            (status === "all" || item.status === status) &&
            `${analysisTitle(item.id)} ${item.scene ? "Sentinel-2 exemplo" : "GeoTIFF upload"} ${sceneDate(item.scene, item.date) ?? ""} ${formatDate(sceneDate(item.scene, item.date))}`
              .toLocaleLowerCase("pt-BR")
              .includes(search.trim().toLocaleLowerCase("pt-BR")),
        )
        .sort((a, b) =>
          ascending ? a.created - b.created : b.created - a.created,
        ),
    [items, search, status, ascending],
  );

  return (
    <>
      <PageHeader title="Análises" />
      <main className="collection-page page-container" id="main-content">
        <div className="collection-toolbar">
          <div className="collection-search">
            <Search size={16} />
            <Input
              aria-label="Buscar análises"
              placeholder="Buscar análises…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="collection-search-clear"
                aria-label="Limpar busca"
                onClick={() => setSearch("")}
              >
                <X size={14} />
              </Button>
            )}
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger
              className="collection-status"
              aria-label="Filtrar por status"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start" sideOffset={4}>
              <SelectItem value="all" textValue="Todos os status">
                <AnalysisStatusLabel status="all" />
              </SelectItem>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value} textValue={label}>
                  <AnalysisStatusLabel status={value as AnalysisStatus} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon-sm"
            className="refresh-button"
            aria-label="Atualizar análises"
            title="Atualizar análises"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw size={16} className={loading ? "spin" : ""} />
          </Button>
        </div>
        {error && (
          <div className="inline-error" role="alert">
            <span>{error}</span>
            <Button
              variant="ghost"
              className="text-button"
              onClick={() => void load()}
            >
              Tentar novamente
            </Button>
          </div>
        )}
        <div className="analysis-table-wrap" aria-busy={loading}>
          <Table className="analysis-table">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Imagem</TableHead>
                <TableHead scope="col" className="acquisition-column">
                  Aquisição
                </TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col" className="created-column">
                  <Button
                    variant="ghost"
                    className="sort-button"
                    onClick={() => setAscending((value) => !value)}
                    aria-label={
                      ascending
                        ? "Mais recentes primeiro"
                        : "Mais antigas primeiro"
                    }
                  >
                    Criada em{" "}
                    <ArrowDown
                      size={13}
                      className={ascending ? "is-ascending" : ""}
                    />
                  </Button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Link
                      className="analysis-link"
                      data-testid="analysis-link"
                      href={`/analyses/${item.id}`}
                      aria-label={`Abrir análise ${item.id}`}
                    >
                      <span className="analysis-link-copy">
                        <strong>{analysisTitle(item.id)}</strong>
                        <span>
                          {item.scene
                            ? "Sentinel-2 · Exemplo"
                            : "GeoTIFF · Upload"}
                        </span>
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="acquisition-column">
                    {formatDate(sceneDate(item.scene, item.date))}
                  </TableCell>
                  <TableCell>
                    <AnalysisStatusLabel status={item.status} />
                  </TableCell>
                  <TableCell className="created-column">
                    {createdDate(item.created)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {loading && items.length === 0 ? (
            <div className="collection-empty" role="status">
              <LoaderCircle size={22} className="spin" />
              <p>Carregando análises…</p>
            </div>
          ) : (
            !error &&
            filtered.length === 0 && (
              <div className="collection-empty">
                <FolderClosed size={28} strokeWidth={1.4} />
                <h2>
                  {items.length
                    ? "Nenhuma análise encontrada"
                    : "Suas análises ficam aqui"}
                </h2>
                <p>
                  {items.length
                    ? "Tente outro termo ou altere o filtro."
                    : "Envie uma imagem ou escolha um exemplo para começar."}
                </p>
                {items.length ? (
                  <Button
                    variant="outline"
                    className="collection-empty-action"
                    onClick={() => {
                      setSearch("");
                      setStatus("all");
                    }}
                  >
                    Limpar filtros
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="collection-empty-action"
                    onClick={newAnalysis}
                  >
                    Criar primeira análise <ChevronRight size={15} />
                  </Button>
                )}
              </div>
            )
          )}
        </div>
        {!error && (!loading || items.length > 0) && (
          <p className="collection-caption" role="status" aria-live="polite">
            {search.trim() || status !== "all"
              ? `${filtered.length} de ${items.length} ${items.length === 1 ? "análise" : "análises"}`
              : `${items.length} ${items.length === 1 ? "análise" : "análises"}`}
          </p>
        )}
      </main>
    </>
  );
}

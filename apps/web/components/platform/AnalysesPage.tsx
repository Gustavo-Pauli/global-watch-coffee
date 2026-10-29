"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUpRight,
  ChevronRight,
  FileImage,
  FolderClosed,
  LoaderCircle,
  Plus,
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
import { NavigationToggle, usePlatform } from "./PlatformShell";

export function AnalysisStatusLabel({ status }: { status: AnalysisStatus }) {
  return (
    <span className={`status-label status-${status}`}>
      <span className="status-dot" />
      {STATUS_LABELS[status]}
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
      <header className="page-topbar">
        <NavigationToggle />
        <FolderClosed size={16} />
        <span>Análises</span>
      </header>
      <main className="collection-page" id="main-content">
        <div className="collection-heading">
          <div>
            <h1>
              Análises{" "}
              <span className="record-count" aria-hidden="true">
                {items.length}
              </span>
            </h1>
            <p>Suas imagens e resultados de processamento.</p>
          </div>
          <button className="button button-primary" onClick={newAnalysis}>
            <Plus size={16} />
            Nova análise
          </button>
        </div>
        <div className="collection-toolbar">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="Buscar análises"
              placeholder="Buscar análises…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button
                className="icon-button"
                aria-label="Limpar busca"
                onClick={() => setSearch("")}
              >
                <X size={14} />
              </button>
            )}
          </label>
          <select
            className="filter-select"
            aria-label="Filtrar por status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">Todos os status</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button
            className="icon-button refresh-button"
            aria-label="Atualizar análises"
            title="Atualizar análises"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw size={16} className={loading ? "spin" : ""} />
          </button>
        </div>
        {error && (
          <div className="inline-error" role="alert">
            <span>{error}</span>
            <button className="text-button" onClick={() => void load()}>
              Tentar novamente
            </button>
          </div>
        )}
        <div className="analysis-table-wrap" aria-busy={loading}>
          <table className="analysis-table">
            <thead>
              <tr>
                <th scope="col">Imagem</th>
                <th scope="col" className="acquisition-column">
                  Aquisição
                </th>
                <th scope="col">Status</th>
                <th scope="col" className="created-column">
                  <button
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
                  </button>
                </th>
                <th scope="col">
                  <span className="sr-only">Abrir</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link
                      className="analysis-link"
                      data-testid="analysis-link"
                      href={`/analyses/${item.id}`}
                      aria-label={`Abrir análise ${item.id}`}
                    >
                      <span className="file-symbol">
                        <FileImage size={19} strokeWidth={1.5} />
                      </span>
                      <span className="analysis-link-copy">
                        <strong>{analysisTitle(item.id)}</strong>
                        <span>
                          {item.scene
                            ? "Sentinel-2 · Exemplo"
                            : "GeoTIFF · Upload"}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="acquisition-column">
                    {formatDate(sceneDate(item.scene, item.date))}
                  </td>
                  <td>
                    <AnalysisStatusLabel status={item.status} />
                  </td>
                  <td className="created-column">
                    {createdDate(item.created)}
                  </td>
                  <td className="row-open">
                    <Link
                      href={`/analyses/${item.id}`}
                      tabIndex={-1}
                      aria-hidden="true"
                    >
                      <ArrowUpRight size={17} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                  <button
                    className="button button-secondary"
                    onClick={() => {
                      setSearch("");
                      setStatus("all");
                    }}
                  >
                    Limpar filtros
                  </button>
                ) : (
                  <button
                    className="button button-secondary"
                    onClick={newAnalysis}
                  >
                    Criar primeira análise <ChevronRight size={15} />
                  </button>
                )}
              </div>
            )
          )}
        </div>
        {items.length > 0 && (
          <p className="collection-caption">
            {filtered.length} {filtered.length === 1 ? "análise" : "análises"}
            {search || status !== "all" ? ` de ${items.length}` : ""}
          </p>
        )}
      </main>
    </>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import * as DropdownMenu from "radix-ui/dropdown-menu";
import * as Switch from "radix-ui/switch";
import {
  ArrowLeft,
  ArrowUp,
  CalendarDays,
  ChevronDown,
  Download,
  FileImage,
  FileJson,
  Info,
  Layers,
  LoaderCircle,
  MessageSquare,
  RotateCcw,
  X,
} from "lucide-react";
import {
  requestJSON,
  isAborted,
  errorMessage,
  waitForPoll,
} from "@/lib/client-api";
import type {
  AnalysisData,
  ChatMessage,
  DownloadKind,
} from "../analysis-types";
import {
  analysisTitle,
  formatDate,
  formatNumber,
  sceneDate,
} from "../analysis-types";
import { NavigationToggle, usePlatform } from "./PlatformShell";

const SatelliteMap = dynamic(() => import("../SatelliteMap"), {
  ssr: false,
  loading: () => (
    <div className="map-loading" role="status">
      <LoaderCircle className="spin" size={20} />
      <span>Carregando mapa…</span>
    </div>
  ),
});
const FILES: { kind: DownloadKind; label: string; extension: string }[] = [
  { kind: "geojson", label: "Polígonos candidatos", extension: "GeoJSON" },
  { kind: "classified", label: "Imagem com polígonos", extension: "PNG" },
  { kind: "tif", label: "Classificação", extension: "GeoTIFF" },
  { kind: "rgb", label: "Imagem RGB", extension: "PNG" },
];
type Tool = "layers" | "information" | "chat" | null;

export default function AnalysisWorkspace({ id }: { id: string }) {
  const { newAnalysis } = usePlatform();
  const [data, setData] = useState<AnalysisData | null>(null);
  const [phase, setPhase] = useState<
    "opening" | "processing" | "error" | "ready"
  >("opening");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [overlay, setOverlay] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [showRaster, setShowRaster] = useState(true);
  const [showPolygons, setShowPolygons] = useState(true);
  const [tool, setTool] = useState<Tool>(null);
  const [downloading, setDownloading] = useState<DownloadKind | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
  const active = useRef(true);
  const operation = useRef<AbortController | null>(null);
  const downloadOperation = useRef<AbortController | null>(null);
  const chatOperation = useRef<AbortController | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  const chatEnd = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      chatOperation.current?.abort();
      downloadOperation.current?.abort();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    operation.current = controller;
    const signal = controller.signal;
    let objectUrl: string | null = null;
    setPhase("opening");
    setError("");
    setNotice("");
    setData(null);
    setOverlay(null);
    async function load() {
      try {
        const deadline = Date.now() + 11 * 60 * 1000;
        let result: AnalysisData | null = null;
        while (Date.now() < deadline) {
          const response = await fetch(`/api/analyses/${id}`, {
            credentials: "same-origin",
            cache: "no-store",
            signal,
          });
          const body = await response.json().catch(() => null);
          if (response.status === 202) {
            if (body?.analysis?.status === "uploading")
              throw new Error(
                "O envio desta imagem não foi concluído. Crie uma nova análise para reenviar os arquivos.",
              );
            setPhase("processing");
            await waitForPoll(signal, 4000);
            continue;
          }
          if (!response.ok)
            throw new Error(
              typeof body?.detail === "string"
                ? body.detail
                : "Não foi possível abrir esta análise.",
            );
          result = body as AnalysisData;
          break;
        }
        if (!result)
          throw new Error(
            "O processamento continua em andamento. Você pode acompanhar esta análise pela lista.",
          );
        if (signal.aborted) return;
        setData(result);
        setPhase("ready");
        try {
          const response = await fetch(`/api/analyses/${id}/files/map`, {
            credentials: "same-origin",
            cache: "no-store",
            signal,
          });
          if (!response.ok) throw new Error("Imagem indisponível");
          const blob = await response.blob();
          if (signal.aborted) return;
          objectUrl = URL.createObjectURL(blob);
          setOverlay(objectUrl);
        } catch (caught) {
          if (!isAborted(caught))
            setNotice(
              "A imagem não carregou. Os polígonos e resultados continuam disponíveis.",
            );
        }
      } catch (caught) {
        if (!isAborted(caught) && !signal.aborted) {
          setError(errorMessage(caught));
          setPhase("error");
        }
      }
    }
    void load();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, revision]);

  const closeTool = useCallback(() => {
    setTool(null);
    trigger.current?.focus();
  }, []);
  function toggleTool(next: Tool, button: HTMLButtonElement) {
    trigger.current = button;
    setTool((current) => (current === next ? null : next));
  }
  useEffect(() => {
    if (!tool) return;
    // Non-modal tools leave the map usable. Move focus into the panel and
    // return it to the originating control on close, including Escape.
    panel.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector('[role="dialog"], [role="menu"]')
      ) {
        event.preventDefault();
        closeTool();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [tool, closeTool]);
  useEffect(() => {
    if (tool === "chat") chatEnd.current?.scrollIntoView({ block: "nearest" });
  }, [messages, chatLoading, tool]);

  async function download(kind: DownloadKind) {
    if (downloadOperation.current) return;
    const controller = new AbortController();
    downloadOperation.current = controller;
    setDownloading(kind);
    setNotice("");
    try {
      const response = await fetch(`/api/analyses/${id}/files/${kind}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Arquivo indisponível");
      const blob = await response.blob();
      if (!active.current || controller.signal.aborted) return;
      const url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = {
        geojson: "candidatos.geojson",
        classified: "imagem_classificada.png",
        tif: "classificacao.tif",
        rgb: "imagem_rgb.png",
      }[kind];
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (caught) {
      if (!isAborted(caught) && active.current)
        setNotice(
          "O arquivo não está disponível. Tente novamente; os dados podem ter expirado.",
        );
    } finally {
      downloadOperation.current = null;
      if (active.current) setDownloading(null);
    }
  }
  async function sendQuestion() {
    const text = question.trim();
    if (text.length < 2 || !data || chatOperation.current) return;
    const controller = new AbortController();
    chatOperation.current = controller;
    setMessages((items) => [...items, { role: "user", text }]);
    setQuestion("");
    setChatLoading(true);
    try {
      const response = await requestJSON<{ answer: string; type: string }>(
        `/api/analyses/${id}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: text }),
          signal: controller.signal,
        },
      );
      if (!controller.signal.aborted && active.current)
        setMessages((items) => [
          ...items,
          { role: "assistant", text: response.answer, mode: response.type },
        ]);
    } catch (caught) {
      if (!isAborted(caught) && active.current)
        setMessages((items) => [
          ...items,
          { role: "assistant", text: errorMessage(caught), mode: "error" },
        ]);
    } finally {
      chatOperation.current = null;
      if (active.current) setChatLoading(false);
    }
  }

  const result = data?.result;
  const date = data
    ? (result?.acquisition_date ??
      sceneDate(data.analysis.scene, data.analysis.date))
    : null;
  const title =
    tool === "layers"
      ? "Camadas"
      : tool === "information"
        ? "Informações da análise"
        : "Assistente";

  return (
    <>
      <header className="page-topbar workspace-topbar">
        <NavigationToggle />
        <Link
          className="back-to-analyses"
          href="/analyses"
          aria-label="Voltar para Análises"
        >
          <ArrowLeft size={17} />
          <span>Análises</span>
        </Link>
        <span className="breadcrumb-divider">/</span>
        <h1>{analysisTitle(id)}</h1>
        {data && (
          <span className="workspace-date">
            <CalendarDays size={14} />
            {formatDate(date)}
          </span>
        )}
        <div className="workspace-header-actions">
          {data && (
            <button
              className={`button button-secondary assistant-button${tool === "chat" ? " is-active" : ""}`}
              aria-label="Assistente"
              aria-pressed={tool === "chat"}
              aria-controls="analysis-tool-panel"
              onClick={(event) => toggleTool("chat", event.currentTarget)}
            >
              <MessageSquare size={16} />
              <span>Assistente</span>
            </button>
          )}
        </div>
      </header>
      <main className="analysis-workspace" id="main-content">
        {!data ? (
          <div className="analysis-state" aria-live="polite">
            {phase === "error" ? (
              <>
                <div className="state-icon">
                  <FileImage size={26} strokeWidth={1.5} />
                </div>
                <h2>Não foi possível abrir a análise</h2>
                <p role="alert">{error}</p>
                <div className="state-actions">
                  <button
                    className="button button-secondary"
                    onClick={() => setRevision((value) => value + 1)}
                  >
                    <RotateCcw size={15} />
                    Tentar novamente
                  </button>
                  <button
                    className="button button-primary"
                    onClick={newAnalysis}
                  >
                    Nova análise
                  </button>
                </div>
              </>
            ) : (
              <>
                <LoaderCircle size={28} className="spin" />
                <h2>
                  {phase === "processing"
                    ? "Processando imagem"
                    : "Abrindo análise"}
                </h2>
                <p>
                  {phase === "processing"
                    ? "A imagem está sendo analisada. Você pode voltar à lista e acompanhar por lá."
                    : "Carregando a imagem e os resultados."}
                </p>
                {phase === "processing" && (
                  <Link className="button button-secondary" href="/analyses">
                    Voltar às análises <ArrowLeft size={15} />
                  </Link>
                )}
              </>
            )}
          </div>
        ) : (
          <>
            <div className="map-canvas" aria-label="Mapa da análise">
              <SatelliteMap
                geojson={data.geojson}
                bounds={data.result.leaflet_bounds}
                overlay={overlay}
                showRaster={showRaster}
                showPolygons={showPolygons}
              />
            </div>
            <div
              className="map-toolbar"
              role="group"
              aria-label="Ferramentas da análise"
            >
              <button
                className="tool-button"
                aria-label="Camadas"
                aria-pressed={tool === "layers"}
                aria-controls="analysis-tool-panel"
                onClick={(event) => toggleTool("layers", event.currentTarget)}
              >
                <Layers size={17} />
                <span>Camadas</span>
              </button>
              <button
                className="tool-button"
                aria-label="Informações"
                title="Informações"
                aria-pressed={tool === "information"}
                aria-controls="analysis-tool-panel"
                onClick={(event) =>
                  toggleTool("information", event.currentTarget)
                }
              >
                <Info size={17} />
                <span>Informações</span>
              </button>
              <span className="toolbar-separator" />
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    className="tool-button"
                    aria-label="Arquivos"
                    aria-busy={Boolean(downloading)}
                  >
                    {downloading ? (
                      <LoaderCircle size={17} className="spin" />
                    ) : (
                      <Download size={17} />
                    )}
                    <span>Arquivos</span>
                    <ChevronDown size={12} />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    className="menu-content download-menu"
                    align="start"
                    sideOffset={8}
                    collisionPadding={12}
                  >
                    {FILES.map((file) => (
                      <DropdownMenu.Item
                        className="menu-item"
                        key={file.kind}
                        disabled={Boolean(downloading)}
                        onSelect={() => void download(file.kind)}
                      >
                        {file.kind === "geojson" ? (
                          <FileJson size={16} />
                        ) : (
                          <FileImage size={16} />
                        )}
                        <span>{file.label}</span>
                        <span className="menu-detail">{file.extension}</span>
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
            <div className="map-legend" aria-label="Legenda e área estimada">
              <span
                className={`legend-swatch${showPolygons ? "" : " is-hidden"}`}
              />
              <span>Áreas candidatas</span>
              <strong>
                {formatNumber(data.result.candidate_area_ha)} <span>ha</span>
              </strong>
              {!showPolygons && <span className="legend-hidden">Ocultas</span>}
            </div>
            {notice && (
              <div className="map-notice" role="alert">
                <span>{notice}</span>
                <button
                  className="text-button"
                  onClick={() => setRevision((value) => value + 1)}
                >
                  Recarregar
                </button>
                <button
                  className="icon-button"
                  aria-label="Fechar aviso"
                  onClick={() => setNotice("")}
                >
                  <X size={15} />
                </button>
              </div>
            )}
            {tool && (
              <section
                ref={panel}
                tabIndex={-1}
                className={`map-panel ${tool === "chat" ? "assistant-panel" : ""}`}
                id="analysis-tool-panel"
                aria-label={title}
              >
                <div className="map-panel-header">
                  <h2>{title}</h2>
                  <button
                    className="icon-button"
                    aria-label="Fechar painel"
                    onClick={closeTool}
                  >
                    <X size={18} />
                  </button>
                </div>
                {tool === "layers" && (
                  <div className="map-panel-body">
                    <div className="layer-row">
                      <span className="layer-symbol raster-symbol">
                        <FileImage size={19} />
                      </span>
                      <label htmlFor="raster-switch">
                        <strong>Imagem de satélite</strong>
                        <span>Composição RGB</span>
                      </label>
                      <Switch.Root
                        id="raster-switch"
                        className="switch"
                        checked={showRaster}
                        onCheckedChange={setShowRaster}
                        disabled={!overlay}
                        aria-label="Imagem de satélite"
                      >
                        <Switch.Thumb className="switch-thumb" />
                      </Switch.Root>
                    </div>
                    <div className="layer-row">
                      <span className="layer-symbol candidate-symbol">
                        <Layers size={19} />
                      </span>
                      <label htmlFor="polygon-switch">
                        <strong>Áreas candidatas</strong>
                        <span>Polígonos do processamento</span>
                      </label>
                      <Switch.Root
                        id="polygon-switch"
                        className="switch"
                        checked={showPolygons}
                        onCheckedChange={setShowPolygons}
                        aria-label="Áreas candidatas"
                      >
                        <Switch.Thumb className="switch-thumb" />
                      </Switch.Root>
                    </div>
                    <p className="panel-note">
                      Mapa de referência: OpenStreetMap.
                    </p>
                  </div>
                )}
                {tool === "information" && (
                  <div className="map-panel-body">
                    <dl className="result-summary">
                      <div className="primary-result">
                        <dt>Área candidata</dt>
                        <dd>
                          {formatNumber(data.result.candidate_area_ha)}{" "}
                          <span>ha</span>
                        </dd>
                      </div>
                      <div>
                        <dt>Polígonos candidatos</dt>
                        <dd>
                          {formatNumber(data.result.candidate_polygon_count, 0)}
                        </dd>
                      </div>
                      <div>
                        <dt>NDVI mediano</dt>
                        <dd>
                          {data.result.ndvi_median == null
                            ? "—"
                            : formatNumber(data.result.ndvi_median, 3)}
                        </dd>
                      </div>
                    </dl>
                    {data.result.candidate_polygon_count === 0 && (
                      <p className="panel-note">
                        Nenhuma área candidata foi identificada nesta imagem.
                      </p>
                    )}
                    <p className="result-caveat">
                      Áreas potenciais de café, sem validação em campo.
                    </p>
                    <details className="method-details">
                      <summary>Método e limitações</summary>
                      <p>
                        {data.result.method === "rf_purified_multiclass_2.0"
                          ? "Random Forest com supervisão fraca do MapBiomas. A classificação combina bandas espectrais e índices de vegetação."
                          : data.result.method}
                      </p>
                      <p>{data.result.limitations}</p>
                      <dl className="detail-values">
                        <div>
                          <dt>Pixels válidos</dt>
                          <dd>{formatNumber(data.result.valid_pixels, 0)}</dd>
                        </div>
                        <div>
                          <dt>Aquisição</dt>
                          <dd>{formatDate(date)}</dd>
                        </div>
                      </dl>
                    </details>
                  </div>
                )}
                {tool === "chat" && (
                  <>
                    <div className="chat-scroll">
                      <div className="analysis-attachment">
                        {previewError ? (
                          <button
                            className="text-button"
                            onClick={() => {
                              setPreviewError(false);
                              setPreviewRevision((value) => value + 1);
                            }}
                          >
                            Recarregar imagem
                          </button>
                        ) : (
                          <button
                            className="classification-preview"
                            onClick={closeTool}
                            aria-label="Ver classificação no mapa"
                          >
                            <img
                              key={previewRevision}
                              src={`/api/analyses/${id}/files/classified`}
                              alt="Imagem processada com os polígonos candidatos a café"
                              onError={() => setPreviewError(true)}
                            />
                            <span>
                              <FileImage size={14} />
                              Classificação da imagem
                            </span>
                          </button>
                        )}
                      </div>
                      {messages.length === 0 && (
                        <div className="chat-introduction">
                          <h3>Sobre esta análise</h3>
                          <p>
                            Pergunte sobre as áreas candidatas, o NDVI ou as
                            limitações do resultado.
                          </p>
                          <button
                            className="suggestion-button"
                            onClick={() =>
                              setQuestion(
                                "Como interpretar as áreas candidatas?",
                              )
                            }
                          >
                            Como interpretar o resultado?
                          </button>
                        </div>
                      )}
                      <div
                        className="chat-messages"
                        role="log"
                        aria-label="Conversa sobre a análise"
                        aria-live="polite"
                      >
                        {messages.map((message, index) => (
                          <div
                            className={`chat-message ${message.role}`}
                            key={index}
                          >
                            <span className="message-author">
                              {message.role === "user" ? "Você" : "Assistente"}
                              {message.mode === "rules_fallback_not_ai" && (
                                <span className="response-mode">
                                  Resposta por regras · IA indisponível
                                </span>
                              )}
                            </span>
                            <p>{message.text}</p>
                          </div>
                        ))}
                        {chatLoading && (
                          <div className="chat-thinking" role="status">
                            <LoaderCircle size={14} className="spin" />
                            Consultando análise…
                          </div>
                        )}
                        <div ref={chatEnd} />
                      </div>
                    </div>
                    <form
                      className="chat-composer"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void sendQuestion();
                      }}
                    >
                      <div className="chat-input-wrap">
                        <textarea
                          aria-label="Pergunta sobre a análise"
                          value={question}
                          placeholder="Pergunte sobre esta imagem…"
                          rows={2}
                          maxLength={1200}
                          readOnly={chatLoading}
                          aria-busy={chatLoading}
                          onChange={(event) => setQuestion(event.target.value)}
                          onKeyDown={(event) => {
                            if (
                              event.key === "Enter" &&
                              !event.shiftKey &&
                              !event.nativeEvent.isComposing
                            ) {
                              event.preventDefault();
                              void sendQuestion();
                            }
                          }}
                        />
                        <button
                          className="send-question"
                          type="submit"
                          aria-label="Enviar pergunta"
                          disabled={chatLoading || question.trim().length < 2}
                        >
                          {chatLoading ? (
                            <LoaderCircle size={17} className="spin" />
                          ) : (
                            <ArrowUp size={18} />
                          )}
                        </button>
                      </div>
                      <p>Respostas fundamentadas nos dados desta imagem.</p>
                    </form>
                  </>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}

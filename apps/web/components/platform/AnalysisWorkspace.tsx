"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import * as DropdownMenu from "radix-ui/dropdown-menu";
import * as Tabs from "radix-ui/tabs";
import {
  ArrowUp,
  ChevronDown,
  Download,
  FileImage,
  FileJson,
  PanelRight,
  LoaderCircle,
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
  formatCompactDate,
  formatDate,
  formatNumber,
  sceneDate,
} from "../analysis-types";
import PageHeader from "./PageHeader";
import AboutResult from "./AboutResult";
import MapLayersPicker from "./MapLayersPicker";
import type { BasemapId } from "../map-sources";

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
type InspectorTab = "information" | "chat";

export default function AnalysisWorkspace({ id }: { id: string }) {
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
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("information");
  const hasMapKey = Boolean(process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim());
  const [basemap, setBasemap] = useState<BasemapId>(
    hasMapKey ? "satellite" : "none",
  );
  const focusInspector = useRef(false);
  const focusReopen = useRef(false);
  const questionInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 900px)");
    setInspectorOpen(media.matches);
    const resize = () => {
      if (!media.matches) setInspectorOpen(false);
    };
    media.addEventListener("change", resize);
    try {
      const saved = localStorage.getItem("global-watch:basemap:v1");
      if (hasMapKey && ["satellite", "streets", "none"].includes(saved ?? ""))
        setBasemap(saved as BasemapId);
    } catch {
      /* Browser storage is optional. */
    }
    return () => media.removeEventListener("change", resize);
  }, [hasMapKey]);
  function selectBasemap(value: BasemapId) {
    setBasemap(value);
    try {
      localStorage.setItem("global-watch:basemap:v1", value);
    } catch {
      /* Optional preference. */
    }
  }
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

  const closeInspector = useCallback(() => {
    focusReopen.current = true;
    setInspectorOpen(false);
  }, []);
  useEffect(() => {
    if (!inspectorOpen && focusReopen.current) {
      trigger.current?.focus();
      focusReopen.current = false;
    }
    if (inspectorOpen && focusInspector.current) {
      panel.current
        ?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
        ?.focus();
      focusInspector.current = false;
    }
  }, [inspectorOpen]);
  useEffect(() => {
    if (inspectorOpen && inspectorTab === "chat")
      chatEnd.current?.scrollIntoView({ block: "nearest" });
  }, [messages, chatLoading, inspectorOpen, inspectorTab]);

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

  return (
    <>
      <PageHeader
        title={analysisTitle(id)}
        meta={
          data ? (
            <time
              className="header-acquisition"
              dateTime={date ?? undefined}
              aria-label={`Aquisição: ${formatDate(date)}`}
              title={`Aquisição: ${formatDate(date, true)}`}
            >
              {formatCompactDate(date)}
            </time>
          ) : undefined
        }
      />
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
                    ? "Os resultados aparecerão aqui quando o processamento terminar."
                    : "Carregando a imagem e os resultados."}
                </p>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="map-stage">
              <div className="map-canvas" aria-label="Mapa da análise">
                <SatelliteMap
                  geojson={data.geojson}
                  bounds={data.result.leaflet_bounds}
                  overlay={overlay}
                  showRaster={showRaster}
                  showPolygons={showPolygons}
                  basemap={basemap}
                  inspectorRef={panel}
                />
              </div>
              <div
                className="map-toolbar"
                role="group"
                aria-label="Ferramentas da análise"
              >
                <MapLayersPicker
                  basemap={basemap}
                  onBasemap={selectBasemap}
                  hasKey={hasMapKey}
                  hasImage={Boolean(overlay)}
                  showRaster={showRaster}
                  onRaster={setShowRaster}
                  showPolygons={showPolygons}
                  onPolygons={setShowPolygons}
                />
                <span className="toolbar-separator" />
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      className="tool-button"
                      aria-label="Baixar arquivos"
                      aria-busy={Boolean(downloading)}
                    >
                      {downloading ? (
                        <LoaderCircle size={17} className="spin" />
                      ) : (
                        <Download size={17} />
                      )}
                      <span>Baixar</span>
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
              {!inspectorOpen && (
                <button
                  ref={trigger}
                  className="button button-secondary map-results-button"
                  aria-label="Mostrar resultados"
                  aria-expanded={false}
                  aria-controls="analysis-inspector"
                  onClick={() => {
                    focusInspector.current = true;
                    setInspectorOpen(true);
                  }}
                >
                  <PanelRight size={16} />
                  <span>Resultados</span>
                </button>
              )}
              <div className="map-legend" aria-label="Legenda e área estimada">
                <span
                  className={`legend-swatch${showPolygons ? "" : " is-hidden"}`}
                />
                <span>Áreas candidatas</span>
                <strong>
                  {formatNumber(data.result.candidate_area_ha)} <span>ha</span>
                </strong>
                {!showPolygons && (
                  <span className="legend-hidden">Ocultas</span>
                )}
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
            </div>
            {inspectorOpen && (
              <aside
                ref={panel}
                className={`analysis-inspector ${inspectorTab === "information" ? "is-information" : "is-chat"}`}
                id="analysis-inspector"
                aria-label="Painel da análise"
                onKeyDown={(event) => {
                  if (
                    event.key === "Escape" &&
                    !event.defaultPrevented &&
                    !document.querySelector('[role="dialog"], [role="menu"]')
                  ) {
                    event.preventDefault();
                    closeInspector();
                  }
                }}
              >
                <Tabs.Root
                  value={inspectorTab}
                  onValueChange={(value) =>
                    setInspectorTab(value as InspectorTab)
                  }
                  className="inspector-tabs"
                >
                  <div className="inspector-header">
                    <Tabs.List
                      className="inspector-tab-list"
                      aria-label="Painel da análise"
                    >
                      <Tabs.Trigger
                        value="information"
                        className="inspector-tab"
                      >
                        Informações
                      </Tabs.Trigger>
                      <Tabs.Trigger value="chat" className="inspector-tab">
                        Assistente
                      </Tabs.Trigger>
                    </Tabs.List>
                    <button
                      className="icon-button"
                      aria-label="Fechar painel"
                      onClick={closeInspector}
                    >
                      <X size={17} />
                    </button>
                  </div>
                  <Tabs.Content
                    value="information"
                    className="inspector-content info-content"
                    aria-label="Informações"
                  >
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
                            {formatNumber(
                              data.result.candidate_polygon_count,
                              0,
                            )}
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
                      <AboutResult result={data.result} />
                    </div>
                  </Tabs.Content>
                  <Tabs.Content
                    value="chat"
                    className="inspector-content chat-content"
                    aria-label="Assistente"
                  >
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
                              onClick={closeInspector}
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
                            <button
                              className="suggestion-button"
                              onClick={() => {
                                setQuestion(
                                  "Como interpretar as áreas candidatas?",
                                );
                                questionInput.current?.focus();
                              }}
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
                                {message.role === "user"
                                  ? "Você"
                                  : "Assistente"}
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
                            ref={questionInput}
                            aria-label="Pergunta sobre a análise"
                            value={question}
                            placeholder="Pergunte sobre esta imagem…"
                            rows={2}
                            maxLength={1200}
                            readOnly={chatLoading}
                            aria-busy={chatLoading}
                            onChange={(event) =>
                              setQuestion(event.target.value)
                            }
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
                      </form>
                    </>
                  </Tabs.Content>
                </Tabs.Root>
              </aside>
            )}
          </>
        )}
      </main>
    </>
  );
}

"use client";
import { cn } from "@/lib/utils";
import { actionButtonVariants, textButtonClass } from "@/components/ui/action";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import AnalysisChat from "@/features/chat/AnalysisChat";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import * as DropdownMenu from "@/components/ui/dropdown-menu";
import * as Tabs from "radix-ui/tabs";
import { Download, FileImage, FileJson, PanelRight, LoaderCircle, RotateCcw, X, } from "lucide-react";
import { requestJSON, isAborted, errorMessage, waitForPoll, requestSignal, } from "@/lib/client-api";
import { usePlatform } from "@/features/shell/PlatformShell";
import type { AnalysisData, ChatMessage, DownloadKind, } from "@/features/analyses/types";
import { analysisTitle, formatCompactDate, formatDate, formatNumber, sceneDate, } from "@/features/analyses/types";
import PageHeader from "@/features/shell/PageHeader";
import ResultInformation from "./ResultInformation";
import { useRaster } from "./use-raster";
import type { FocusRequest } from "./candidates";
import MapLayersPicker from "./MapLayersPicker";
import MapToolButton, { mapControlGroupClass } from "./MapToolButton";
import type { BasemapId } from "./sources";
const SatelliteMap = dynamic(() => import("./SatelliteMap"), {
    ssr: false,
    loading: () => (<div className={"flex size-full items-center justify-center gap-[10px] text-[13px] text-muted-foreground"} role="status">
      <LoaderCircle className={"animate-spin"} size={20}/>
      <span>Carregando mapa…</span>
    </div>),
});
const FILES: {
    kind: DownloadKind;
    label: string;
    extension: string;
}[] = [
    {
        kind: "geojson",
        label: "Polígonos",
        extension: "GeoJSON",
    },
    { kind: "classified", label: "Imagem com polígonos", extension: "PNG" },
    { kind: "tif", label: "Classificação", extension: "GeoTIFF" },
    { kind: "rgb", label: "Imagem RGB", extension: "PNG" },
    { kind: "result", label: "Metadados da análise", extension: "JSON" },
];
type InspectorTab = "information" | "chat";
export default function AnalysisWorkspace({ id }: {
    id: string;
}) {
    const { newAnalysis } = usePlatform();
    const [data, setData] = useState<AnalysisData | null>(null);
    const [phase, setPhase] = useState<"opening" | "processing" | "error" | "ready">("opening");
    const [error, setError] = useState("");
    const [terminalError, setTerminalError] = useState(false);
    const [notice, setNotice] = useState("");
    const raster = useRaster(id, data?.result);
    const [opacity, setOpacity] = useState(100);
    const [selected, setSelected] = useState<number | null>(null);
    const [focusRequest, setFocusRequest] = useState<FocusRequest>(null);
    const [revision, setRevision] = useState(0);
    const [showRaster, setShowRaster] = useState(true);
    const [showPolygons, setShowPolygons] = useState(true);
    const [inspectorOpen, setInspectorOpen] = useState(false);
    const [inspectorTab, setInspectorTab] = useState<InspectorTab>("information");
    const hasMapKey = Boolean(process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim());
    const [basemap, setBasemap] = useState<BasemapId>(hasMapKey ? "satellite" : "none");
    const focusInspector = useRef(false);
    const focusReopen = useRef(false);
    const questionInput = useRef<HTMLTextAreaElement>(null);
    const askCandidate = useCallback((candidateId: number) => {
        setSelected(candidateId);
        setQuestion(`Como interpretar o polígono ${candidateId}?`);
        setInspectorTab("chat");
        setInspectorOpen(true);
        requestAnimationFrame(() => questionInput.current?.focus());
    }, []);
    function focusCandidate(candidateId: number) {
        setSelected(candidateId);
        setShowPolygons(true);
        setFocusRequest(current => ({ id: candidateId, sequence: (current?.sequence ?? 0) + 1 }));
        if (window.matchMedia("(max-width: 899px)").matches) setInspectorOpen(false);
    }
    useEffect(() => {
        const media = window.matchMedia("(min-width: 900px)");
        setInspectorOpen(media.matches);
        const resize = () => {
            if (!media.matches)
                setInspectorOpen(false);
        };
        media.addEventListener("change", resize);
        try {
            const saved = localStorage.getItem("global-watch:basemap:v1");
            if (hasMapKey && ["satellite", "streets", "none"].includes(saved ?? ""))
                setBasemap(saved as BasemapId);
        }
        catch {
            /* Browser storage is optional. */
        }
        return () => media.removeEventListener("change", resize);
    }, [hasMapKey]);
    function selectBasemap(value: BasemapId) {
        setBasemap(value);
        try {
            localStorage.setItem("global-watch:basemap:v1", value);
        }
        catch {
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
        setPhase("opening");
        setError("");
        setTerminalError(false);
        setNotice("");
        setData(null);
        async function load() {
            try {
                const deadline = Date.now() + 11 * 60 * 1000;
                let result: AnalysisData | null = null;
                while (Date.now() < deadline) {
                    const response = await fetch(`/api/analyses/${id}`, {
                        credentials: "same-origin",
                        cache: "no-store",
                        signal: requestSignal(signal),
                    });
                    const body = await response.json().catch(() => null);
                    if (response.status === 202) {
                        if (body?.analysis?.status === "uploading") {
                            setTerminalError(true);
                            throw new Error("O envio desta imagem não foi concluído. Crie uma nova análise para reenviar os arquivos.");
                        }
                        setPhase("processing");
                        await waitForPoll(signal, 4000);
                        continue;
                    }
                    if (!response.ok) {
                        if (response.status === 422 || response.status === 404)
                            setTerminalError(true);
                        throw new Error(typeof body?.detail === "string"
                            ? body.detail
                            : "Não foi possível abrir esta análise.");
                    }
                    result = body as AnalysisData;
                    break;
                }
                if (!result)
                    throw new Error("O processamento continua em andamento. Você pode acompanhar esta análise pela lista.");
                if (signal.aborted)
                    return;
                setData(result);
                setPhase("ready");

            }
            catch (caught) {
                if (!isAborted(caught) && !signal.aborted) {
                    setError(errorMessage(caught));
                    setPhase("error");
                }
            }
        }
        void load();
        return () => {
            controller.abort();
        };
    }, [id, revision]);
    const closeInspector = useCallback(() => {
        focusReopen.current = true;
        setInspectorOpen(false);
    }, []);
    useEffect(() => {
        let focusFrame = 0;
        if (!inspectorOpen && focusReopen.current) {
            focusReopen.current = false;
            // On mobile the map becomes visible again when the conversation closes.
            focusFrame = requestAnimationFrame(() => trigger.current?.focus());
        }
        if (inspectorOpen && focusInspector.current) {
            panel.current
                ?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
                ?.focus();
            focusInspector.current = false;
        }
        return () => cancelAnimationFrame(focusFrame);
    }, [inspectorOpen]);
    useEffect(() => {
        if (inspectorOpen && inspectorTab === "chat")
            chatEnd.current?.scrollIntoView({ block: "nearest" });
    }, [messages, chatLoading, inspectorOpen, inspectorTab]);
    async function download(kind: DownloadKind) {
        if (downloadOperation.current)
            return;
        const controller = new AbortController();
        downloadOperation.current = controller;
        setDownloading(kind);
        setNotice("");
        try {
            const response = await fetch(`/api/analyses/${id}/files/${kind}`, {
                credentials: "same-origin",
                cache: "no-store",
                signal: requestSignal(controller.signal, 60000),
            });
            if (!response.ok)
                throw new Error("Arquivo indisponível");
            const blob = await response.blob();
            if (!active.current || controller.signal.aborted)
                return;
            const url = URL.createObjectURL(blob), anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = {
                geojson: "candidatos.geojson",
                classified: "imagem_classificada.png",
                tif: "classificacao.tif",
                rgb: "imagem_rgb.png",
                result: "resultado.json",
            }[kind];
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        }
        catch (caught) {
            if (!isAborted(caught) && active.current)
                setNotice("O arquivo não está disponível. Tente novamente; os dados podem ter expirado.");
        }
        finally {
            downloadOperation.current = null;
            if (active.current)
                setDownloading(null);
        }
    }
    async function sendQuestion() {
        const text = question.trim();
        if (text.length < 2 || !data || chatOperation.current)
            return;
        const controller = new AbortController();
        chatOperation.current = controller;
        setMessages((items) => [...items, { role: "user", text }]);
        setQuestion("");
        setChatLoading(true);
        try {
            const response = await requestJSON<{
                answer: string;
                type: string;
                reason?: string;
            }>(`/api/analyses/${id}/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: text, history: messages.filter(message => message.mode !== 'error').slice(-6).map(message => ({ role: message.role, text: message.text.slice(0, 1200) })) }),
                signal: controller.signal,
                timeoutMs: 55000,
            });
            if (!controller.signal.aborted && active.current)
                setMessages((items) => [
                    ...items,
                    { role: "assistant", text: response.answer, mode: response.type, reason: response.reason },
                ]);
        }
        catch (caught) {
            if (!isAborted(caught) && active.current)
                setMessages((items) => [
                    ...items,
                    { role: "assistant", text: errorMessage(caught), mode: "error" },
                ]);
        }
        finally {
            chatOperation.current = null;
            if (active.current)
                setChatLoading(false);
        }
    }
    const result = data?.result;
    const date = data
        ? (result?.acquisition_date ??
            sceneDate(data.analysis.scene, data.analysis.date))
        : null;
    return (<>
      <PageHeader fullWidth title={analysisTitle(id)} meta={data ? (<time className="m-0 block overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-muted-foreground" dateTime={date ?? undefined} aria-label={`Aquisição: ${formatDate(date)}`} title={`Aquisição: ${formatDate(date, true)}`} data-testid="acquisition-date">
              {formatCompactDate(date)}
            </time>) : undefined}/>
      <main className={"relative min-h-0 flex-1 overflow-hidden bg-[#1b1d1e]"} id="main-content" data-testid="map-workspace">
        {!data ? (<div className={"flex size-full flex-col items-center justify-center gap-[18px] bg-[#19191b] p-[30px] text-center max-[760px]:p-[25px]"} aria-live="polite" data-testid="analysis-state">
            {phase === "error" ? (<>
                <div className={"text-muted-foreground"}>
                  <FileImage size={26} strokeWidth={1.5}/>
                </div>
                <h2 className={"text-[18px] font-medium tracking-[-0.3px]"}>Não foi possível abrir a análise</h2>
                <p role="alert" className={"max-w-[390px] text-[13px] leading-[1.7] text-muted-foreground"}>{error}</p>
                <div className={"flex flex-wrap justify-center gap-[9px]"}>
                  {terminalError ? (<>
                      <Button className={actionButtonVariants({ appearance: "primary" })} onClick={newAnalysis} variant="native">Nova análise</Button>
                      <Link className={actionButtonVariants({ appearance: "secondary" })} href="/analyses">Voltar às análises</Link>
                    </>) : <Button className={actionButtonVariants({ appearance: "secondary" })} onClick={() => setRevision((value) => value + 1)} variant="native">
                    <RotateCcw size={15}/>
                    Tentar novamente
                  </Button>}
                </div>
              </>) : (<>
                <LoaderCircle size={28} className={"animate-spin"}/>
                <h2 className={"text-[18px] font-medium tracking-[-0.3px]"}>
                  {phase === "processing"
                    ? "Processando imagem"
                    : "Abrindo análise"}
                </h2>
                <p className={"max-w-[390px] text-[13px] leading-[1.7] text-muted-foreground"}>
                  {phase === "processing"
                    ? "Os resultados aparecerão aqui quando o processamento terminar."
                    : "Carregando a imagem e os resultados."}
                </p>
              </>)}
          </div>) : (<>
            <div className={cn("@container absolute inset-0 h-full min-w-0 overflow-hidden", inspectorOpen && "right-[340px] max-[899px]:invisible max-[899px]:right-0")} data-testid="map-stage">
              <div className={"absolute inset-0 size-full"} aria-label="Mapa da análise" data-testid="map-canvas">
                <SatelliteMap geojson={data.geojson} bounds={data.result.leaflet_bounds} overlay={raster.overlay} opacity={opacity / 100} selected={selected} onSelect={setSelected} onAsk={askCandidate} focusRequest={focusRequest} showRaster={showRaster} showPolygons={showPolygons} basemap={basemap} inspectorRef={panel}/>
              </div>
              <div className={"absolute left-[14px] top-[14px] z-[500] flex min-h-[36px] max-w-[calc(100%-148px)] flex-wrap items-center gap-[9px] rounded-[6px] border border-solid border-[#424246] bg-[#202023] px-[12px] py-[9px] text-[12px] text-[#dddde0] shadow-[0_3px_12px_#0003] max-[760px]:left-[12px] max-[760px]:top-[12px] max-[760px]:grid max-[760px]:max-w-[calc(100%-150px)] max-[760px]:grid-cols-[11px_auto] max-[760px]:gap-x-[8px] max-[760px]:gap-y-[5px] max-[760px]:px-[10px] max-[760px]:py-[8px]"} aria-label="Legenda e área estimada" data-testid="map-legend">
                <span className="size-[11px] shrink-0 border border-solid border-[var(--accent)] bg-[#c0d6a633]" />
                <span >Plantações de Café</span>
                <strong className={"ml-[3px] border-l border-solid border-[#505056] pl-[10px] font-medium tabular-nums text-[#f2f2f3] max-[760px]:col-start-2 max-[760px]:m-0 max-[760px]:border-0 max-[760px]:p-0"}>
                  {formatNumber(data.result.candidate_area_ha)} <span className="font-normal text-muted-foreground">ha</span>
                </strong>
                {!showPolygons && (<span className={"text-muted-foreground max-[760px]:col-start-2"}>Ocultas</span>)}
                {showRaster && opacity > 0 && raster.overlay && raster.rendered === "ndvi" && <div className="basis-full border-t border-solid border-[#424246] pt-[7px] max-[760px]:col-span-2" aria-label="Escala NDVI" data-testid="ndvi-legend">
                  <div className="mb-[5px] flex justify-between text-[10px] text-muted-foreground"><span>NDVI</span><span>Vegetação</span></div>
                  <div className="h-[5px] min-w-[150px] rounded-[2px] bg-[linear-gradient(90deg,#8c4c2d,#ece1b5,#2e6b4f)]" />
                  <div className="mt-[4px] flex justify-between text-[10px] tabular-nums text-muted-foreground"><span>−1</span><span>0</span><span>+1</span></div>
                </div>}
              </div>
              {notice && (<div className={"absolute left-[17px] top-[73px] z-[850] flex max-w-[min(520px,calc(100%-34px))] items-center gap-[12px] rounded-[5px] border border-solid border-[#68574a] bg-[#272321] px-[12px] py-[10px] text-[12px] leading-[1.5] text-[#e8cfb9] max-[760px]:left-[12px] max-[760px]:top-[64px] max-[760px]:max-w-[calc(100%-24px)]"} role="alert">
                  <span>{notice}</span>
                  <Button className={textButtonClass} onClick={() => setRevision((value) => value + 1)} variant="native">
                    Recarregar
                  </Button>
                  <IconButton  aria-label="Fechar aviso" onClick={() => setNotice("")}>
                    <X size={15}/>
                  </IconButton>
                </div>)}
            </div>
            <div className={cn("absolute right-[14px] top-[14px] z-[650] flex w-max flex-col gap-[8px] max-[760px]:right-[12px] max-[760px]:top-[12px]", inspectorOpen && "right-[354px] max-[899px]:hidden")} data-testid="map-actions">
              {!inspectorOpen && (<div className={mapControlGroupClass} data-testid="map-results-control">
                  <MapToolButton ref={trigger}  label="Mostrar resultados" aria-expanded={false} aria-controls="analysis-inspector" onClick={() => {
                    focusInspector.current = true;
                    setInspectorOpen(true);
                }}>
                    <PanelRight size={16}/>
                  </MapToolButton>
                </div>)}
              <div className={mapControlGroupClass} role="group" aria-label="Ferramentas da análise" data-testid="map-toolbar">
                <MapLayersPicker basemap={basemap} onBasemap={selectBasemap} hasKey={hasMapKey} hasImage={Boolean(raster.overlay)} modes={raster.modes} visualization={raster.visualization} onVisualization={raster.select} opacity={opacity} onOpacity={setOpacity} imageLoading={raster.loading} imageError={raster.error} retryImage={raster.retry} showRaster={showRaster} onRaster={setShowRaster} showPolygons={showPolygons} onPolygons={setShowPolygons} acquisitionDate={date}/>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <MapToolButton label="Baixar arquivos" aria-busy={Boolean(downloading)}>
                      {downloading ? (<LoaderCircle size={17} className={"animate-spin"}/>) : (<Download size={17}/>)}
                    </MapToolButton>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content className={"w-[min(330px,calc(100vw-84px))] min-w-0"} side="left" align="start" sideOffset={8} collisionPadding={12} data-testid="download-menu">
                      {FILES.map((file) => (<DropdownMenu.Item  key={file.kind} disabled={Boolean(downloading)} onSelect={() => void download(file.kind)}>
                          {file.kind === "geojson" || file.kind === "result" ? (<FileJson size={16}/>) : (<FileImage size={16}/>)}
                          <span>{file.label}</span>
                          <span >{file.extension}</span>
                        </DropdownMenu.Item>))}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
            </div>
            {inspectorOpen && (<aside ref={panel} className={"absolute inset-y-0 right-0 z-[1000] flex h-full w-[340px] min-h-0 min-w-0 flex-col overflow-hidden border-l border-solid border-[#404045] bg-[#1d1d20] animate-in fade-in-0 slide-in-from-right-[24px] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:animate-none max-[899px]:inset-0 max-[899px]:w-full max-[899px]:border-0"} id="analysis-inspector" aria-label="Painel da análise" onKeyDown={(event) => {
                    if (event.key === "Escape" &&
                        !event.defaultPrevented &&
                        !document.querySelector('[role="dialog"], [role="menu"]')) {
                        event.preventDefault();
                        closeInspector();
                    }
                }} data-testid="result-inspector">
                <Tabs.Root value={inspectorTab} onValueChange={(value) => setInspectorTab(value as InspectorTab)} className={"flex size-full min-h-0 flex-col"}>
                  <div className={"flex min-h-[46px] items-center justify-between gap-[8px] border-b border-solid border-border pl-[15px] pr-[9px]"}>
                    <Tabs.List className={"flex min-w-0 self-stretch gap-[18px]"} aria-label="Painel da análise">
                      <Tabs.Trigger value="information" className={"inline-flex items-center justify-center gap-[7px] rounded-none border-0 border-b-2 border-solid border-transparent bg-transparent px-px py-0 text-[12px] text-muted-foreground data-[state=active]:border-foreground data-[state=active]:text-foreground pointer-coarse:min-h-[44px]"}>
                        Informações
                      </Tabs.Trigger>
                      <Tabs.Trigger value="chat" className={"inline-flex items-center justify-center gap-[7px] rounded-none border-0 border-b-2 border-solid border-transparent bg-transparent px-px py-0 text-[12px] text-muted-foreground data-[state=active]:border-foreground data-[state=active]:text-foreground pointer-coarse:min-h-[44px]"}>
                        Assistente
                      </Tabs.Trigger>
                    </Tabs.List>
                    <IconButton  aria-label="Fechar painel" onClick={closeInspector}>
                      <X size={17}/>
                    </IconButton>
                  </div>
                  <Tabs.Content value="information" className={"min-h-0 flex-1 overflow-y-auto"} aria-label="Informações">
                    <ResultInformation result={data.result} geojson={data.geojson} selected={selected} onSelect={focusCandidate} />
                  </Tabs.Content>
                  <AnalysisChat id={id} previewError={previewError} previewRevision={previewRevision} setPreviewError={setPreviewError} setPreviewRevision={setPreviewRevision} closeInspector={closeInspector} messages={messages} question={question} setQuestion={setQuestion} chatLoading={chatLoading} questionInput={questionInput} chatEnd={chatEnd} sendQuestion={sendQuestion} />
                </Tabs.Root>
              </aside>)}
          </>)}
      </main>
    </>);
}

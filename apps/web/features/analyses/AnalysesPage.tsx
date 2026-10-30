"use client";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ChevronRight, FolderClosed, LoaderCircle, RefreshCw, Search, X, } from "lucide-react";
import { requestJSON, isAborted } from "@/lib/client-api";
import type { AnalysisStatus, HistoryItem } from "./types";
import { analysisTitle, formatDate, sceneDate, STATUS_LABELS, } from "./types";
import { usePlatform } from "@/features/shell/PlatformShell";
import PageHeader from "@/features/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, } from "@/components/ui/table";
export function AnalysisStatusLabel({ status, }: {
    status: AnalysisStatus | "all";
}) {
    return (<span className={cn("inline-flex items-center gap-[7px] whitespace-nowrap text-[12px] max-[760px]:gap-[6px] max-[760px]:whitespace-normal", status === "error" && "text-[var(--error)]")}>
      <span className={"size-[6px] shrink-0 rounded-full bg-[#97979e] data-[status=ready]:bg-[#a6c889] data-[status=processing]:bg-[#d3bc81] data-[status=error]:bg-[var(--error)]"} aria-hidden="true" data-testid="status-dot" data-status={status}/>
      {status === "all" ? "Todos os status" : STATUS_LABELS[status]}
    </span>);
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
        }
        catch (caught) {
            if (!isAborted(caught))
                setError("Não foi possível carregar as análises.");
        }
        finally {
            if (!signal?.aborted)
                setLoading(false);
        }
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);
    useEffect(() => {
        if (!items.some((item) => ["processing", "uploading"].includes(item.status)))
            return;
        const controller = new AbortController();
        const timer = setInterval(() => void load(controller.signal), 15000);
        return () => {
            clearInterval(timer);
            controller.abort();
        };
    }, [items, load]);
    const filtered = useMemo(() => items
        .filter((item) => (status === "all" || item.status === status) &&
        `${analysisTitle(item.id)} ${item.scene ? "Sentinel-2 exemplo" : "GeoTIFF upload"} ${sceneDate(item.scene, item.date) ?? ""} ${formatDate(sceneDate(item.scene, item.date))}`
            .toLocaleLowerCase("pt-BR")
            .includes(search.trim().toLocaleLowerCase("pt-BR")))
        .sort((a, b) => ascending ? a.created - b.created : b.created - a.created), [items, search, status, ascending]);
    return (<>
      <PageHeader title="Análises"/>
      <main className={"w-full overflow-auto px-[24px] py-[24px] max-[760px]:px-[16px] max-[760px]:py-[20px]"} id="main-content" data-testid="collection-page">
        <div className={"mb-[20px] flex items-center gap-[8px] max-[760px]:mb-[16px] max-[760px]:flex-wrap max-[760px]:gap-[10px]"} data-testid="collection-toolbar">
          <div className={"relative w-[300px] max-w-full max-[760px]:w-full max-[760px]:basis-full"} data-testid="collection-search">
            <Search size={16} className={"pointer-events-none absolute left-[11px] top-[9px] text-[var(--subtle)] pointer-coarse:top-[12px]"}/>
            <Input aria-label="Buscar análises" placeholder="Buscar análises…" value={search} onChange={(event) => setSearch(event.target.value)} className={"h-[34px] bg-[var(--surface)] px-[34px] text-[13px] pointer-coarse:h-[40px] pointer-coarse:text-[16px]"}/>
            {search && (<Button variant="ghost" size="icon-sm" className={"absolute right-[3px] top-[3px] size-[28px] p-0 pointer-coarse:top-[6px]"} aria-label="Limpar busca" onClick={() => setSearch("")}>
                <X size={14}/>
              </Button>)}
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className={"h-[34px] w-[176px] text-[13px] leading-[20px] max-[760px]:max-w-none pointer-coarse:h-[40px]"} aria-label="Filtrar por status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start" sideOffset={4}>
              <SelectItem value="all" textValue="Todos os status">
                <AnalysisStatusLabel status="all"/>
              </SelectItem>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (<SelectItem key={value} value={value} textValue={label}>
                  <AnalysisStatusLabel status={value as AnalysisStatus}/>
                </SelectItem>))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon-sm" className={"ml-auto size-[34px] pointer-coarse:h-[40px]"} aria-label="Atualizar análises" title="Atualizar análises" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={16} className={cn(loading && "animate-spin")}/>
          </Button>
        </div>
        {error && (<div className={"mb-[18px] flex items-center justify-between gap-[14px] rounded-[5px] border border-solid border-[#64403d] p-[12px] text-[13px] text-[var(--error)]"} role="alert">
            <span>{error}</span>
            <Button variant="ghost"  onClick={() => void load()}>
              Tentar novamente
            </Button>
          </div>)}
        <div className={"border-t border-solid border-border"} aria-busy={loading} data-testid="analysis-table-wrap">
          <Table className={"w-full table-auto border-collapse text-left"} data-testid="analysis-table">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Imagem</TableHead>
                <TableHead scope="col" className={"max-[760px]:hidden"}>
                  Aquisição
                </TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col" className={"max-[1100px]:hidden"}>
                  <Button variant="native" className={"ml-auto flex items-center gap-[6px] border-0 bg-transparent p-0 text-inherit [font:inherit]"} onClick={() => setAscending((value) => !value)} aria-label={ascending
            ? "Mais recentes primeiro"
            : "Mais antigas primeiro"}>
                    Criada em{" "}
                    <ArrowDown size={13} />
                  </Button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => (<TableRow key={item.id} data-testid="analysis-row">
                  <TableCell>
                    <Link className={"flex w-fit min-w-0 items-center gap-0"} data-testid="analysis-link" href={`/analyses/${item.id}`} aria-label={`Abrir análise ${item.id}`}>
                      <span className={"flex flex-col gap-[4px]"}>
                        <strong className={"text-[13px] font-medium text-foreground max-[760px]:text-[12px]"}>{analysisTitle(item.id)}</strong>
                        <span className={"text-[12px] text-[var(--subtle)]"}>
                          {item.scene
                ? "Sentinel-2 · Exemplo"
                : "GeoTIFF · Upload"}
                        </span>
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className={"max-[760px]:hidden"}>
                    {formatDate(sceneDate(item.scene, item.date))}
                  </TableCell>
                  <TableCell>
                    <AnalysisStatusLabel status={item.status}/>
                  </TableCell>
                  <TableCell className={"max-[1100px]:hidden"}>
                    {createdDate(item.created)}
                  </TableCell>
                </TableRow>))}
            </TableBody>
          </Table>
          {loading && items.length === 0 ? (<div className={"flex min-h-[270px] flex-col items-center justify-center gap-[13px] px-[16px] py-[36px] text-center"} role="status">
              <LoaderCircle size={22} className={cn(loading && "animate-spin")}/>
              <p className={"text-[13px] leading-[1.6] text-muted-foreground"}>Carregando análises…</p>
            </div>) : (!error &&
            filtered.length === 0 && (<div className={"flex min-h-[270px] flex-col items-center justify-center gap-[13px] px-[16px] py-[36px] text-center"}>
                <FolderClosed size={28} strokeWidth={1.4}/>
                <h2 className={"text-[15px] font-medium"}>
                  {items.length
                ? "Nenhuma análise encontrada"
                : "Suas análises ficam aqui"}
                </h2>
                <p className={"text-[13px] leading-[1.6] text-muted-foreground"}>
                  {items.length
                ? "Tente outro termo ou altere o filtro."
                : "Envie uma imagem ou escolha um exemplo para começar."}
                </p>
                {items.length ? (<Button variant="outline" className={"mt-[6px]"} onClick={() => {
                    setSearch("");
                    setStatus("all");
                }}>
                    Limpar filtros
                  </Button>) : (<Button variant="outline" className={"mt-[6px]"} onClick={newAnalysis}>
                    Criar primeira análise <ChevronRight size={15}/>
                  </Button>)}
              </div>))}
        </div>
        {!error && (!loading || items.length > 0) && (<p className={"px-0 py-[16px] text-[12px] text-[var(--subtle)]"} role="status" aria-live="polite" data-testid="collection-caption">
            {search.trim() || status !== "all"
                ? `${filtered.length} de ${items.length} ${items.length === 1 ? "análise" : "análises"}`
                : `${items.length} ${items.length === 1 ? "análise" : "análises"}`}
          </p>)}
      </main>
    </>);
}

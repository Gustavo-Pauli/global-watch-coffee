"use client";

import { useMemo, useState } from "react";
import type { FeatureCollection } from "geojson";
import { ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatNumber, type AnalysisResult } from "@/features/analyses/types";
import AboutResult from "./AboutResult";
import { candidates } from "./candidates";

type Props = {
  result: AnalysisResult;
  geojson: FeatureCollection;
  selected: number | null;
  onSelect: (id: number) => void;
};
const PAGE_SIZE = 50;

export default function ResultInformation({ result, geojson, selected, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [order, setOrder] = useState("area-desc");
  const [page, setPage] = useState(0);
  const rows = useMemo(() => candidates(geojson).filter(item =>
    String(item.id).includes(search.trim()),
  ).sort((a, b) => order === "id" ? a.id - b.id : order === "area-asc" ? a.area - b.area : b.area - a.area),
  [geojson, search, order]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);

  return <div className="px-[18px] pb-[18px] pt-[6px]">
    <dl className="border-b border-solid border-[var(--line-soft)] pb-[12px] pt-[7px]">
      <div className="flex flex-col items-baseline gap-[8px] pb-[22px] pt-[12px] text-[12px]">
        <dt className="text-muted-foreground">Área estimada</dt>
        <dd className="text-[27px] font-medium tabular-nums tracking-[-0.8px]">
          {formatNumber(result.candidate_area_ha)} <span className="text-[15px] font-normal tracking-normal text-muted-foreground">ha</span>
        </dd>
      </div>
      <div className="flex items-baseline justify-between gap-[16px] py-[12px] text-[12px]">
        <dt className="text-muted-foreground">Polígonos identificados</dt>
        <dd className="font-medium tabular-nums">{formatNumber(result.candidate_polygon_count, 0)}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-[16px] py-[12px] text-[12px]">
        <dt className="text-muted-foreground">NDVI mediano</dt>
        <dd className="font-medium tabular-nums">{result.ndvi_median == null ? "—" : formatNumber(result.ndvi_median, 3)}</dd>
      </div>
    </dl>
    {result.candidate_polygon_count === 0 ? <p className="mt-[17px] text-[12px] leading-[1.65] text-muted-foreground">
      Nenhuma área candidata foi identificada nesta imagem.
    </p> : <section className="border-b border-solid border-[var(--line-soft)] py-[6px]" aria-label="Polígonos">
      <Button variant="native" className="flex min-h-[42px] w-full items-center justify-between gap-[10px] bg-transparent text-left text-[12px]" aria-expanded={open} aria-controls="candidate-list" onClick={() => setOpen(value => !value)}>
        Explorar polígonos
        <ChevronDown size={15} className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </Button>
      {open && <div id="candidate-list" className="pb-[8px]" data-testid="candidate-list">
        <div className="mb-[10px] flex gap-[7px]">
          <div className="relative min-w-0 flex-1">
            <Search size={13} className="pointer-events-none absolute left-[10px] top-[10px] text-muted-foreground" />
            <Input aria-label="Buscar polígono por número" placeholder="Número" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} className="h-[33px] w-full pl-[29px] text-[12px]" />
          </div>
          <Select value={order} onValueChange={value => { setOrder(value); setPage(0); }}>
            <SelectTrigger className="h-[33px] text-[12px]" aria-label="Ordenar polígonos"><SelectValue /></SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="area-desc">Maior área</SelectItem>
              <SelectItem value="area-asc">Menor área</SelectItem>
              <SelectItem value="id">Número</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {rows.length ? <ul className="m-0 list-none p-0">
          {rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(item => <li key={item.id}>
            <Button variant="native" aria-pressed={selected === item.id} className={cn("flex min-h-[40px] w-full items-center justify-between gap-[12px] rounded-[4px] border-0 px-[9px] py-[8px] text-left text-[12px] hover:bg-accent", selected === item.id ? "bg-accent text-foreground" : "bg-transparent text-muted-foreground")} onClick={() => onSelect(item.id)} data-testid="candidate-row" data-candidate-id={item.id}>
              <span>Polígono {item.id}</span>
              <span className="tabular-nums text-foreground">{formatNumber(item.area)} <span className="text-muted-foreground">ha</span></span>
            </Button>
          </li>)}
        </ul> : <p className="py-[12px] text-[12px] text-muted-foreground">Nenhum polígono encontrado.</p>}
        {pages > 1 && <div className="mt-[8px] flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, rows.length)} de {rows.length}</span>
          <div className="flex gap-[2px]">
            <IconButton aria-label="Polígonos anteriores" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={15} /></IconButton>
            <IconButton aria-label="Próximos polígonos" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}><ChevronRight size={15} /></IconButton>
          </div>
        </div>}
      </div>}
    </section>}
    <AboutResult result={result} />
  </div>;
}

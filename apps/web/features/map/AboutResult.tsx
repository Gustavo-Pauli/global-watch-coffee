"use client";

import type { ReactNode } from "react";
import { CircleHelp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import * as Dialog from "@/components/ui/dialog";
import { resultExtensions } from "@/lib/analysis-artifacts";
import { formatNumber, type AnalysisResult } from "@/features/analyses/types";

function DataRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-start justify-between gap-[16px] py-[7px] text-[12px] leading-[1.5]">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="max-w-[65%] text-right tabular-nums [overflow-wrap:anywhere]">{children}</dd>
  </div>;
}

const detailClass = "mt-[18px] border-t border-solid border-border";
const summaryClass = "cursor-pointer pb-[9px] pt-[14px] text-[12px] text-muted-foreground";

export default function AboutResult({ result }: { result: AnalysisResult }) {
  const extensions = resultExtensions(result);
  const quality = extensions?.quality;
  const provenance = extensions?.provenance;

  return <Dialog.Root>
    <Dialog.Trigger asChild>
      <Button className="mt-[17px] inline-flex items-center gap-[7px] text-[12px] text-muted-foreground hover:text-foreground" variant="native">
        <CircleHelp size={15} />Sobre o resultado
      </Button>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay />
      <Dialog.Content className="w-[min(510px,calc(100vw-24px))]">
        <div className="relative mb-[24px] pr-[26px]">
          <Dialog.Title>Sobre o resultado</Dialog.Title>
          <Dialog.Description className="sr-only">Método, qualidade da imagem e origem dos dados.</Dialog.Description>
          <Dialog.Close asChild><IconButton className="absolute -right-[9px] -top-[6px]" aria-label="Fechar explicação"><X size={18} /></IconButton></Dialog.Close>
        </div>
        <h3 className="mb-[9px] text-[13px] font-medium">Classificação</h3>
        <p className="mb-[16px] text-[13px] leading-[1.75] text-muted-foreground">
          {result.method === "rf_purified_multiclass_2.0" ? "Random Forest com referência de uso do solo MapBiomas." : result.method}
        </p>
        <p className="mb-[16px] text-[13px] leading-[1.75] text-muted-foreground">{result.limitations}</p>
        <h3 className="mb-[9px] text-[13px] font-medium">NDVI</h3>
        <p className="text-[13px] leading-[1.75] text-muted-foreground">
          A mediana resume os pixels válidos da imagem. O NDVI médio de cada polígono, quando disponível, considera apenas sua área. O índice de vegetação sozinho não comprova a presença de café.
        </p>
        {quality && <details className={detailClass}>
          <summary className={summaryClass}>Qualidade da imagem</summary>
          <p className="mb-[8px] text-[12px] leading-[1.6] text-muted-foreground">
            {formatNumber(quality.eligible_percent, 1)}% dos pixels foram elegíveis para a classificação.
          </p>
          <dl>
            <DataRow label="Pixels da imagem">{formatNumber(quality.total_pixels, 0)}</DataRow>
            <DataRow label="Pixels elegíveis">{formatNumber(quality.eligible_pixels, 0)}</DataRow>
            <DataRow label="Inválidos na entrada">{formatNumber(quality.input_invalid_pixels, 0)}</DataRow>
            <DataRow label="Excluídos pela SCL">{quality.scl_applied ? formatNumber(quality.scl_excluded_pixels!, 0) : "SCL não enviada"}</DataRow>
            <DataRow label="Com NDVI definido">{formatNumber(quality.ndvi_defined_pixels, 0)}</DataRow>
          </dl>
          <p className="mt-[9px] text-[11px] leading-[1.6] text-muted-foreground">A máscara SCL pode excluir nuvens, sombras e outras classes. Esses números descrevem a cena, não a precisão do modelo.</p>
        </details>}
        <details className={detailClass}>
          <summary className={summaryClass}>Dados técnicos e proveniência</summary>
          <dl>
            <DataRow label="Método">{result.method}</DataRow>
            <DataRow label="Pixels válidos">{formatNumber(result.valid_pixels, 0)}</DataRow>
            {provenance && <>
              <DataRow label="CRS">{provenance.crs}</DataRow>
              <DataRow label="Resolução">{formatNumber(provenance.resolution.x)} × {formatNumber(provenance.resolution.y)} {provenance.resolution.unit}</DataRow>
              <DataRow label="Bandas">{provenance.bands.join(", ")}</DataRow>
              <DataRow label="Origem da data">{{ sample_metadata: "Metadados da amostra", user_supplied: "Informada no envio", unknown: "Não informada" }[provenance.date_source]}</DataRow>
              <DataRow label="Limiar do modelo">{formatNumber(provenance.parameters.threshold, 2)}</DataRow>
              <DataRow label="Área mínima">{formatNumber(provenance.parameters.min_area_ha)} ha</DataRow>
              <DataRow label="Coerência espacial">{provenance.parameters.coherence ? "Aplicada" : "Não aplicada"}</DataRow>
              <DataRow label="Cálculo de área">Geodésico · WGS84</DataRow>
            </>}
          </dl>
          {provenance && <details className="mt-[12px]">
            <summary className="cursor-pointer py-[7px] text-[12px] text-muted-foreground">Identificadores SHA-256</summary>
            <dl>
              <DataRow label="Análise">{provenance.analysis_fingerprint}</DataRow>
              <DataRow label="Imagem">{provenance.input_sha256}</DataRow>
              {provenance.scl_sha256 && <DataRow label="SCL">{provenance.scl_sha256}</DataRow>}
              <DataRow label="Modelo">{provenance.model_sha256}</DataRow>
            </dl>
          </details>}
        </details>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

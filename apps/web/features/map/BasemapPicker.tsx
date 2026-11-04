"use client";

import * as RadioGroup from "radix-ui/radio-group";
import { cn } from "@/lib/utils";
import { BASEMAPS, sourceTimeLabel, type BasemapId } from "./sources";

export default function BasemapPicker({ value, onChange, hasKey }: {
  value: BasemapId; onChange: (value: BasemapId) => void; hasKey: boolean;
}) {
  return <>
    <h3 className="mb-[10px] text-[12px] font-normal text-muted-foreground">Mapa de fundo</h3>
    <RadioGroup.Root value={value} onValueChange={next => onChange(next as BasemapId)} aria-label="Mapa de fundo" className="flex flex-col gap-[7px]">
      {BASEMAPS.map(item => <label className="flex min-w-0 cursor-pointer items-center gap-[10px] rounded-[5px] border border-solid border-[#3a3a40] px-[9px] py-[9px] hover:bg-[#2d2d32] has-[[data-state=checked]]:border-[#787883] has-[[data-state=checked]]:bg-[#303035] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 pointer-coarse:min-h-[62px]" key={item.id} data-disabled={item.id !== "none" && !hasKey ? "" : undefined}>
        <RadioGroup.Item className="size-[15px] shrink-0 rounded-full border border-solid border-[#8e8e99] bg-transparent p-[3px]" value={item.id} disabled={item.id !== "none" && !hasKey} aria-label={item.title}>
          <RadioGroup.Indicator className="block size-[7px] rounded-full bg-[var(--accent)]" />
        </RadioGroup.Item>
        <span className={cn("relative h-[34px] w-[32px] shrink-0 overflow-hidden rounded-[3px] border border-solid border-[#56565d]", item.id === "satellite" ? "bg-[#3f4d32] before:absolute before:left-[4px] before:top-[8px] before:h-[36px] before:w-[16px] before:rotate-[33deg] before:bg-[#837454] before:content-['']" : item.id === "streets" ? "bg-[#c5c4bb] before:absolute before:-left-[8px] before:top-[14px] before:h-[4px] before:w-[55px] before:-rotate-[35deg] before:bg-[#efefe8] before:content-[''] after:absolute after:-left-[8px] after:top-[14px] after:h-[4px] after:w-[55px] after:rotate-[70deg] after:bg-[#efefe8] after:content-['']" : "border-dashed bg-[#24262a]")} aria-hidden="true" />
        <span className="flex min-w-0 flex-col gap-[5px]"><strong className="text-[13px] font-medium">{item.title}</strong>{item.id !== "none" && <span className="text-[12px] leading-[1.45] text-muted-foreground">{sourceTimeLabel(item.time)}</span>}</span>
      </label>)}
    </RadioGroup.Root>
    {!hasKey && <p className="mt-[10px] text-[12px] leading-[1.6] text-[var(--error)]">Mapa de referência indisponível neste ambiente.</p>}
  </>;
}

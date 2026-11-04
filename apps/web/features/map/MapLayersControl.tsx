"use client";

import type { ReactNode } from "react";
import * as Popover from "radix-ui/popover";
import { Layers, X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import MapToolButton from "./MapToolButton";

/** Shared map chrome; layer-specific controls are supplied by the adapter. */
export default function MapLayersControl({ children }: { children: ReactNode }) {
  return <Popover.Root>
    <Popover.Trigger asChild><MapToolButton label="Camadas"><Layers size={17} /></MapToolButton></Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="z-[2500] max-h-[calc(100dvh-145px)] w-[min(340px,calc(100vw-84px))] overflow-y-auto rounded-[8px] border border-solid border-[#45454c] bg-[#222225] px-[16px] pb-[12px] pt-[15px] shadow-[0_8px_25px_#0005] max-[760px]:max-h-[calc(100dvh-160px)]" sideOffset={9} side="left" align="start" collisionPadding={12} aria-label="Camadas" data-testid="layer-picker">
        <div className="-mr-[5px] -mt-[3px] mb-[12px] ml-0 flex items-center justify-between gap-[16px]">
          <h2 className="text-[14px] font-medium">Camadas</h2>
          <Popover.Close asChild><IconButton aria-label="Fechar camadas" hitArea="popup"><X size={17} /></IconButton></Popover.Close>
        </div>
        {children}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}

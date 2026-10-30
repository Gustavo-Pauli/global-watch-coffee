"use client";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NavigationToggle, usePlatform } from "./PlatformShell";
export default function PageHeader({ title, meta, fullWidth = false, }: {
    title: string;
    meta?: ReactNode;
    fullWidth?: boolean;
}) {
    const { newAnalysis } = usePlatform();
    return (<header className={"h-[48px] min-h-[48px] border-b border-solid border-[var(--line-soft)] bg-[#18181a] p-0 text-[12px] text-muted-foreground"} data-testid="page-header">
      <div className={cn("flex h-full w-full min-w-0 items-center gap-[12px] max-[760px]:gap-[8px]", fullWidth ? "px-[14px] max-[760px]:px-[12px]" : "px-[24px] max-[760px]:px-[16px]")} data-testid="header-inner">
        <NavigationToggle />
        <div className={"flex min-w-0 items-center gap-[14px] max-[760px]:flex-col max-[760px]:items-start max-[760px]:justify-center max-[760px]:gap-[2px]"}>
          <div className={"flex min-w-0 items-center gap-[10px]"}>
            <h1 title={title} className={"truncate text-[13px] font-medium tracking-[-0.3px] text-foreground"}>{title}</h1>
          </div>
          {meta && <div className={"shrink-0 text-[13px] font-medium leading-[20px] tracking-normal text-muted-foreground"}>{meta}</div>}
        </div>
        <Button size="sm" className={"ml-auto h-[32px] min-h-[32px] shrink-0 gap-[6px] px-[10px] py-[5px] text-[13px] font-medium leading-[20px] tracking-normal max-[760px]:px-[9px] max-[760px]:py-[6px]"} onClick={newAnalysis}>
          <Plus size={16}/>
          <span>Nova análise</span>
        </Button>
      </div>
    </header>);
}

"use client";
import { forwardRef, useState, type ComponentProps } from "react";
import * as Tooltip from "radix-ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
type Props = ComponentProps<typeof Button> & {
    label: string;
};
const MapToolButton = forwardRef<HTMLButtonElement, Props>(({ label, className, children, ...props }, ref) => {
    const [open, setOpen] = useState(false);
    const expanded = props["aria-expanded"] === true || props["aria-expanded"] === "true";
    return <Tooltip.Root open={open && !expanded} onOpenChange={setOpen}>
      <Tooltip.Trigger asChild>
        <Button ref={ref} variant="native" size="icon" className={cn("flex size-[36px] min-h-[36px] min-w-[36px] items-center justify-center rounded-none border-0 border-b border-solid border-[#424246] bg-transparent p-0 font-sans text-[13px] leading-[20px] text-foreground shadow-none first:rounded-t-[5px] last:rounded-b-[5px] last:border-b-0 only:rounded-[5px] hover:enabled:bg-[#39393e] data-[state=open]:bg-[#39393e] pointer-coarse:size-[40px] pointer-coarse:min-h-[40px] pointer-coarse:min-w-[40px] [&>svg]:size-[18px]", className)} {...props} aria-label={label}>
          {children}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className={"z-[3600] max-w-[240px] rounded-[5px] border border-solid border-border bg-[#242426] px-[10px] py-[7px] text-[12px] leading-[1.4] text-foreground shadow-[0_3px_12px_#0003]"} side="left" sideOffset={8} collisionPadding={12} data-testid="map-tool-tooltip">
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>;
});
MapToolButton.displayName = "MapToolButton";
export default MapToolButton;

export const mapControlGroupClass = "flex w-max flex-col items-stretch gap-0 overflow-visible rounded-[6px] border border-solid border-[#424246] bg-[#202023] p-0 shadow-[0_3px_12px_#0003]";

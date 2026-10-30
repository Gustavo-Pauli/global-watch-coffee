"use client";

import { forwardRef, useState, type ComponentProps } from "react";
import * as Tooltip from "radix-ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = ComponentProps<typeof Button> & { label: string };

const MapToolButton = forwardRef<HTMLButtonElement, Props>(
  ({ label, className, children, ...props }, ref) => {
    const [open, setOpen] = useState(false);
    const expanded = props["aria-expanded"] === true || props["aria-expanded"] === "true";
    return <Tooltip.Root open={open && !expanded} onOpenChange={setOpen}>
      <Tooltip.Trigger asChild>
        <Button
          ref={ref}
          variant="ghost"
          size="icon"
          className={cn(
            "tool-button map-tool-button map-control-button",
            className,
          )}
          {...props}
          aria-label={label}
        >
          {children}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="map-tool-tooltip"
          side="left"
          sideOffset={8}
          collisionPadding={12}
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>;
  },
);
MapToolButton.displayName = "MapToolButton";

export default MapToolButton;

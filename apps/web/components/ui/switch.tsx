"use client";
import { forwardRef, type ComponentProps, type ComponentRef } from "react";
import * as Primitive from "radix-ui/switch";
import { cn } from "@/lib/utils";

export const Root = forwardRef<ComponentRef<typeof Primitive.Root>, ComponentProps<typeof Primitive.Root>>(({ className, ...props }, ref) => <Primitive.Root ref={ref} className={cn("h-[17px] w-[29px] shrink-0 rounded-[10px] border-0 bg-[#505057] p-[2px] data-[state=checked]:bg-[var(--accent)] pointer-coarse:h-[21px] pointer-coarse:w-[34px]", className)} {...props} />);
export const Thumb = forwardRef<ComponentRef<typeof Primitive.Thumb>, ComponentProps<typeof Primitive.Thumb>>(({ className, ...props }, ref) => <Primitive.Thumb ref={ref} className={cn("block size-[13px] rounded-full bg-[#ececef] transition-transform duration-[120ms] data-[state=checked]:translate-x-[12px] data-[state=checked]:bg-[#26341c] pointer-coarse:size-[17px] pointer-coarse:data-[state=checked]:translate-x-[13px]", className)} {...props} />);
Root.displayName = "Switch";
Thumb.displayName = "SwitchThumb";

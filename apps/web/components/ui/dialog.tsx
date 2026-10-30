"use client";
import { forwardRef, type ComponentProps, type ComponentRef } from "react";
import * as Primitive from "radix-ui/dialog";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const contentVariants = cva("fixed z-[3100]", { variants: { appearance: {
  default: "left-1/2 top-1/2 max-h-[calc(100dvh-48px)] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[10px] border border-solid border-[#3a3a3e] bg-[#1e1e20] p-[25px] shadow-[0_20px_80px_#0005] max-[760px]:max-h-[calc(100dvh-32px)] max-[760px]:w-[calc(100vw-24px)] max-[760px]:p-[22px]",
  sheet: "inset-y-0 left-0 flex w-[min(288px,calc(100vw-48px))] flex-col border-r border-solid border-border bg-[#171718]",
} }, defaultVariants: { appearance: "default" } });

export const Root = Primitive.Root;
export const Portal = Primitive.Portal;
export const Trigger = Primitive.Trigger;
export const Close = Primitive.Close;
export const Overlay = forwardRef<ComponentRef<typeof Primitive.Overlay>, ComponentProps<typeof Primitive.Overlay>>(({ className, ...props }, ref) => <Primitive.Overlay ref={ref} className={cn("fixed inset-0 z-[3000] bg-[#0009] animate-in fade-in-0 duration-[120ms] ease-out", className)} {...props} />);
export const Content = forwardRef<ComponentRef<typeof Primitive.Content>, ComponentProps<typeof Primitive.Content> & { appearance?: "default" | "sheet" }>(({ className, appearance, ...props }, ref) => <Primitive.Content ref={ref} className={cn(contentVariants({ appearance }), className)} {...props} />);
export const Title = forwardRef<ComponentRef<typeof Primitive.Title>, ComponentProps<typeof Primitive.Title>>(({ className, ...props }, ref) => <Primitive.Title ref={ref} className={cn("text-[18px] font-semibold leading-[1.4] tracking-[-0.4px]", className)} {...props} />);
export const Description = forwardRef<ComponentRef<typeof Primitive.Description>, ComponentProps<typeof Primitive.Description>>(({ className, ...props }, ref) => <Primitive.Description ref={ref} className={cn("mt-[7px] text-[13px] leading-[1.6] text-muted-foreground", className)} {...props} />);
Overlay.displayName = "DialogOverlay";
Content.displayName = "DialogContent";
Title.displayName = "DialogTitle";
Description.displayName = "DialogDescription";

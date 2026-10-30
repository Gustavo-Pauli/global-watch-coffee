"use client";
import { forwardRef, type ComponentProps, type ComponentRef } from "react";
import * as Primitive from "radix-ui/dropdown-menu";
import { cn } from "@/lib/utils";

export const Root = Primitive.Root;
export const Trigger = Primitive.Trigger;
export const Portal = Primitive.Portal;
export const Content = forwardRef<ComponentRef<typeof Primitive.Content>, ComponentProps<typeof Primitive.Content>>(({ className, ...props }, ref) => <Primitive.Content ref={ref} className={cn("z-[3500] min-w-[224px] max-w-[min(360px,calc(100vw-24px))] rounded-[7px] border border-solid border-[#3b3b3f] bg-popover p-[5px] text-popover-foreground shadow-[0_8px_28px_#0005] animate-in fade-in-0 slide-in-from-top-[3px] duration-[120ms] ease-out max-[760px]:max-w-[calc(100vw-24px)]", className)} {...props} />);
export const Item = forwardRef<ComponentRef<typeof Primitive.Item>, ComponentProps<typeof Primitive.Item>>(({ className, ...props }, ref) => <Primitive.Item ref={ref} className={cn("flex min-h-[35px] cursor-pointer select-none items-center gap-[9px] rounded-[4px] px-[9px] py-[8px] text-[13px] outline-none data-[highlighted]:bg-[#363639] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 pointer-coarse:min-h-[42px] [&>svg]:text-muted-foreground", className)} {...props} />);
export const Label = forwardRef<ComponentRef<typeof Primitive.Label>, ComponentProps<typeof Primitive.Label>>(({ className, ...props }, ref) => <Primitive.Label ref={ref} className={cn("px-[9px] py-[8px] text-[12px] text-muted-foreground [overflow-wrap:anywhere]", className)} {...props} />);
export const Separator = forwardRef<ComponentRef<typeof Primitive.Separator>, ComponentProps<typeof Primitive.Separator>>(({ className, ...props }, ref) => <Primitive.Separator ref={ref} className={cn("-mx-px my-[4px] h-px bg-border", className)} {...props} />);
Content.displayName = "DropdownMenuContent";
Item.displayName = "DropdownMenuItem";
Label.displayName = "DropdownMenuLabel";
Separator.displayName = "DropdownMenuSeparator";

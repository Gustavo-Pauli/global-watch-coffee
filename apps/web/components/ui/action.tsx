import { forwardRef, type ComponentProps } from "react";
import { cva } from "class-variance-authority";
import { Button } from "./button";
import { cn } from "@/lib/utils";

export const actionButtonVariants = cva(
  "inline-flex min-h-[36px] items-center justify-center gap-[8px] whitespace-nowrap rounded-[6px] border border-solid px-[13px] py-[8px] text-[13px] font-medium leading-[20px] tracking-normal",
  { variants: { appearance: {
    primary: "border-primary bg-primary text-primary-foreground hover:enabled:border-white hover:enabled:bg-white",
    secondary: "border-border bg-[var(--surface)] hover:enabled:border-[#4d4d51] hover:enabled:bg-accent",
    neutral: "border-border bg-secondary hover:enabled:border-[#4d4d51] hover:enabled:bg-accent",
  } }, defaultVariants: { appearance: "neutral" } },
);

export const textButtonClass = "border-0 bg-transparent px-0 py-[4px] text-[12px] font-medium text-foreground hover:underline";
export const TextButton = forwardRef<HTMLButtonElement, Omit<ComponentProps<typeof Button>, "variant" | "size">>(
  ({ className, ...props }, ref) => <Button ref={ref} variant="native" className={cn(textButtonClass, className)} {...props} />,
);
TextButton.displayName = "TextButton";

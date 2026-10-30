import { forwardRef, type ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Button } from "./button";
import { cn } from "@/lib/utils";

const iconButtonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-[5px] border-0 bg-transparent p-0 text-muted-foreground hover:enabled:bg-accent hover:enabled:text-foreground",
  {
    variants: {
      hitArea: {
        default: "size-[32px] pointer-coarse:min-h-[42px] pointer-coarse:min-w-[40px]",
        sidebar: "size-[32px] pointer-coarse:size-[44px] pointer-coarse:min-h-[44px] pointer-coarse:min-w-[44px]",
        navigation: "size-[32px] min-w-[32px] pointer-coarse:min-h-[42px]",
        popup: "size-[32px] pointer-coarse:min-h-[36px] pointer-coarse:min-w-[40px]",
      },
    },
    defaultVariants: { hitArea: "default" },
  },
);

type Props = Omit<ComponentProps<typeof Button>, "variant" | "size"> & VariantProps<typeof iconButtonVariants>;
export const IconButton = forwardRef<HTMLButtonElement, Props>(
  ({ className, hitArea, ...props }, ref) => (
    <Button ref={ref} variant="native" className={cn(iconButtonVariants({ hitArea }), className)} {...props} />
  ),
);
IconButton.displayName = "IconButton";

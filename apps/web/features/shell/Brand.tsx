import { cn } from "@/lib/utils";
export default function Brand({className}: {className?: string}) { return <span data-testid="brand" className={cn("inline-flex items-center gap-[10px] text-[14px] font-semibold leading-[1.25] tracking-[-0.3px]",className)}>Global Watch</span>; }

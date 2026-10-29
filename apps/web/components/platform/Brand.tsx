import { Scan } from "lucide-react";

export default function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand${compact ? " brand-compact" : ""}`}>
      <Scan size={25} strokeWidth={1.7} aria-hidden="true" />
      {!compact && (
        <span>
          Global Watch<span className="brand-product">Coffee</span>
        </span>
      )}
    </span>
  );
}

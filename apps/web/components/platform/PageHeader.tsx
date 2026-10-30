"use client";

import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NavigationToggle, usePlatform } from "./PlatformShell";

export default function PageHeader({
  title,
  meta,
  count,
  fullWidth = false,
}: {
  title: string;
  meta?: ReactNode;
  count?: number | string;
  fullWidth?: boolean;
}) {
  const { newAnalysis } = usePlatform();
  return (
    <header
      className="page-topbar platform-page-header"
      data-testid="page-header"
    >
      <div
        className={`page-header-inner ${fullWidth ? "workspace-header-inner" : "page-container"}`}
      >
        <NavigationToggle />
        <div className="header-identity">
          <div className="header-title-row">
            <h1 title={title}>{title}</h1>
            {count !== undefined && (
              <span
                className="record-count"
                role="status"
                aria-live="polite"
                aria-label={`${count} análises`}
              >
                {count}
              </span>
            )}
          </div>
          {meta && <div className="header-meta">{meta}</div>}
        </div>
        <Button size="sm" className="header-new-analysis" onClick={newAnalysis}>
          <Plus size={16} />
          <span>Nova análise</span>
        </Button>
      </div>
    </header>
  );
}

"use client";

import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { NavigationToggle, usePlatform } from "./PlatformShell";

export default function PageHeader({
  title,
  meta,
  count,
}: {
  title: string;
  meta?: ReactNode;
  count?: number;
}) {
  const { newAnalysis } = usePlatform();
  return (
    <header
      className="page-topbar platform-page-header"
      data-testid="page-header"
    >
      <NavigationToggle />
      <div className="header-identity">
        <div className="header-title-row">
          <h1 title={title}>{title}</h1>
          {count !== undefined && (
            <span className="record-count" aria-hidden="true">
              {count}
            </span>
          )}
        </div>
        {meta && <div className="header-meta">{meta}</div>}
      </div>
      <button
        className="button button-primary header-new-analysis"
        onClick={newAnalysis}
      >
        <Plus size={16} />
        <span>Nova análise</span>
      </button>
    </header>
  );
}

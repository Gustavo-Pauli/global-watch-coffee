import type { SourceTime } from "./types";

/** Preserve acquisition provenance without assigning a date to an undated mosaic. */
export function setSourceMetadata(element: Element, source: { id: string; title: string; time?: SourceTime }) {
  element.setAttribute("data-geospatial-layer", source.id);
  element.setAttribute("data-source-title", source.title);
  const fields = {
    "data-source-time-kind": source.time?.kind,
    "data-source-date": source.time?.kind === "acquisition" ? source.time.date : undefined,
    "data-source-time-label": source.time && source.time.kind !== "acquisition" ? source.time.label : undefined,
  };
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) element.removeAttribute(name); else element.setAttribute(name, value);
  }
}

export function sourceAccessibleLabel(title: string, time?: SourceTime) {
  return time ? `${title} · ${time.kind === "acquisition" ? time.date : time.label}` : title;
}

"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, LockKeyhole, Maximize2, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import * as Dialog from "@/components/ui/dialog";
import { LabRequestError, labJSON } from "./api";
import styles from "./experiments.module.css";

export function LabAccess({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "allowed" | "denied" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    labJSON<{ allowed: boolean }>("/api/experiments/access", { signal: abort.signal })
      .then(data => { if (!abort.signal.aborted) setState(data.allowed ? "allowed" : "denied"); })
      .catch(error => { if (!abort.signal.aborted) setState(error instanceof LabRequestError && [401, 403].includes(error.status) ? "denied" : "error"); });
    return () => abort.abort();
  }, [attempt]);
  if (state === "allowed") return children;
  return <main className={styles.access} id="main-content" data-testid="experiments-access">
    {state === "loading" ? <><span className={styles.loadingDot} aria-hidden="true" /><h1>Carregando experimentação</h1><p>Verificando o acesso ao ambiente interno.</p></> : state === "denied" ? <><LockKeyhole size={25} /><h1>Experimentação é um espaço interno</h1><p>Este ambiente está disponível às contas autorizadas para acompanhar estudos e revisar evidências.</p><Link className={styles.button} href="/analyses"><ArrowLeft size={15} /> Voltar às análises</Link></> : <><h1>Não foi possível verificar o acesso</h1><p>Confira a conexão e tente novamente.</p><button className={styles.button} onClick={() => { setState("loading"); setAttempt(value => value + 1); }}><RefreshCw size={15} /> Tentar novamente</button></>}
  </main>;
}

export function LabImage({ src, alt, className, onFailure, retryable = true }: { src: string; alt: string; className?: string; onFailure?: () => void; retryable?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => { setFailed(false); }, [src]);
  return failed ? <span className={`${styles.imageError} ${className || ""}`} role="status"><span>Imagem indisponível</span>{retryable && <button onClick={() => { setFailed(false); setRetry(value => value + 1); }}>Tentar carregar novamente</button>}</span> : <img key={`${src}:${retry}`} src={src} alt={alt} className={className} loading="lazy" onError={() => { setFailed(true); onFailure?.(); }} />;
}

export function LabZoomImage({ src, alt, title, description }: { src: string; alt: string; title: string; description: string }) {
  return <Dialog.Root>
    <Dialog.Trigger asChild><button type="button" className={styles.imageTrigger} aria-label={`Ampliar imagem: ${title}`}><LabImage src={src} alt={alt} retryable={false} /><span className={styles.imageZoomHint} aria-hidden="true"><Maximize2 size={13} /> Ampliar</span></button></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay />
      <Dialog.Content className={styles.imageDialog} style={{ width: "min(1000px, calc(100vw - 24px))", maxHeight: "calc(100dvh - 24px)", padding: 16 }}>
        <div className={styles.imageDialogHeading}><Dialog.Title>{title}</Dialog.Title><Dialog.Close asChild><button type="button" className={styles.button} aria-label="Fechar imagem ampliada"><X size={17} aria-hidden="true" /><span>Fechar</span></button></Dialog.Close></div>
        <Dialog.Description>{description}</Dialog.Description>
        <LabImage src={src} alt={alt} className={styles.enlargedImage} />
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

export function DiscardDialog({ open, onCancel, onDiscard }: { open: boolean; onCancel: () => void; onDiscard: () => void }) {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const cancel = document.getElementById("lab-keep-editing");
    cancel?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCancel(); }
      if (event.key === "Tab") {
        const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-lab-discard] button'));
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); previous?.focus(); };
  }, [open, onCancel]);
  if (!open) return null;
  return <div className={styles.dialogBackdrop}><section className={styles.dialog} role="alertdialog" aria-modal="true" aria-labelledby="lab-discard-title" aria-describedby="lab-discard-description" data-lab-discard>
    <h2 id="lab-discard-title">Esta revisão tem alterações não salvas</h2><p id="lab-discard-description">Continue editando para salvar sua anotação ou descarte o rascunho para navegar.</p><div className={styles.dialogActions}><button id="lab-keep-editing" className={styles.primaryButton} onClick={onCancel}>Continuar editando</button><button className={styles.button} onClick={onDiscard}>Descartar e continuar</button></div>
  </section></div>;
}

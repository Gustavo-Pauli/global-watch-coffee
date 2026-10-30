"use client";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@/components/ui/dialog";
import { LoaderCircle, X } from "lucide-react";
import AnalysisForm from "./AnalysisForm";
import { requestJSON, requestSignal, errorMessage, isAborted } from "@/lib/client-api";
type SignedUpload = {
    signedUrl: string;
    path: string;
    token: string;
};
async function directUpload(file: File, signature: SignedUpload, signal: AbortSignal) {
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", file, file.name);
    const response = await fetch(signature.signedUrl, {
        method: "PUT",
        headers: { "x-upsert": "false" },
        body: form,
        signal: requestSignal(signal, 120000),
    });
    if (!response.ok)
        throw new Error(`Não foi possível enviar ${file.name}. Tente novamente.`);
}
export default function NewAnalysisDialog({ open, onOpenChange, }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const router = useRouter();
    const [stage, setStage] = useState<"preparing" | "uploading" | "starting" | null>(null);
    const [error, setError] = useState("");
    const operation = useRef<AbortController | null>(null);
    const opener = useRef<HTMLElement | null>(null);
    useEffect(() => () => operation.current?.abort(), []);
    useEffect(() => {
        if (open)
            setError("");
    }, [open]);
    async function create(scene?: string, image?: File, scl?: File | null, date?: string) {
        if (operation.current)
            return;
        const controller = new AbortController();
        operation.current = controller;
        const signal = controller.signal;
        setStage("preparing");
        setError("");
        try {
            let id: string;
            if (scene) {
                const result = await requestJSON<{
                    id: string;
                }>("/api/analysis/demo", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ scene }),
                    signal,
                    timeoutMs: 60000,
                });
                id = result.id;
            }
            else {
                if (!image)
                    throw new Error("Selecione uma imagem.");
                const prepared = await requestJSON<{
                    id: string;
                    uploads: {
                        image: SignedUpload;
                        scl?: SignedUpload;
                    };
                }>("/api/analysis/upload", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    signal,
                    timeoutMs: 60000,
                    body: JSON.stringify({
                        image: { name: image.name, size: image.size },
                        scl: scl ? { name: scl.name, size: scl.size } : null,
                        date: date || null,
                    }),
                });
                setStage("uploading");
                await directUpload(image, prepared.uploads.image, signal);
                if (scl && prepared.uploads.scl)
                    await directUpload(scl, prepared.uploads.scl, signal);
                setStage("starting");
                await requestJSON("/api/analysis/start", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: prepared.id }),
                    signal,
                    timeoutMs: 60000,
                });
                id = prepared.id;
            }
            if (!signal.aborted) {
                onOpenChange(false);
                router.push(`/analyses/${id}`);
            }
        }
        catch (caught) {
            if (!isAborted(caught))
                setError(`${caught instanceof DOMException && caught.name === "TimeoutError" ? "O envio demorou demais." : errorMessage(caught)} Confira a lista antes de reenviar: a análise pode ter sido criada.`);
        }
        finally {
            if (!signal.aborted)
                setStage(null);
            operation.current = null;
        }
    }
    return (<Dialog.Root open={open} onOpenChange={(value) => {
            if (!operation.current)
                onOpenChange(value);
        }}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content  onOpenAutoFocus={() => {
            opener.current =
                document.activeElement instanceof HTMLElement
                    ? document.activeElement
                    : null;
        }} onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (opener.current?.isConnected)
                opener.current.focus();
        }}>
          <div className={"relative mb-[24px] pr-[26px]"}>
            <Dialog.Title >Nova análise</Dialog.Title>
            <Dialog.Description className={"sr-only"}>
              Identifique áreas candidatas a café em uma imagem.
            </Dialog.Description>
            <Dialog.Close asChild>
              <IconButton  className={"absolute -top-[6px] -right-[9px]"} aria-label="Fechar nova análise" disabled={Boolean(stage)}>
                <X size={18}/>
              </IconButton>
            </Dialog.Close>
          </div>
          <AnalysisForm busy={Boolean(stage)} onDemo={(scene) => void create(scene)} onUpload={(image, scl, date) => void create(undefined, image, scl, date)}/>
          {stage && (<p className={"mt-[14px] flex items-center gap-[8px] text-[12px] leading-[1.5] text-muted-foreground"} role="status">
              <LoaderCircle size={16} className={"animate-spin"}/>
              {{
                preparing: "Preparando análise…",
                uploading: "Enviando imagem…",
                starting: "Iniciando processamento…",
            }[stage]}
            </p>)}
          {error && (<p className={"mt-[10px] text-[12px] leading-[1.6] text-[var(--error)]"} role="alert">
              {error}
            </p>)}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>);
}

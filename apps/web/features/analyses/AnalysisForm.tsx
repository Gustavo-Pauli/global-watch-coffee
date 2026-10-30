"use client";
import { cn } from "@/lib/utils";
import { actionButtonVariants, textButtonClass } from "@/components/ui/action";
import { Button } from "@/components/ui/button";
import { useId, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { FileImage, LoaderCircle, Upload } from "lucide-react";
import { Tabs } from "radix-ui";
import { SCENES, formatDate } from "./types";
type Props = {
    busy: boolean;
    onDemo: (scene: string) => void;
    onUpload: (image: File, scl: File | null, date: string) => void;
};
const IMAGE_LIMIT = 12 * 1024 * 1024;
const SCL_LIMIT = 4 * 1024 * 1024;
function fileError(file: File, maxBytes: number) {
    if (!/\.tiff?$/i.test(file.name))
        return "Escolha um arquivo .tif ou .tiff.";
    if (file.size === 0)
        return "O arquivo está vazio. Escolha outra imagem.";
    if (file.size > maxBytes)
        return `O arquivo deve ter até ${maxBytes / 1024 / 1024} MiB.`;
    return "";
}
function fileSize(file: File) {
    return `${(file.size / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} MiB`;
}
export default function AnalysisForm({ busy, onDemo, onUpload }: Props) {
    const id = useId();
    const sclInput = useRef<HTMLInputElement>(null);
    const [mode, setMode] = useState("upload");
    const [scene, setScene] = useState<string>(SCENES[0].value);
    const [image, setImage] = useState<File | null>(null);
    const [scl, setScl] = useState<File | null>(null);
    const [date, setDate] = useState("");
    const [imageError, setImageError] = useState("");
    const [sclError, setSclError] = useState("");
    function selectFile(event: ChangeEvent<HTMLInputElement>, kind: "image" | "scl") {
        const file = event.target.files?.[0] ?? null;
        const error = file
            ? fileError(file, kind === "image" ? IMAGE_LIMIT : SCL_LIMIT)
            : "";
        if (kind === "image") {
            setImage(error ? null : file);
            setImageError(error);
        }
        else {
            setScl(error ? null : file);
            setSclError(error);
        }
        if (error)
            event.target.value = "";
    }
    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy)
            return;
        if (mode === "example") {
            onDemo(scene);
            return;
        }
        if (!image) {
            setImageError("Selecione a imagem multiespectral para continuar.");
            return;
        }
        if (!imageError && !sclError)
            onUpload(image, scl, date);
    }
    return (<form  onSubmit={submit} aria-busy={busy}>
      <Tabs.Root value={mode} onValueChange={setMode}>
        <Tabs.List className={"mb-[23px] flex gap-[19px] border-b border-solid border-border"} aria-label="Origem da imagem">
          <Tabs.Trigger className={"rounded-none border-0 border-b-2 border-solid border-transparent bg-transparent px-px pb-[12px] pt-0 text-[13px] text-muted-foreground data-[state=active]:border-foreground data-[state=active]:text-foreground"} value="upload" disabled={busy}>
            Enviar imagem
          </Tabs.Trigger>
          <Tabs.Trigger className={"rounded-none border-0 border-b-2 border-solid border-transparent bg-transparent px-px pb-[12px] pt-0 text-[13px] text-muted-foreground data-[state=active]:border-foreground data-[state=active]:text-foreground"} value="example" disabled={busy}>
            Usar exemplo
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="upload" forceMount hidden={mode !== "upload"}>
          <div className={"mb-[19px] min-w-0"}>
            <label className={"mb-[9px] block text-[13px] font-medium"} htmlFor={`${id}-image`}>
              Imagem multiespectral
            </label>
            <label className={cn("relative flex cursor-pointer flex-col items-center gap-[10px] rounded-[6px] border border-dashed border-[#49494e] bg-[#222224] px-[17px] py-[27px] text-center hover:border-[#75757b] hover:bg-[#27272a] focus-within:outline-2 focus-within:outline-[var(--accent)] focus-within:outline-offset-[3px] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 [&>strong]:max-w-full [&>strong]:text-[13px] [&>strong]:font-medium [&>strong]:[overflow-wrap:anywhere] [&>span:last-child]:text-[12px] [&>span:last-child]:leading-[1.5] [&>span:last-child]:text-muted-foreground", image && "border-solid")} htmlFor={`${id}-image`}>
              <input id={`${id}-image`} className={"sr-only"} aria-label="Imagem multiespectral" type="file" accept=".tif,.tiff,image/tiff" disabled={busy || mode !== "upload"} required aria-describedby={`${id}-image-hint${imageError ? ` ${id}-image-error` : ""}`} aria-invalid={Boolean(imageError)} onChange={(event) => selectFile(event, "image")}/>
              <span className={"mb-[3px] text-muted-foreground"} aria-hidden="true">
                {image ? <FileImage size={22}/> : <Upload size={22}/>}
              </span>
              <strong>{image ? image.name : "Selecionar arquivo"}</strong>
              <span>
                {image
            ? `${fileSize(image)} · Substituir arquivo`
            : "GeoTIFF · .tif ou .tiff · até 12 MiB"}
              </span>
            </label>
            <p className={"mt-[9px] text-[12px] leading-[1.65] text-muted-foreground"} id={`${id}-image-hint`}>
              Quatro bandas na ordem B02, B03, B04 e B08. GeoTIFF com CRS
              projetado, até um milhão de pixels.
            </p>
            {imageError && (<p className={"mt-[10px] text-[12px] leading-[1.6] text-[var(--error)]"} role="alert" id={`${id}-image-error`}>
                {imageError}
              </p>)}
          </div>

          <details className={"mt-[22px] border-t border-solid border-[var(--line-soft)]"}>
            <summary className={"cursor-pointer py-[16px] text-[12px] font-medium text-[#c3c3c9] [details[open]>&]:mb-[4px]"}>Opções da imagem</summary>
            <div className={"mb-[19px] min-w-0"}>
              <label className={"mb-[9px] block text-[13px] font-medium"} htmlFor={`${id}-scl`}>
                Máscara SCL (opcional)
              </label>
              <input id={`${id}-scl`} ref={sclInput} className={"min-h-[38px] w-full rounded-[5px] border border-solid border-[#3b3b3e] bg-[#19191b] px-[10px] py-[9px] text-[13px] read-only:text-muted-foreground pointer-coarse:text-[16px] file:mr-[9px] file:cursor-pointer file:rounded-[3px] file:border-0 file:border-r file:border-solid file:border-border file:bg-secondary file:px-[8px] file:py-[5px] file:text-[12px] file:text-foreground"} type="file" accept=".tif,.tiff,image/tiff" disabled={busy || mode !== "upload"} aria-describedby={`${id}-scl-hint${sclError ? ` ${id}-scl-error` : ""}`} aria-invalid={Boolean(sclError)} onChange={(event) => selectFile(event, "scl")}/>
              <p className={"mt-[9px] text-[12px] leading-[1.65] text-muted-foreground"} id={`${id}-scl-hint`}>
                TIFF de uma banda uint8, até 4 MiB.
              </p>
              {sclError && (<p className={"mt-[10px] text-[12px] leading-[1.6] text-[var(--error)]"} role="alert" id={`${id}-scl-error`}>
                  {sclError}
                </p>)}
              {(scl || sclError) && (<Button variant="ghost" className={actionButtonVariants({ appearance: "neutral" })} type="button" disabled={busy} onClick={() => {
                setScl(null);
                setSclError("");
                if (sclInput.current)
                    sclInput.current.value = "";
            }}>
                  Remover máscara
                </Button>)}
            </div>
            <div className={"mb-[19px] min-w-0"}>
              <label className={"mb-[9px] block text-[13px] font-medium"} htmlFor={`${id}-date`}>
                Data de aquisição (opcional)
              </label>
              <input id={`${id}-date`} className={"min-h-[38px] w-full rounded-[5px] border border-solid border-[#3b3b3e] bg-[#19191b] px-[10px] py-[9px] text-[13px] read-only:text-muted-foreground pointer-coarse:text-[16px] file:mr-[9px] file:cursor-pointer file:rounded-[3px] file:border-0 file:border-r file:border-solid file:border-border file:bg-secondary file:px-[8px] file:py-[5px] file:text-[12px] file:text-foreground"} type="date" value={date} disabled={busy || mode !== "upload"} onChange={(event) => setDate(event.target.value)}/>
            </div>
          </details>
        </Tabs.Content>

        <Tabs.Content value="example" forceMount hidden={mode !== "example"}>
          <fieldset disabled={busy || mode !== "example"}>
            <legend className={"sr-only"}>Escolha uma imagem de exemplo</legend>
            {SCENES.map((item) => (<label key={item.value} className={"mb-[8px] flex cursor-pointer items-center gap-[12px] rounded-[5px] border border-solid border-border px-[12px] py-[13px] has-[:checked]:border-[#6b6b73] has-[:checked]:bg-[#2b2b2e] pointer-coarse:min-h-[64px]"}>
                <input type="radio" name={`${id}-scene`} value={item.value} checked={scene === item.value} onChange={() => setScene(item.value)} className={"m-0 size-[15px] accent-[var(--accent)]"}/>
                <span className={"flex flex-col gap-[4px]"}>
                  <strong className={"text-[13px] font-medium"}>{formatDate(item.date, true)}</strong>
                  <span className={"text-[12px] text-muted-foreground"}>Imagem Sentinel-2</span>
                </span>
              </label>))}
          </fieldset>
        </Tabs.Content>
      </Tabs.Root>

      <div className={"mt-[26px] flex justify-end border-t border-solid border-[var(--line-soft)] pt-[19px]"}>
        <Button variant="default" className={actionButtonVariants({ appearance: "primary" })} type="submit" disabled={busy ||
            (mode === "upload" &&
                (!image || Boolean(imageError) || Boolean(sclError)))}>
          {busy && (<LoaderCircle className={"animate-spin"} size={16} aria-hidden="true"/>)}
          {busy ? "Iniciando análise…" : "Iniciar análise"}
        </Button>
      </div>
    </form>);
}

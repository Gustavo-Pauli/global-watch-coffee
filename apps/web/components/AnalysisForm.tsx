"use client";

import { useId, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { FileImage, LoaderCircle, Upload } from "lucide-react";
import { Tabs } from "radix-ui";
import { SCENES, formatDate } from "./analysis-types";

type Props = {
  busy: boolean;
  onDemo: (scene: string) => void;
  onUpload: (image: File, scl: File | null, date: string) => void;
};

const IMAGE_LIMIT = 12 * 1024 * 1024;
const SCL_LIMIT = 4 * 1024 * 1024;

function fileError(file: File, maxBytes: number) {
  if (!/\.tiff?$/i.test(file.name)) return "Escolha um arquivo .tif ou .tiff.";
  if (file.size === 0) return "O arquivo está vazio. Escolha outra imagem.";
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

  function selectFile(
    event: ChangeEvent<HTMLInputElement>,
    kind: "image" | "scl",
  ) {
    const file = event.target.files?.[0] ?? null;
    const error = file
      ? fileError(file, kind === "image" ? IMAGE_LIMIT : SCL_LIMIT)
      : "";
    if (kind === "image") {
      setImage(error ? null : file);
      setImageError(error);
    } else {
      setScl(error ? null : file);
      setSclError(error);
    }
    if (error) event.target.value = "";
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (mode === "example") {
      onDemo(scene);
      return;
    }
    if (!image) {
      setImageError("Selecione a imagem multiespectral para continuar.");
      return;
    }
    if (!imageError && !sclError) onUpload(image, scl, date);
  }

  return (
    <form className="new-analysis-form" onSubmit={submit} aria-busy={busy}>
      <Tabs.Root value={mode} onValueChange={setMode}>
        <Tabs.List className="form-tabs" aria-label="Origem da imagem">
          <Tabs.Trigger className="form-tab" value="upload" disabled={busy}>
            Enviar imagem
          </Tabs.Trigger>
          <Tabs.Trigger className="form-tab" value="example" disabled={busy}>
            Usar exemplo
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="upload" forceMount hidden={mode !== "upload"}>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-image`}>
              Imagem multiespectral
            </label>
            <label
              className={`upload-zone${image ? " upload-selected" : ""}`}
              htmlFor={`${id}-image`}
            >
              <input
                id={`${id}-image`}
                className="sr-only"
                aria-label="Imagem multiespectral"
                type="file"
                accept=".tif,.tiff,image/tiff"
                disabled={busy || mode !== "upload"}
                required
                aria-describedby={`${id}-image-hint${imageError ? ` ${id}-image-error` : ""}`}
                aria-invalid={Boolean(imageError)}
                onChange={(event) => selectFile(event, "image")}
              />
              <span className="upload-icon" aria-hidden="true">
                {image ? <FileImage size={22} /> : <Upload size={22} />}
              </span>
              <strong>{image ? image.name : "Selecionar arquivo"}</strong>
              <span>
                {image
                  ? `${fileSize(image)} · Substituir arquivo`
                  : "GeoTIFF · .tif ou .tiff · até 12 MiB"}
              </span>
            </label>
            <p className="field-hint" id={`${id}-image-hint`}>
              Quatro bandas na ordem B02, B03, B04 e B08. GeoTIFF com CRS
              projetado, até um milhão de pixels.
            </p>
            {imageError && (
              <p className="form-error" role="alert" id={`${id}-image-error`}>
                {imageError}
              </p>
            )}
          </div>

          <details className="optional-fields">
            <summary>Opções da imagem</summary>
            <div className="field">
              <label className="field-label" htmlFor={`${id}-scl`}>
                Máscara SCL (opcional)
              </label>
              <input
                id={`${id}-scl`}
                ref={sclInput}
                className="text-input"
                type="file"
                accept=".tif,.tiff,image/tiff"
                disabled={busy || mode !== "upload"}
                aria-describedby={`${id}-scl-hint${sclError ? ` ${id}-scl-error` : ""}`}
                aria-invalid={Boolean(sclError)}
                onChange={(event) => selectFile(event, "scl")}
              />
              <p className="field-hint" id={`${id}-scl-hint`}>
                TIFF de uma banda uint8, até 4 MiB.
              </p>
              {sclError && (
                <p className="form-error" role="alert" id={`${id}-scl-error`}>
                  {sclError}
                </p>
              )}
              {(scl || sclError) && (
                <button
                  className="button"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setScl(null);
                    setSclError("");
                    if (sclInput.current) sclInput.current.value = "";
                  }}
                >
                  Remover máscara
                </button>
              )}
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${id}-date`}>
                Data de aquisição (opcional)
              </label>
              <input
                id={`${id}-date`}
                className="text-input"
                type="date"
                value={date}
                disabled={busy || mode !== "upload"}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
          </details>
        </Tabs.Content>

        <Tabs.Content value="example" forceMount hidden={mode !== "example"}>
          <fieldset disabled={busy || mode !== "example"}>
            <legend className="sr-only">Escolha uma imagem de exemplo</legend>
            {SCENES.map((item) => (
              <label key={item.value} className="scene-option">
                <input
                  type="radio"
                  name={`${id}-scene`}
                  value={item.value}
                  checked={scene === item.value}
                  onChange={() => setScene(item.value)}
                />
                <span className="scene-option-copy">
                  <strong>{formatDate(item.date, true)}</strong>
                  <span>Imagem Sentinel-2</span>
                </span>
              </label>
            ))}
          </fieldset>
        </Tabs.Content>
      </Tabs.Root>

      <div className="form-actions">
        <button
          className="button button-primary"
          type="submit"
          disabled={
            busy ||
            (mode === "upload" &&
              (!image || Boolean(imageError) || Boolean(sclError)))
          }
        >
          {busy && (
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
          )}
          {busy ? "Iniciando análise…" : "Iniciar análise"}
        </button>
      </div>
    </form>
  );
}

// language: TSX, file: apps/admin/src/app/components/ImagePicker.tsx, target: Next.js App Router
// Seletor de imagem para banners: upload → canvas crop 3:4 retrato → webp →
// POST /api/admin/banners/upload → devolve uploadId para preencher o banner.
"use client";

import { useCallback, useRef, useState } from "react";
import { adminFetch, messageOf } from "../../lib/api";
import { Upload, X, RotateCcw } from "lucide-react";

const TARGET_RATIO = 3 / 4; // retrato ~3:4 (hero box = clamp(30rem,60vw,52rem) tall, cover)
const MAX_DIMENSION = 1920; // downscale para performance
const WEBP_QUALITY = 0.82;

type ImagePickerProps = {
  /** Callback quando upload conclui com sucesso. Recebe uploadId, mime, sizeBytes. */
  onUpload: (uploadId: string, mime: string, sizeBytes: number) => void;
  /** Texto do botão enquanto não há imagem. */
  label?: string;
  /** Mostra preview da imagem já enviada (via uploadId). */
  currentUploadId?: string | null;
  /** Callback para remover a imagem atual. */
  onRemove?: () => void;
};

export function ImagePicker({ onUpload, label = "Escolher imagem", currentUploadId, onRemove }: ImagePickerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Quando currentUploadId muda, atualiza preview
  const buildPreviewUrl = useCallback((id: string) => `/api/banners/image/${id}`, []);
  const updatePreviewFromId = useCallback(() => {
    if (currentUploadId) {
      setPreviewUrl(buildPreviewUrl(currentUploadId));
    } else {
      setPreviewUrl(null);
    }
  }, [currentUploadId, buildPreviewUrl]);

  // Carrega a imagem no canvas para crop
  const loadImageToCanvas = useCallback((file: File) => {
    return new Promise<void>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return reject(new Error("Canvas não disponível"));

        // Calcula crop central 3:4
        const srcW = img.width;
        const srcH = img.height;
        const srcRatio = srcW / srcH;

        let cropW: number, cropH: number, cropX: number, cropY: number;
        if (srcRatio > TARGET_RATIO) {
          // Imagem mais larga que 3:4 — corta nas laterais
          cropH = srcH;
          cropW = srcH * TARGET_RATIO;
          cropX = (srcW - cropW) / 2;
          cropY = 0;
        } else {
          // Imagem mais alta que 3:4 — corta no topo/base
          cropW = srcW;
          cropH = srcW / TARGET_RATIO;
          cropX = 0;
          cropY = (srcH - cropH) / 2;
        }

        // Downscale se necessário
        const scale = Math.min(1, MAX_DIMENSION / cropW);
        const outW = Math.round(cropW * scale);
        const outH = Math.round(cropH * scale);

        canvas.width = outW;
        canvas.height = outH;
        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, outW, outH);

        setCrop({ x: cropX, y: cropY, w: cropW, h: cropH });
        resolve();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Falha ao carregar imagem"));
      };
      img.src = url;
      imgRef.current = img;
    });
  }, []);

  // Converte canvas para base64 WebP
  const canvasToBase64 = useCallback((): string => {
    const canvas = canvasRef.current;
    if (!canvas) throw new Error("Canvas vazio");
    const dataUrl = canvas.toDataURL("image/webp", WEBP_QUALITY);
    return dataUrl.slice(dataUrl.indexOf(",") + 1); // remove "data:image/webp;base64,"
  }, []);

  // Upload para a API
  const upload = useCallback(async (base64: string) => {
    const res = await adminFetch("/api/admin/banners/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image: base64 }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      uploadId?: string;
      mime?: string;
      sizeBytes?: number;
      error?: { code?: string; message?: string };
    };
    if (!res.ok || !json.uploadId) {
      throw new Error(json.error?.message ?? "Falha no upload");
    }
    // Após a validação, sabemos que uploadId existe
    return {
      uploadId: json.uploadId,
      mime: json.mime ?? "image/webp",
      sizeBytes: json.sizeBytes ?? base64.length,
    };
  }, []);

  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Arquivo deve ser uma imagem (JPEG, PNG ou WebP)");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Arquivo muito grande (máx. 10 MB antes do crop)");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await loadImageToCanvas(file);
      const base64 = canvasToBase64();
      const result = await upload(base64);
      setPreviewUrl(buildPreviewUrl(result.uploadId));
      onUpload(result.uploadId, result.mime ?? "image/webp", result.sizeBytes ?? base64.length);
    } catch (e) {
      setError(messageOf(e, "Falha ao processar imagem"));
    } finally {
      setBusy(false);
    }
  }, [loadImageToCanvas, canvasToBase64, upload, buildPreviewUrl, onUpload]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handleRemove = () => {
    setPreviewUrl(null);
    setCrop(null);
    onRemove?.();
  };

  return (
    <div className="image-picker">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleInputChange}
        style={{ display: "none" }}
        disabled={busy}
      />

      {previewUrl ? (
        <div className="image-picker__preview" onDragOver={handleDragOver} onDrop={handleDrop}>
          <img src={previewUrl} alt="Preview do banner" />
          <div className="image-picker__actions">
            <button
              type="button"
              className="image-picker__btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              title="Trocar imagem"
            >
              <RotateCcw size={16} strokeWidth={2} />
            </button>
            <button
              type="button"
              className="image-picker__btn image-picker__btn--remove"
              onClick={handleRemove}
              disabled={busy}
              title="Remover imagem"
            >
              <X size={16} strokeWidth={2} />
            </button>
          </div>
          {crop && (
            <p className="image-picker__meta">
              {Math.round(canvasRef.current?.width ?? 0)} × {Math.round(canvasRef.current?.height ?? 0)} · WebP {Math.round(WEBP_QUALITY * 100)}%
            </p>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="image-picker__dropzone"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          disabled={busy}
        >
          <Upload size={28} strokeWidth={1.5} className="image-picker__icon" />
          <span className="image-picker__label">{label}</span>
          <span className="image-picker__hint">JPEG, PNG ou WebP · crop automático 3:4 · WebP 82%</span>
        </button>
      )}

      {error && <p className="image-picker__error" role="alert">{error}</p>}
      {busy && <p className="image-picker__busy">Processando e enviando…</p>}

      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}
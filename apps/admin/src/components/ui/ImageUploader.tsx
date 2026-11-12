"use client";

import { useCallback, useRef, useState } from "react";
import { Upload, X, RotateCcw } from "lucide-react";
import { adminFetch, messageOf } from "../../lib/api";

interface ImageUploaderProps {
  onUpload: (uploadId: string, mime: string, sizeBytes: number, url: string) => void;
  onRemove?: () => void;
  currentImage?: { uploadId: string; url: string } | null;
  label?: string;
  accept?: string;
  maxSizeMB?: number;
  multiple?: boolean;
  aspectRatio?: number; // opcional: se não informado, não faz crop, só resize
  targetWidth?: number; // largura máxima no maior lado (default 2000)
  quality?: number; // 0-1 (default 0.82)
}

export function ImageUploader({
  onUpload,
  onRemove,
  currentImage,
  label = "Escolher imagem",
  accept = "image/jpeg,image/png,image/webp",
  maxSizeMB = 5,
  multiple = false,
  aspectRatio,
  targetWidth = 2000,
  quality = 0.82,
}: ImageUploaderProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previews, setPreviews] = useState<{ file: File; url: string; base64: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const buildPreviewUrl = useCallback((id: string) => `/api/banners/image/${id}`, []);

  const loadImageToCanvas = useCallback(
    (file: File): Promise<{ base64: string; width: number; height: number }> => {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext("2d");
          if (!canvas || !ctx) return reject(new Error("Canvas não disponível"));

          const srcW = img.width;
          const srcH = img.height;

          let cropW: number, cropH: number, cropX: number, cropY: number;
          let outW: number, outH: number;

          if (aspectRatio) {
            // Com crop: centraliza no aspectRatio desejado
            const srcRatio = srcW / srcH;
            if (srcRatio > aspectRatio) {
              cropH = srcH;
              cropW = srcH * aspectRatio;
              cropX = (srcW - cropW) / 2;
              cropY = 0;
            } else {
              cropW = srcW;
              cropH = srcW / aspectRatio;
              cropX = 0;
              cropY = (srcH - cropH) / 2;
            }
            const scale = Math.min(1, targetWidth / cropW);
            outW = Math.round(cropW * scale);
            outH = Math.round(cropH * scale);
            canvas.width = outW;
            canvas.height = outH;
            ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
          } else {
            // Sem crop: apenas redimensiona mantendo proporção original
            const scale = Math.min(1, targetWidth / Math.max(srcW, srcH));
            outW = Math.round(srcW * scale);
            outH = Math.round(srcH * scale);
            canvas.width = outW;
            canvas.height = outH;
            ctx.drawImage(img, 0, 0, outW, outH);
          }

          const dataUrl = canvas.toDataURL("image/webp", quality);
          resolve({ base64: dataUrl.slice(dataUrl.indexOf(",") + 1), width: outW, height: outH });
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("Falha ao carregar imagem"));
        };
        img.src = url;
      });
    },
    [aspectRatio, targetWidth, quality]
  );

  const upload = useCallback(
    async (base64: string) => {
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
      return {
        uploadId: json.uploadId,
        mime: json.mime ?? "image/webp",
        sizeBytes: json.sizeBytes ?? base64.length,
      };
    },
    []
  );

  const handleFileSelect = useCallback(
    async (files: FileList) => {
      const fileArray = Array.from(files);
      if (fileArray.length === 0) return;

      setBusy(true);
      setError("");

      try {
        for (const file of fileArray) {
          if (!file.type.startsWith("image/")) {
            setError("Arquivo deve ser uma imagem (JPEG, PNG ou WebP)");
            return;
          }
          if (file.size > maxSizeMB * 1024 * 1024) {
            setError(`Arquivo muito grande (máx. ${maxSizeMB} MB)`);
            return;
          }

          const { base64, width, height } = await loadImageToCanvas(file);
          const result = await upload(base64);
          const imageUrl = buildPreviewUrl(result.uploadId);

          onUpload(result.uploadId, result.mime, result.sizeBytes, imageUrl);

          if (!multiple) {
            setPreviews([{ file, url: imageUrl, base64 }]);
          } else {
            setPreviews((prev) => [...prev, { file, url: imageUrl, base64 }]);
          }
        }
      } catch (e) {
        setError(messageOf(e, "Falha ao processar imagem"));
      } finally {
        setBusy(false);
      }
    },
    [loadImageToCanvas, upload, buildPreviewUrl, onUpload, maxSizeMB, multiple]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) handleFileSelect(files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    if (files.length) handleFileSelect(files);
  };

  const handleRemove = (index?: number) => {
    if (index !== undefined) {
      setPreviews((prev) => prev.filter((_, i) => i !== index));
    } else {
      setPreviews([]);
    }
    onRemove?.();
  };

  const imagesToShow = currentImage && previews.length === 0 ? [{ file: null as any, url: currentImage.url, base64: "" }] : previews;

  return (
    <div className="image-uploader">
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        multiple={multiple}
        style={{ display: "none" }}
        disabled={busy}
      />

      {imagesToShow.length > 0 ? (
        <div className="image-uploader__previews" onDragOver={handleDragOver} onDrop={handleDrop}>
          {imagesToShow.map((item, idx) => (
            <div key={idx} className="image-uploader__preview">
              <img src={item.url} alt={`Preview ${idx + 1}`} />
              <div className="image-uploader__actions">
                <button
                  type="button"
                  className="image-uploader__btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  title="Trocar imagem"
                >
                  <RotateCcw size={16} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  className="image-uploader__btn image-uploader__btn--remove"
                  onClick={() => handleRemove(idx)}
                  disabled={busy}
                  title="Remover imagem"
                >
                  <X size={16} strokeWidth={2} />
                </button>
              </div>
              <p className="image-uploader__meta">
                {item.url.includes("blob:") ? `${Math.round(canvasRef.current?.width ?? 0)} × ${Math.round(canvasRef.current?.height ?? 0)}` : `${targetWidth} × ${Math.round(targetWidth / (aspectRatio || 1))}`} · WebP {Math.round(quality * 100)}%
              </p>
            </div>
          ))}
        </div>
      ) : (
        <button
          type="button"
          className="image-uploader__dropzone"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          disabled={busy}
        >
          <Upload size={28} strokeWidth={1.5} className="image-uploader__icon" />
          <span className="image-uploader__label">{label}</span>
          <span className="image-uploader__hint">
            JPEG, PNG ou WebP {aspectRatio ? `· crop automático ${aspectRatio === 1 ? "1:1" : aspectRatio === 16 / 9 ? "16:9" : aspectRatio === 3 / 4 ? "3:4" : aspectRatio.toFixed(2)}` : "· sem crop, mantém proporção"} · WebP {Math.round(quality * 100)}% · máx. {maxSizeMB} MB
          </span>
        </button>
      )}

      {error && <p className="image-uploader__error" role="alert">{error}</p>}
      {busy && <p className="image-uploader__busy">Processando e enviando…</p>}

      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}
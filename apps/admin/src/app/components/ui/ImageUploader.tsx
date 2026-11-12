// language: TSX, file: apps/admin/src/app/components/ui/ImageUploader.tsx, target: Next.js App Router
// ImageUploader: upload múltiplo (até 10), drag-drop, preview, reordenar (drag), foto principal, WebP.
"use client";

import { useCallback, useRef, useState } from "react";
import { X, GripVertical, Image as ImageIcon, Upload } from "lucide-react";
import { adminFetch } from "../../../lib/api";

interface UploadedImage {
  id: string;
  url: string;
  alt: string;
  position: number;
  isMain: boolean;
  file?: File; // para upload pendente
  previewUrl?: string; // base64 preview antes do upload
}

// Type guard for UploadedImage
function isUploadedImage(img: UploadedImage | undefined): img is UploadedImage {
  return img !== undefined && typeof img.id === "string";
}

interface ImageUploaderProps {
  /** Imagens já salvas no backend */
  images: UploadedImage[];
  /** Callback quando a lista muda (após upload/remove/reorder) */
  onChange: (images: UploadedImage[]) => void;
  /** Máximo de imagens (padrão 10) */
  max?: number;
  /** Label do dropzone */
  label?: string;
  /** Se true, desabilita o componente */
  disabled?: boolean;
  /** Endpoint de upload (padrão /api/admin/products/upload) */
  uploadEndpoint?: string;
}

const MAX_DIMENSION = 1920;
const WEBP_QUALITY = 0.82;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB antes do crop

async function compressToWebP(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  let quality = WEBP_QUALITY;
  let dataUrl = canvas.toDataURL("image/webp", quality);
  while (dataUrl.length > MAX_FILE_SIZE * 1.35 && quality > 0.4) {
    quality -= 0.12;
    dataUrl = canvas.toDataURL("image/webp", quality);
  }
  return dataUrl.slice(dataUrl.indexOf(",") + 1); // base64 sem prefixo
}

export function ImageUploader({
  images: initialImages,
  onChange,
  max = 10,
  label = "Arraste fotos do produto ou clique para escolher",
  disabled = false,
  uploadEndpoint = "/api/admin/products/upload",
}: ImageUploaderProps) {
  const [images, setImages] = useState<UploadedImage[]>(initialImages);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  // Sincroniza com props
  if (images.length === 0 && initialImages.length > 0) {
    setImages(initialImages);
  }

  const notifyChange = useCallback((newImages: UploadedImage[]) => {
    setImages(newImages);
    onChange(newImages);
  }, [onChange]);

  const handleFileSelect = useCallback(
    async (files: FileList | File[]) => {
      if (disabled) return;
      const fileArray = Array.from(files);
      const room = max - images.length;
      if (fileArray.length > room) {
        setError(`Máximo de ${max} imagens.`);
        return;
      }
      setBusy(true);
      setError("");

      try {
        const newImages: UploadedImage[] = [...images];
        for (const file of fileArray.slice(0, room)) {
          if (!/^image\//.test(file.type)) {
            setError("Só arquivos de imagem (JPEG, PNG ou WebP).");
            continue;
          }
          if (file.size > MAX_FILE_SIZE * 2) {
            setError("Arquivo muito grande (máx. 10 MB antes da compressão).");
            continue;
          }
          const base64 = await compressToWebP(file);
          // Preview imediato
          const previewUrl = `data:image/webp;base64,${base64}`;
          const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          newImages.push({
            id: tempId,
            url: "",
            alt: "",
            position: newImages.length,
            isMain: newImages.length === 0,
            file,
            previewUrl,
          });
          notifyChange(newImages);
        }
        // Upload em background
        for (let i = 0; i < newImages.length; i++) {
          const img = newImages[i];
          if (!img) continue;
          if (img.file && !img.url && img.previewUrl) {
            try {
              const res = await adminFetch(uploadEndpoint, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ image: img.previewUrl.slice(img.previewUrl.indexOf(",") + 1) }),
              });
              const json = (await res.json().catch(() => ({}))) as {
                id?: string;
                url?: string;
                error?: { message?: string };
              };
              if (!res.ok || !json.id) throw new Error(json.error?.message ?? "Falha no upload");
              const updated: UploadedImage = {
                ...img,
                id: json.id!,
                url: json.url ?? "",
                alt: img.alt ?? "",
                position: img.position,
                isMain: img.isMain,
                file: undefined,
                previewUrl: undefined,
              };
              newImages[i] = updated;
              notifyChange([...newImages]);
            } catch {
              // Mantém preview local, marca erro visual
              newImages[i] = {
                ...img,
                file: undefined,
                alt: img.alt ?? "",
                id: img.id,
                url: img.url,
                position: img.position,
                isMain: img.isMain,
              };
              notifyChange([...newImages]);
            }
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha ao processar imagens.");
      } finally {
        setBusy(false);
      }
    },
    [images, max, disabled, notifyChange, uploadEndpoint]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFileSelect(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    if (e.dataTransfer.files) handleFileSelect(e.dataTransfer.files);
  };

  const removeImage = (index: number) => {
    const newImages = images.filter((_, i) => i !== index).map((img, i) => ({
      ...img,
      position: i,
      isMain: i === 0,
    }));
    notifyChange(newImages);
  };

  const setMain = (index: number) => {
    const newImages = images.map((img, i) => ({
      ...img,
      isMain: i === index,
    }));
    notifyChange(newImages);
  };

  // Reorder com drag nativo
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = "move";
    setDraggedIndex(index);
  };

  const handleDragOverItem = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDropItem = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    const newImages = [...images].filter((img): img is UploadedImage => !!img);
    const [removed] = newImages.splice(draggedIndex, 1);
    if (!removed) return;
    newImages.splice(index, 0, removed);
    const reordered = newImages.map((img, i) => ({ ...img, position: i }));
    notifyChange(reordered);
    setDraggedIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <div className="image-uploader">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={handleInputChange}
        className="sr-only"
        disabled={disabled || busy || images.length >= max}
        aria-label="Selecionar fotos do produto"
      />

      <button
        type="button"
        className={`image-uploader__dropzone ${disabled ? "image-uploader__dropzone--disabled" : ""} ${
          dragCounter.current > 0 ? "image-uploader__dropzone--drag" : ""
        }`}
        onClick={() => !disabled && !busy && images.length < max && fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        disabled={disabled || busy || images.length >= max}
      >
        <Upload size={28} strokeWidth={1.5} className="image-uploader__icon" />
        <span className="image-uploader__label">{label}</span>
        <span className="image-uploader__hint">
          JPEG, PNG ou WebP · até {max} fotos · WebP 82% · reordene arrastando
        </span>
        {busy && <span className="image-uploader__busy">Processando e enviando…</span>}
      </button>

      {error && <p className="image-uploader__error" role="alert">{error}</p>}

      {images.length > 0 && (
        <div className="image-uploader__previews" role="list" aria-label="Fotos do produto">
          {images.map((img, index) => (
            <article
              key={img.id}
              className={`image-uploader__item ${img.isMain ? "image-uploader__item--main" : ""} ${
                draggedIndex === index ? "image-uploader__item--dragging" : ""
              }`}
              draggable={!disabled}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOverItem(e, index)}
              onDrop={(e) => handleDropItem(e, index)}
              onDragEnd={handleDragEnd}
              role="listitem"
            >
              <div className="image-uploader__preview">
                <img
                  src={img.previewUrl || img.url || `/api/admin/products/images/${img.id}`}
                  alt={img.alt || `Foto ${index + 1}`}
                />
                {img.isMain && <span className="image-uploader__main-badge">Principal</span>}
                {!img.url && img.previewUrl && <span className="image-uploader__pending">Enviando…</span>}
              </div>
              <div className="image-uploader__actions">
                {!img.isMain && (
                  <button
                    type="button"
                    className="image-uploader__btn"
                    onClick={() => setMain(index)}
                    title="Definir como principal"
                    disabled={disabled || busy}
                  >
                    <ImageIcon size={16} strokeWidth={2} />
                  </button>
                )}
                <button
                  type="button"
                  className="image-uploader__btn image-uploader__btn--drag"
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOverItem(e, index)}
                  onDrop={(e) => handleDropItem(e, index)}
                  onDragEnd={handleDragEnd}
                  title="Reordenar"
                  disabled={disabled || busy}
                  aria-label="Arrastar para reordenar"
                >
                  <GripVertical size={16} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  className="image-uploader__btn image-uploader__btn--remove"
                  onClick={() => removeImage(index)}
                  title="Remover"
                  disabled={disabled || busy}
                >
                  <X size={16} strokeWidth={2} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
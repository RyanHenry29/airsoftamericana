"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import { adminJson, adminFetch, messageOf } from "../../../lib/api";
import { useGateRedirect } from "../../../lib/useGate";
import { useToast, useConfirm } from "@/components/ui";
import { Field, Input, Select, Textarea, Checkbox, MoneyInput, ImageUploader, ConfirmDialog } from "@/components/ui";
import {
  Image,
  Tag,
  DollarSign,
  Package,
  Type,
  Settings,
  Video,
  Search,
  Archive,
  Save,
  Eye,
  Copy,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Trash2,
  Star,
  Shield,
  Camera,
  RotateCcw,
  X,
  ArrowUp,
  ArrowDown,
  Plus,
  List,
} from "lucide-react";

type Category = { id: string; name: string; slug: string; parentId?: string };
type Brand = { id: string; name: string; slug: string };
type Variant = { id: string; sku: string; name: string; priceCents: number; promoPriceCents: number | null; active: boolean; weightGrams: number; inventory?: { physical: number; reserved: number; minQuantity: number } | null };
type ProductImage = { id: string; url: string; alt: string; kind: string; position: number; uploadId?: string | null; main?: boolean };
type Spec = { id: string; key: string; label: string; value: string; position: number };
type Related = { id: string; relatedProductId: string; position: number };
type Compatible = { id: string; compatibleProductId: string; position: number };
type HistoryItem = { id: string; field: string; beforeValue: string | null; afterValue: string | null; actorLabel: string | null; createdAt: string };
type Video = { url: string; type: string; title?: string };

const SECTIONS = [
  { id: "photos", label: "Fotos", icon: Image },
  { id: "basic", label: "Informações básicas", icon: Tag },
  { id: "pricing", label: "Preço e promoções", icon: DollarSign },
  { id: "stock", label: "Estoque", icon: Package },
  { id: "description", label: "Descrição", icon: Type },
  { id: "airsoft", label: "Especificações Airsoft", icon: Settings },
  { id: "specs", label: "Ficha técnica", icon: List },
  { id: "video", label: "Vídeo", icon: Video },
  { id: "seo", label: "SEO", icon: Search },
  { id: "history", label: "Histórico", icon: Clock },
] as const;

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}

function Clock({ size = 18, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function ListIcon({ size = 18, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="18" />
    </svg>
  );
}

export default function ProductFormPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const { open, title, message, onConfirm, close, variant, confirmLabel, cancelLabel, loading: confirmLoading } = useConfirm();

  const isNew = params.id === "new";
  const productId = isNew ? null : params.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [cats, setCats] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [meRole, setMeRole] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState("photos");

  // Product data
  const [product, setProduct] = useState({
    id: "",
    name: "",
    slug: "",
    description: "",
    shortDescription: "",
    categoryId: "",
    brandId: "",
    ageRestricted: false,
    featured: false,
    published: false,
    condicao: "novo" as "novo" | "usado" | "seminovo",
    estadoConservacao: "",
    acessoriosIncluidos: "",
    garantiaDias: 30,
    tags: "",
    seoTitle: "",
    seoDescription: "",
    costCents: null as number | null,
    publishedAt: null as string | null,
    technical: {} as Record<string, string>,
    videos: [] as Video[],
  });

  // Variants
  const [variants, setVariants] = useState<Variant[]>([]);

  // Images
  const [images, setImages] = useState<ProductImage[]>([]);
  const [mainImageIndex, setMainImageIndex] = useState(0);

  // Specs
  const [specs, setSpecs] = useState<Spec[]>([]);

  // Related/Compatible
  const [related, setRelated] = useState<Related[]>([]);
  const [compatible, setCompatible] = useState<Compatible[]>([]);

  // History
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // Form dirty tracking
  const [isDirty, setIsDirty] = useState(false);
  const initialDataRef = useRef<string>("");

  useGateRedirect(failure);

  const canCost = meRole != null && ["superadmin", "gerente", "financeiro"].includes(meRole);

  // Track dirty state
  const updateProduct = useCallback((partial: Partial<typeof product>) => {
    setProduct((p) => {
      const next = { ...p, ...partial };
      setIsDirty(true);
      return next;
    });
  }, []);

  const updateVariant = useCallback((id: string, partial: Partial<Variant>) => {
    setVariants((v) => v.map((variant) => (variant.id === id ? { ...variant, ...partial } : variant)));
    setIsDirty(true);
  }, []);

  const markClean = useCallback(() => {
    setIsDirty(false);
    initialDataRef.current = JSON.stringify({ product, variants, images, specs, related, compatible });
  }, [product, variants, images, specs, related, compatible]);

  // Load data
  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [me, c, b] = await Promise.all([
          adminJson<any>("/api/admin/me").catch(() => ({ user: null })),
          adminJson<Category[]>(`${process.env.NEXT_PUBLIC_API_URL ?? ""}/api/store/categories`).catch(() => []),
          adminJson<Brand[]>(`${process.env.NEXT_PUBLIC_API_URL ?? ""}/api/store/brands`).catch(() => []),
        ]);
        setMeRole(me?.user?.role ?? null);
        setCats(Array.isArray(c) ? c : []);
        setBrands(Array.isArray(b) ? b : []);

        if (!isNew && productId) {
          const [detail, hist] = await Promise.all([
            adminJson<any>(`/api/admin/products/${productId}`),
            adminJson<any>(`/api/admin/products/${productId}/history`).catch(() => ({ items: [] })),
          ]);
          const p = detail.product;
          const v = detail.variants || [];
          const img = detail.images || [];
          const sp = detail.specs || [];
          const rel = detail.related || [];
          const comp = detail.compatible || [];

          setProduct({
            id: p.id,
            name: p.name,
            slug: p.slug,
            description: p.description,
            shortDescription: p.shortDescription ?? "",
            categoryId: p.categoryId,
            brandId: p.brandId ?? "",
            ageRestricted: p.ageRestricted,
            featured: p.featured,
            published: p.published,
            condicao: p.condicao,
            estadoConservacao: p.estadoConservacao,
            acessoriosIncluidos: p.acessoriosIncluidos,
            garantiaDias: p.garantiaDias,
            tags: p.tags,
            seoTitle: p.seoTitle,
            seoDescription: p.seoDescription,
            costCents: p.costCents ?? null,
            publishedAt: p.publishedAt ? String(p.publishedAt).slice(0, 19) : null,
            technical: p.technical ?? {},
            videos: p.videos ?? [],
          });
          setVariants(v.map((variant: any) => ({
            ...variant,
            priceCents: Number(variant.priceCents),
            promoPriceCents: variant.promoPriceCents != null ? Number(variant.promoPriceCents) : null,
            inventory: variant.inventory ?? null,
          })));
          setImages(img.map((im: any, idx: number) => ({
            ...im,
            main: idx === 0,
          })));
          setSpecs(sp);
          setRelated(rel);
          setCompatible(comp);
          setHistory(hist.items || []);
          setMainImageIndex(img.findIndex((im: any) => im.main ?? false) > 0 ? img.findIndex((im: any) => im.main ?? false) : 0);
        } else if (cats[0]) {
          updateProduct({ categoryId: cats[0].id });
        }

        markClean();
      } catch (e) {
        setFailure(e);
        setError(messageOf(e, "Falha ao carregar."));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [isNew, productId, updateProduct]);

  // Warn on unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  // Validate before publish
  function validateForPublish(): string[] {
    const missing: string[] = [];
    if (!product.name.trim()) missing.push("Nome");
    if (!product.categoryId) missing.push("Categoria");
    if (!product.slug.trim()) missing.push("Slug");
    if (variants.length === 0) missing.push("Pelo menos uma variação");
    else {
      const v = variants[0]!;
      if (v.priceCents <= 0) missing.push("Preço");
      if ((v.inventory?.physical ?? 0) < 0) missing.push("Estoque");
    }
    if (images.length === 0) missing.push("Pelo menos 1 foto");
    return missing;
  }

  async function saveDraft() {
    await saveProduct(false);
  }

  async function saveAndPublish() {
    const missing = validateForPublish();
    if (missing.length > 0) {
      showToast({ type: "error", title: "Campos obrigatórios", message: `Preencha: ${missing.join(", ")}` });
      const sectionMap: Record<string, string> = {
        Nome: "basic",
        Categoria: "basic",
        Slug: "basic",
        "Pelo menos uma variação": "pricing",
        Preço: "pricing",
        Estoque: "stock",
        "Pelo menos 1 foto": "photos",
      };
      const firstMissing = missing[0];
      if (firstMissing && sectionMap[firstMissing]) setActiveSection(sectionMap[firstMissing]);
      return;
    }
    await saveProduct(true);
  }

  async function archiveProduct() {
    await saveProduct(false, { archived: true });
  }

  async function saveProduct(publish: boolean, extra?: { archived?: boolean }) {
    if (!product.name.trim()) { showToast({ type: "error", title: "Nome obrigatório" }); return; }
    if ((product.condicao === "usado" || product.condicao === "seminovo") && !product.estadoConservacao.trim()) {
      showToast({ type: "error", title: "Conservação obrigatória", message: "Produtos usados/seminovos exigem estado de conservação." });
      setActiveSection("airsoft");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const variantsPayload = variants.map((v) => ({
        sku: v.sku.trim(),
        name: v.name.trim(),
        priceCents: Math.max(0, Math.round(v.priceCents)),
        promoPriceCents: v.promoPriceCents != null && v.promoPriceCents > 0 ? Math.round(v.promoPriceCents) : null,
        weightGrams: Math.max(0, Math.round(v.weightGrams)),
        active: v.active,
        stockPhysical: Math.max(0, Math.round(v.inventory?.physical ?? 0)),
        stockMin: Math.max(0, Math.round(v.inventory?.minQuantity ?? 0)),
      }));

      const body = {
        name: product.name.trim(),
        slug: product.slug.trim() || slugify(product.name),
        description: product.description.trim(),
        shortDescription: product.shortDescription.trim(),
        categoryId: product.categoryId,
        brandId: product.brandId || null,
        ageRestricted: product.ageRestricted,
        featured: product.featured,
        published: publish || extra?.archived ? false : product.published,
        condicao: product.condicao,
        estadoConservacao: product.estadoConservacao.trim(),
        acessoriosIncluidos: product.acessoriosIncluidos.trim(),
        garantiaDias: Math.max(0, Math.round(product.garantiaDias)),
        tags: product.tags.trim(),
        seoTitle: product.seoTitle.trim(),
        seoDescription: product.seoDescription.trim(),
        technical: product.technical,
        videos: product.videos,
        ...(canCost && product.costCents !== null && product.costCents !== undefined ? { costCents: Math.round(product.costCents) } : {}),
        ...(extra?.archived ? { archived: true } : {}),
        variants: variantsPayload,
      };

      const url = isNew ? "/api/admin/products" : `/api/admin/products/${productId}`;
      const method = isNew ? "POST" : "PATCH";

      const res = await adminFetch(url, {
        method,
        body: JSON.stringify(body),
      });

      const json = (await res.json().catch(() => ({}))) as { product?: { id: string }; error?: { message?: string } };

      if (!res.ok) {
        throw new Error(json.error?.message ?? "Falha ao salvar.");
      }

      const savedId = json.product?.id ?? productId!;
      showToast({ type: "success", title: publish ? "Publicado com sucesso" : "Salvo como rascunho" });
      markClean();
      router.push(`/products/${savedId}`);
      router.refresh();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao salvar."));
      showToast({ type: "error", title: "Erro", message: messageOf(e, "Falha ao salvar.") });
    } finally {
      setSaving(false);
    }
  }

  // Image handling
  async function handleImageUpload(uploadId: string, mime: string, sizeBytes: number, url: string) {
    const newImage: ProductImage = {
      id: uploadId,
      url,
      alt: product.name,
      kind: "image",
      position: images.length,
      uploadId,
      main: images.length === 0,
    };
    setImages((imgs) => [...imgs, newImage]);
    setIsDirty(true);
    showToast({ type: "success", title: "Imagem enviada" });
  }

  function removeImage(index: number) {
    if (!confirm("Remover esta imagem?")) return;
    const img = images[index];
    if (!img) return;
    if (img.uploadId) {
      // Could add delete upload endpoint later
    }
    setImages((imgs) => imgs.filter((_, i) => i !== index).map((im, idx) => ({ ...im, position: idx, main: idx === 0 })));
    setIsDirty(true);
    showToast({ type: "success", title: "Imagem removida" });
  }

  function setMainImage(index: number) {
    setImages((imgs) => imgs.map((im, i) => ({ ...im, main: i === index })));
    setMainImageIndex(index);
    setIsDirty(true);
  }

  function reorderImage(index: number, dir: -1 | 1) {
    const newIndex = index + dir;
    if (newIndex < 0 || newIndex >= images.length) return;
    setImages((imgs) => {
      const next = [...imgs];
      const removed = next.splice(index, 1)[0];
      if (!removed) return imgs;
      next.splice(newIndex, 0, removed);
      return next.map((im, idx) => ({ ...im, position: idx, main: idx === 0 }));
    });
    setMainImageIndex((prev) => (prev === index ? newIndex : prev === newIndex ? index : prev));
    setIsDirty(true);
  }

  // Specs
  function addSpec(key: string, label: string, value: string) {
    if (!label.trim() || !value.trim()) return;
    const newSpec: Spec = {
      id: crypto.randomUUID(),
      key: key.toLowerCase().replace(/\s+/g, "-").slice(0, 60),
      label: label.trim(),
      value: value.trim(),
      position: specs.length,
    };
    setSpecs([...specs, newSpec]);
    setIsDirty(true);
  }

  function removeSpec(id: string) {
    setSpecs((s) => s.filter((sp) => sp.id !== id).map((sp, idx) => ({ ...sp, position: idx })));
    setIsDirty(true);
  }

  // Related/Compatible
  async function addRelated(id: string) {
    if (!id.trim()) return;
    try {
      await adminFetch(`/api/admin/products/${productId}/related`, {
        method: "POST",
        body: JSON.stringify({ relatedProductId: id.trim() }),
      });
      await loadRelated();
      showToast({ type: "success", title: "Relacionado adicionado" });
    } catch (e) {
      showToast({ type: "error", title: "Erro", message: messageOf(e, "Falha") });
    }
  }

  async function removeRelated(id: string) {
    if (!confirm("Remover relacionado?")) return;
    try {
      await adminFetch(`/api/admin/products/${productId}/related/${id}`, { method: "DELETE" });
      await loadRelated();
      showToast({ type: "success", title: "Removido" });
    } catch (e) {
      showToast({ type: "error", title: "Erro", message: messageOf(e, "Falha") });
    }
  }

  async function loadRelated() {
    if (!productId) return;
    const detail = await adminJson<any>(`/api/admin/products/${productId}`);
    setRelated(detail.related || []);
    setCompatible(detail.compatible || []);
  }

  // Video
  function addVideo(url: string, type: string) {
    if (!url.trim() || !/^https?:\/\//i.test(url)) {
      showToast({ type: "error", title: "URL inválida" });
      return;
    }
    updateProduct({ videos: [...product.videos, { url: url.trim(), type, title: "" }] });
  }

  function removeVideo(index: number) {
    updateProduct({ videos: product.videos.filter((_, i) => i !== index) });
  }

  // Technical specs
  function addTech(key: string, value: string) {
    if (!key.trim()) return;
    updateProduct({ technical: { ...product.technical, [key.trim()]: value.trim() } });
  }

  function removeTech(key: string) {
    const next = { ...product.technical };
    delete next[key];
    updateProduct({ technical: next });
  }

  // Duplicate product
  async function duplicateProduct() {
    if (!productId) return;
    try {
      const res = await adminFetch(`/api/admin/products/${productId}`, { method: "GET" });
      const detail = await res.json();
      const newProduct = {
        ...detail.product,
        name: `${detail.product.name} (cópia)`,
        slug: `${detail.product.slug}-copia-${Date.now()}`,
        published: false,
        featured: false,
        publishedAt: null,
        id: undefined,
      };
      const createRes = await adminFetch("/api/admin/products", {
        method: "POST",
        body: JSON.stringify({
          ...newProduct,
          variants: detail.variants.map((v: any) => ({
            ...v,
            sku: `${v.sku}-COPY-${Date.now()}`,
          })),
        }),
      });
      const created = await createRes.json();
      showToast({ type: "success", title: "Produto duplicado" });
      router.push(`/products/${created.product?.id}`);
      router.refresh();
    } catch (e) {
      showToast({ type: "error", title: "Erro", message: messageOf(e, "Falha ao duplicar") });
    }
  }

  // Category tree helper
  function buildCategoryTree() {
    const roots = cats.filter((c) => !c.parentId);
    function renderNode(cat: Category, depth = 0) {
      const children = cats.filter((c) => c.parentId === cat.id);
      return (
        <optgroup key={cat.id} label={"&nbsp;".repeat(depth * 4) + cat.name}>
          {children.map(renderNode)}
        </optgroup>
      );
    }
    return roots.map(renderNode);
  }

  if (loading) {
    return (
      <main className="px-6 pb-24">
        <div className="grid grid-cols-1 gap-4">
          <div className="skel skel-title" />
          <div className="skel skel-card" style={{ height: 400 }} />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="px-6 py-24 text-center">
        <p role="alert" className="text-[#dc2626] font-mono text-xs mb-4">{error}</p>
        <Link href="/products" className="underline text-[#8bcf16]">Voltar</Link>
      </main>
    );
  }

  const canEdit = meRole != null && ["superadmin", "gerente", "estoque", "marketing"].includes(meRole);

  return (
    <main className="px-6 pb-24">
      {/* Header with sticky actions */}
      <header className="sticky top-0 z-10 mb-8 border-b border-[#111] bg-black/95 backdrop-blur-sm pb-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display font-black text-2xl md:text-3xl uppercase text-white">
              {isNew ? "Novo produto" : "Editar produto"}
            </h1>
            <p className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] mt-1">
              {isNew ? "Preencha as seções abaixo" : `${product.slug} · ${product.published ? "Publicado" : "Rascunho"}${product.featured ? " · Destaque" : ""}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!isNew && (
              <>
                <button
                  type="button"
                  className="font-mono text-[0.6rem] uppercase font-bold py-2 px-3 border border-[#111] text-[#666] hover:text-[#8bcf16]"
                  onClick={() => saveAndPublish()}
                  disabled={saving || product.published}
                >
                  {product.published ? "Publicado" : "Salvar e publicar"}
                </button>
                <button
                  type="button"
                  className="font-mono text-[0.6rem] uppercase font-bold py-2 px-3 border border-[#111] text-[#666] hover:text-[#8bcf16]"
                  onClick={() => saveDraft()}
                  disabled={saving}
                >
                  Salvar rascunho
                </button>
                <button
                  type="button"
                  className="font-mono text-[0.6rem] uppercase font-bold py-2 px-3 border border-[#dc2626]/40 text-[#dc2626]"
                  onClick={() => archiveProduct()}
                  disabled={saving}
                >
                  Arquivar
                </button>
                {!isNew && (
                  <button
                    type="button"
                    className="font-mono text-[0.6rem] uppercase font-bold py-2 px-3 border border-[#111] text-[#666] hover:text-[#8bcf16]"
                    onClick={duplicateProduct}
                    disabled={saving}
                  >
                    Duplicar
                  </button>
                )}
              </>
            )}
            <Link href="/products" className="font-mono text-[0.65rem] uppercase text-[#666] underline py-2 px-1">
              Voltar
            </Link>
          </div>
        </div>

        {/* Section navigation */}
        <nav className="mt-4 border-t border-[#111] pt-4 overflow-x-auto" aria-label="Seções do formulário">
          <ul className="flex gap-1 min-w-max" role="tablist">
            {SECTIONS.map((section) => (
              <li key={section.id} role="presentation">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeSection === section.id}
                  aria-controls={`panel-${section.id}`}
                  id={`tab-${section.id}`}
                  className={`flex items-center gap-2 px-4 py-2 rounded font-mono text-[0.6rem] uppercase font-bold transition-colors ${
                    activeSection === section.id
                      ? "bg-[#8bcf16] text-black"
                      : "text-[#666] hover:text-white hover:bg-[#111]"
                  }`}
                  onClick={() => setActiveSection(section.id)}
                >
                  <section.icon size={14} strokeWidth={2} />
                  <span>{section.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {error && <p role="alert" className="font-mono text-xs text-[#dc2626] mb-4">{error}</p>}
      {isDirty && !saving && (
        <div className="admin-notice admin-notice--warn mb-4" role="status">
          Alterações não salvas. Use "Salvar rascunho" ou "Salvar e publicar".
        </div>
      )}

      <form className="grid gap-8 max-w-5xl" onSubmit={(e) => { e.preventDefault(); saveDraft(); }}>
        {/* Section: Fotos */}
        <section id="panel-photos" role="tabpanel" aria-labelledby="tab-photos" hidden={activeSection !== "photos"} className="border border-[#111] bg-[#0a0a0a] p-6 grid gap-4 animate-in fade-in-0 duration-200">
          <h2 className="font-display font-black text-lg text-white uppercase">Fotos e galeria</h2>
          <ImageUploader
            multiple
            aspectRatio={4 / 3}
            targetWidth={1920}
            quality={0.82}
            label="Adicionar fotos do produto"
            onUpload={handleImageUpload}
            currentImage={images[mainImageIndex] ? { uploadId: images[mainImageIndex].uploadId!, url: images[mainImageIndex].url } : null}
          />
          {images.length > 0 && (
            <div className="grid gap-2">
              <p className="font-mono text-xs text-[#666]">Arraste para reordenar. A primeira é a principal.</p>
              <ul className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {images.map((img, idx) => (
                  <li key={img.id} className={`relative border border-[#111] bg-[#0a0a0a] overflow-hidden ${img.main ? "border-[#8bcf16]" : ""}`}>
                    <div className="aspect-[4/3] overflow-hidden">
                      <img src={img.url} alt={img.alt} className="w-full h-full object-cover" />
                    </div>
                    <div className="p-2 flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-white">#{idx + 1}</span>
                      <div className="flex gap-1">
                        {!img.main && (
                          <button type="button" className="btn-secondary btn-sm px-2 py-1" onClick={() => setMainImage(idx)} title="Definir principal">
                            <Star size={12} strokeWidth={2} className="text-[#8bcf16]" />
                          </button>
                        )}
                        <button type="button" className="btn-secondary btn-sm px-2 py-1" onClick={() => reorderImage(idx, -1)} disabled={idx === 0} title="Subir">
                          <ArrowUp size={12} strokeWidth={2} />
                        </button>
                        <button type="button" className="btn-secondary btn-sm px-2 py-1" onClick={() => reorderImage(idx, 1)} disabled={idx === images.length - 1} title="Descer">
                          <ArrowDown size={12} strokeWidth={2} />
                        </button>
                        <button type="button" className="btn-secondary btn-sm px-2 py-1 text-[#dc2626] hover:bg-[#dc2626]/10" onClick={() => removeImage(idx)} title="Excluir">
                          <Trash2 size={12} strokeWidth={2} />
                        </button>
                      </div>
                    </div>
                    {img.main && <span className="absolute top-2 left-2 badge badge-secondary">Principal</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Section: Informações básicas */}
        <section id="panel-basic" role="tabpanel" aria-labelledby="tab-basic" hidden={activeSection !== "basic"} className="border border-[#111] bg-[#0a0a0a] p-6 grid gap-4 animate-in fade-in-0 duration-200">
          <h2 className="font-display font-black text-lg text-white uppercase">Informações básicas</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Nome" required error={!product.name && isDirty ? "Obrigatório" : undefined}>
              <Input value={product.name} onChange={(v) => updateProduct({ name: v })} placeholder="Nome do produto" maxLength={160} />
            </Field>
            <Field label="Slug">
              <Input value={product.slug} onChange={(v) => updateProduct({ slug: v })} placeholder="auto se vazio" maxLength={160} />
            </Field>
          </div>
          <Field label="Descrição curta">
            <Input value={product.shortDescription} onChange={(v) => updateProduct({ shortDescription: v })} placeholder="Resumo para listagens" maxLength={500} />
          </Field>
          <Field label="Descrição detalhada">
            <Textarea value={product.description} onChange={(v) => updateProduct({ description: v })} rows={6} placeholder="Descrição completa do produto" />
          </Field>
          <div className="grid md:grid-cols-3 gap-4">
            <Field label="Categoria" required>
              <Select
                value={product.categoryId}
                onChange={(v) => updateProduct({ categoryId: v })}
                options={cats.map((c) => ({ value: c.id, label: c.name }))}
                placeholder="Selecione"
              />
            </Field>
            <Field label="Marca">
              <Select
                value={product.brandId}
                onChange={(v) => updateProduct({ brandId: v })}
                options={[{ value: "", label: "Sem marca" }, ...brands.map((b) => ({ value: b.id, label: b.name }))]}
                placeholder="Selecione"
              />
            </Field>
            <Field label="Tags (vírgula)">
              <Input value={product.tags} onChange={(v) => updateProduct({ tags: v })} placeholder="tag1, tag2, tag3" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-6 text-sm font-bold">
            <label className="flex items-center gap-3">
              <input type="checkbox" checked={product.published} onChange={(e) => updateProduct({ published: e.target.checked })} className="accent-[#8bcf16]" /> Publicado
            </label>
            <label className="flex items-center gap-3">
              <input type="checkbox" checked={product.featured} onChange={(e) => updateProduct({ featured: e.target.checked })} className="accent-[#8bcf16]" /> Destaque
            </label>
            <label className="flex items-center gap-3">
              <input type="checkbox" checked={product.ageRestricted} onChange={(e) => updateProduct({ ageRestricted: e.target.checked })} className="accent-[#8bcf16]" /> 18+
            </label>
          </div>
        </section>

        {/* Section: Preço e promoções */}
        <section id="panel-pricing" role="tabpanel" aria-labelledby="tab-pricing" hidden={activeSection !== "pricing"} className="border border-[#111] bg-[#0a0a0a] p-6 grid gap-4 animate-in fade-in-0 duration-200">
          <h2 className="font-display font-black text-lg text-white uppercase">Preço e promoções</h2>
          <p className="text-[#666] font-mono text-[0.6rem]">Preço/estoque residem em variantes. Edição abaixo reflete a variante principal.</p>
          {variants.length === 0 ? (
            <p className="text-[#666] font-mono text-xs">Nenhuma variante. A primeira é criada ao salvar.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Nome</th>
                    <th>Preço</th>
                    <th>Promoção</th>
                    <th>Peso (g)</th>
                    <th>Ativa</th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v) => (
                    <tr key={v.id}>
                      <td>
                        <Field label="SKU">
                          <Input value={v.sku} onChange={(val) => updateVariant(v.id, { sku: val })} className="w-full" />
                        </Field>
                      </td>
                      <td>
                        <Field label="Nome">
                          <Input value={v.name} onChange={(val) => updateVariant(v.id, { name: val })} className="w-full" />
                        </Field>
                      </td>
                      <td>
                        <Field label="Preço">
                          <MoneyInput value={v.priceCents ?? 0} onChange={(c) => updateVariant(v.id, { priceCents: c ?? 0 })} />
                        </Field>
                      </td>
                      <td>
                        <Field label="Promoção">
                          <MoneyInput value={v.promoPriceCents ?? 0} onChange={(c) => updateVariant(v.id, { promoPriceCents: c ?? undefined })} />
                        </Field>
                      </td>
                      <td>
                        <Field label="Peso (g)">
                          <Input type="number" min={0} value={v.weightGrams} onChange={(val) => updateVariant(v.id, { weightGrams: parseInt(val) || 0 })} className="w-24" />
                        </Field>
                      </td>
                      <td>
                        <Field label="Ativa">
                          <Checkbox
                            checked={v.active}
                            onChange={(e) => updateVariant(v.id, { active: e.target.checked })}
                            label="Ativa"
                          />
                        </Field>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Section: Estoque */}
        <section id="panel-stock" role="tabpanel" aria-labelledby="tab-stock" hidden={activeSection !== "stock"} className="border border-[#111] bg-[#0a0a0a] p-6 grid gap-4 animate-in fade-in-0 duration-200">
          <h2 className="font-display font-black text-lg text-white uppercase">Estoque</h2>
          <p className="text-[#666] font-mono text-[0.6rem]">Estoque físico, reservado e mínimo por variante.</p>
          {variants.length === 0 ? (
            <p className="text-[#666] font-mono text-xs">Nenhuma variante.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Físico</th>
                    <th>Reservado</th>
                    <th>Disponível</th>
                    <th>Mín.</th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v) => {
                    const inv = v.inventory;
                    const available = inv ? inv.physical - inv.reserved : 0;
                    return (
                      <tr key={v.id}>
                        <td className="font-mono text-xs">{v.sku}</td>
                        <td>
                          <Field label="Físico">
                            <Input type="number" min={0} value={inv?.physical ?? 0} onChange={(val) => updateVariant(v.id, { inventory: { ...inv!, physical: parseInt(val) || 0 } })} className="w-24" />
                          </Field>
                        </td>
                        <td>{inv?.reserved ?? 0}</td>
                        <td className={`${available < 0 ? "text-[#dc2626]" : available === 0 ? "text-[#f59e0b]" : "text-[#4ade80]"} font-bold`}>{available}</td>
                        <td>
                          <Field label="Mín.">
                            <Input type="number" min={0} value={inv?.minQuantity ?? 0} onChange={(val) => updateVariant(v.id, { inventory: { ...inv!, minQuantity: parseInt(val) || 0 } })} className="w-24" />
                          </Field>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Section: Descrição */}
        <section id="panel-description" role="tabpanel" aria-labelledby="tab-description" hidden={activeSection !== "description"} className="border border-[#111] bg-[#0a0a0a] p-6 grid gap-4 animate-in fade-in-0 duration-200">
          <h2 className="font-display font-black text-lg text-white uppercase">Descrição</h2>
          <Field label="Descrição curta">
            <Input value={product.shortDescription} onChange={(v) => updateProduct({ shortDescription: v })} placeholder="Resumo para listagens (máx. 500 chars)" maxLength={500} />
          </Field>
          <Field label="Descrição completa">
            <Textarea value={product.description} onChange={(v) => updateProduct({ description: v })} rows={10} placeholder="Descrição detalhada do produto" />
          </Field>
        </section>

        {/* Section: Especificações Airsoft */}
        <section id="panel-airsoft" role="tabpanel" aria-labelledby="tab-airsoft" hidden={activeSection !== "airsoft"} className="border border-[#111] bg-[#0a0a0a] p-6 grid gap-4 animate-in fade-in-0 duration-200">
          <h2 className="font-display font-black text-lg text-white uppercase">Especificações Airsoft</h2>
          <div className="grid md:grid-cols-3 gap-4">
            <Field label="Condição" required>
              <Select
                value={product.condicao}
                onChange={(v) => updateProduct({ condicao: v as "novo" | "usado" | "seminovo" })}
                options={[
                  { value: "novo", label: "Novo" },
                  { value: "usado", label: "Usado" },
                  { value: "seminovo", label: "Seminovo revisado" },
                ]}
              />
            </Field>
            <Field label={`Estado de conservação ${(product.condicao === "usado" || product.condicao === "seminovo") && <span className="text-[#dc2626]">*</span>}`}>
              <Input value={product.estadoConservacao} onChange={(v) => updateProduct({ estadoConservacao: v })} aria-required={product.condicao !== "novo"} placeholder="Ex: Impecável, com marcas de uso leves, etc." />
            </Field>
            <Field label="Garantia (dias)">
              <Input type="number" min={0} max={3650} value={product.garantiaDias} onChange={(v) => updateProduct({ garantiaDias: parseInt(v) || 0 })} />
            </Field>
          </div>
          <Field label="Acessórios incluídos">
            <Textarea value={product.acessoriosIncluidos} onChange={(v) => updateProduct({ acessoriosIncluidos: v })} rows={3} placeholder="Lista de acessórios que acompanham o produto" />
          </Field>
        </section>

        {/* Section: Ficha técnica */}
        <section id="panel-specs" role="tabpanel" aria-labelledby="tab-specs" hidden={activeSection !== "specs"} className="border border-[#111] bg-[#0a0a0a] p-6 grid gap-4 animate-in fade-in-0 duration-200">
          <h2 className="font-display font-black text-lg text-white uppercase">Ficha técnica</h2>
          <p className="text-[#666] font-mono text-[0.6rem]">Campos chave/valor livres. Sugestões por categoria podem ser adicionadas no futuro.</p>
          <div className="flex flex-wrap gap-2 items-end">
            <Field style={{ flex: 1, minWidth: 200 }} label="Chave">
              <Input id="specKey" placeholder="Ex: calibre, fps, energia" />
            </Field>
            <Field style={{ flex: 1, minWidth: 200 }} label="Valor">
              <Input id="specValue" placeholder="Ex: 6mm, 380, AEG" />
            </Field>
            <button type="button" className="btn-primary px-4 py-2 self-end" onClick={() => {
              const keyInput = document.getElementById("specKey") as HTMLInputElement;
              const valInput = document.getElementById("specValue") as HTMLInputElement;
              if (keyInput?.value && valInput?.value) {
                addSpec(keyInput.value, keyInput.value, valInput.value);
                keyInput.value = "";
                valInput.value = "";
              }
            }}>
              Adicionar
            </button>
          </div>
          {specs.length === 0 ? (
            <p className="text-[#666] font-mono text-xs">Nenhum campo técnico.</p>
          ) : (
            <ul className="grid gap-1">
              {specs.map((s) => (
                <li key={s.id} className="flex justify-between border border-[#111] p-2 font-mono text-xs">
                  <span>{s.label}: <span className="text-white">{s.value}</span></span>
                  <button type="button" className="text-[#dc2626] underline" onClick={() => removeSpec(s.id)}>Remover</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Section: Vídeo */}
        <section id="panel-video" role="tabpanel" aria-labelledby="tab-video" hidden={activeSection !== "video"} className="border border-[#111] bg-[#0a0a0a] p-6 grid gap-4 animate-in fade-in-0 duration-200">
          <h2 className="font-display font-black text-lg text-white uppercase">Vídeo (YouTube/Vimeo/MP4)</h2>
          <div className="flex flex-wrap gap-2 items-end">
            <Field style={{ flex: 1, minWidth: 280 }} label="URL">
              <Input id="videoUrl" placeholder="https://..." />
            </Field>
            <Field label="Tipo">
              <Select
                id="videoType"
                value={product.videos[0]?.type ?? "youtube"}
                onChange={(v) => {}}
                options={[
                  { value: "youtube", label: "YouTube" },
                  { value: "vimeo", label: "Vimeo" },
                  { value: "mp4", label: "MP4" },
                  { value: "external", label: "Externo" },
                ]}
              />
            </Field>
            <button type="button" className="btn-primary px-4 py-2" onClick={() => {
              const urlInput = document.getElementById("videoUrl") as HTMLInputElement;
              const typeInput = document.getElementById("videoType") as HTMLSelectElement;
              if (urlInput?.value) {
                addVideo(urlInput.value, typeInput?.value ?? "youtube");
                urlInput.value = "";
              }
            }}>
              Adicionar
            </button>
          </div>
          {product.videos.length === 0 ? (
            <p className="text-[#666] font-mono text-xs">Nenhum vídeo.</p>
          ) : (
            <ul className="grid gap-2">
              {product.videos.map((v, i) => (
                <li key={i} className="flex items-center justify-between border border-[#111] p-2 font-mono text-xs">
                  <span className="truncate mr-2"><span className="text-[#8bcf16]">[{v.type}]</span> {v.url}</span>
                  <button type="button" className="text-[#dc2626] underline" onClick={() => removeVideo(i)}>Remover</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Section: SEO */}
        <section id="panel-seo" role="tabpanel" aria-labelledby="tab-seo" hidden={activeSection !== "seo"} className="border border-[#111] bg-[#0a0a0a] p-6 grid gap-4 animate-in fade-in-0 duration-200">
          <h2 className="font-display font-black text-lg text-white uppercase">SEO</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="SEO Title">
              <Input value={product.seoTitle} onChange={(v) => updateProduct({ seoTitle: v })} maxLength={200} placeholder="Máx. 200 caracteres" />
            </Field>
            <Field label="SEO Description">
              <Input value={product.seoDescription} onChange={(v) => updateProduct({ seoDescription: v })} maxLength={320} placeholder="Máx. 320 caracteres" />
            </Field>
          </div>
        </section>

        {/* Section: Histórico */}
        <section id="panel-history" role="tabpanel" aria-labelledby="tab-history" hidden={activeSection !== "history"} className="border border-[#111] bg-[#0a0a0a] p-6 grid gap-4 animate-in fade-in-0 duration-200">
          <h2 className="font-display font-black text-lg text-white uppercase">Histórico de alterações (append-only)</h2>
          {history.length === 0 ? (
            <p className="text-[#666] font-mono text-xs">Sem histórico registrado.</p>
          ) : (
            <ul className="grid gap-2 max-h-80 overflow-auto">
              {history.map((h) => (
                <li key={h.id} className="border border-[#111] p-2 font-mono text-[0.65rem]">
                  <span className="text-white">{h.field}</span>
                  <span className="text-[#666] ml-2">{new Date(h.createdAt).toLocaleString("pt-BR")}</span>
                  {h.actorLabel ? ` · ${h.actorLabel}` : ""}
                  <div className="text-[#999] break-all mt-1">antes: {h.beforeValue ?? "—"} → depois: {h.afterValue ?? "—"}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Sticky bottom actions for mobile */}
        <div className="fixed bottom-0 left-0 right-0 md:hidden bg-black/95 backdrop-blur-sm border-t border-[#111] p-4 flex gap-2 z-50">
          <button type="button" className="flex-1 btn-primary py-3" onClick={saveDraft} disabled={saving}>
            {saving ? "Salvando…" : "Salvar rascunho"}
          </button>
          <button type="button" className="flex-1 btn-primary py-3 bg-[#8bcf16] hover:bg-[#a6f51b]" onClick={saveAndPublish} disabled={saving || product.published}>
            {product.published ? "Publicado" : "Publicar"}
          </button>
        </div>
      </form>

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={open}
        onClose={close}
        onConfirm={onConfirm}
        title={title}
        message={message}
        variant={variant}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        loading={confirmLoading}
      />
    </main>
  );
}
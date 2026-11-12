import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const PRODUCTION_ADMIN_URL = "https://airsoftamericana-admin-henna.vercel.app";
const DEVELOPMENT_ADMIN_URL = "http://localhost:3001";

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/") && parsed.pathname !== "/") {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function validateUrlForEnvironment(url: string, env: "development" | "preview" | "production"): string {
  try {
    const parsed = new URL(url);

    // No credentials, query string, or fragment
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error("URL contains credentials, query string, or fragment");
    }

    // Normalize trailing slash
    if (parsed.pathname.endsWith("/") && parsed.pathname !== "/") {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    switch (env) {
      case "development": {
        if (parsed.protocol !== "http:") {
          throw new Error("Development requires HTTP");
        }
        if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
          throw new Error("Development requires localhost");
        }
        const result = parsed.toString();
        return result.endsWith("/") ? result.slice(0, -1) : result;
      }
      case "preview": {
        if (parsed.protocol !== "https:") {
          throw new Error("Preview requires HTTPS");
        }
        if (parsed.hostname !== "airsoftamericana-admin-preview.vercel.app") {
          throw new Error("Preview URL hostname mismatch");
        }
        const result = parsed.toString();
        return result.endsWith("/") ? result.slice(0, -1) : result;
      }
      case "production": {
        if (parsed.protocol !== "https:") {
          throw new Error("Production requires HTTPS");
        }
        if (parsed.hostname !== "airsoftamericana-admin-henna.vercel.app") {
          throw new Error("Production URL hostname mismatch");
        }
        const result = parsed.toString();
        return result.endsWith("/") ? result.slice(0, -1) : result;
      }
    }
  } catch (e) {
    throw new Error(`Invalid URL for ${env}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function getAdminUrl(): string {
  // These run at request time, not build time
  const vercelEnv = process.env.VERCEL_ENV;
  const nodeEnv = process.env.NODE_ENV;

  // Determine environment FIRST
  let env: "development" | "preview" | "production" | null = null;

  if (vercelEnv === "development" || (vercelEnv === undefined && nodeEnv === "development")) {
    env = "development";
  } else if (vercelEnv === "preview") {
    env = "preview";
  } else if (vercelEnv === "production" || nodeEnv === "production") {
    env = "production";
  }

  if (!env) {
    throw new Error("Ambiente não reconhecido: VERCEL_ENV ou NODE_ENV não definidos.");
  }

  switch (env) {
    case "development": {
      // Development: only localhost allowed
      return DEVELOPMENT_ADMIN_URL;
    }
    case "preview": {
      // Preview: MUST use NEXT_PUBLIC_ADMIN_URL_PREVIEW
      const previewUrl = process.env.NEXT_PUBLIC_ADMIN_URL_PREVIEW;
      if (!previewUrl) {
        throw new Error("Preview requer NEXT_PUBLIC_ADMIN_URL_PREVIEW configurada.");
      }
      return validateUrlForEnvironment(previewUrl, "preview");
    }
    case "production": {
      // Production: MUST use NEXT_PUBLIC_ADMIN_URL
      const prodUrl = process.env.NEXT_PUBLIC_ADMIN_URL;
      if (!prodUrl) {
        throw new Error("Produção requer NEXT_PUBLIC_ADMIN_URL configurada.");
      }
      return validateUrlForEnvironment(prodUrl, "production");
    }
  }
}

export default function AdminGatePage() {
  const adminUrl = getAdminUrl();
  redirect(`${adminUrl}/login`);
}
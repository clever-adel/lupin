import { createRequestHandler } from "react-router";
import { EDGE_KEY_HEADER, edgeKey } from "../app/lib/edge";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: { env: Env; ctx: ExecutionContext };
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

/**
 * The browser only ever talks to this origin. /api/* is forwarded to the Spring Boot backend so that
 * auth cookies are first-party and production needs no CORS.
 */
async function proxyApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.set("X-Forwarded-Host", url.host);
  headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
  // Whatever the browser sent for these is discarded: only this Worker may say who the client is.
  headers.delete("Forwarded");
  headers.delete("X-Forwarded-For");
  headers.delete(EDGE_KEY_HEADER);
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp) headers.set("X-Forwarded-For", clientIp);
  const key = edgeKey(env);
  if (key) headers.set(EDGE_KEY_HEADER, key);
  headers.delete("host");

  try {
    return await fetch(new URL(url.pathname + url.search, env.API_ORIGIN), {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    });
  } catch {
    return Response.json(
      { code: "API_UNAVAILABLE", message: "The store is not reachable right now. Please try again." },
      { status: 502 },
    );
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  // The Content-Security-Policy is set in app/entry.server.tsx, which knows the per-request script nonce.
};

const IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
]);
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_BATCH_MAX_BYTES = 50 * 1024 * 1024;
const IMAGE_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|avif)$/;

type MediaEnv = Env & { MEDIA_BUCKET: R2Bucket };

function cookieValue(request: Request, name: string): string | undefined {
  const cookie = request.headers.get("Cookie") ?? "";
  const value = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!value) return undefined;
  try { return decodeURIComponent(value); } catch { return undefined; }
}

function csrfValid(request: Request): boolean {
  const url = new URL(request.url);
  return request.headers.get("Origin") === url.origin
    && !!cookieValue(request, "XSRF-TOKEN")
    && cookieValue(request, "XSRF-TOKEN") === request.headers.get("X-XSRF-TOKEN");
}

async function authorizeAdmin(request: Request, env: Env): Promise<Response | null> {
  if (!csrfValid(request)) return Response.json({ message: "Refresh the page and try again." }, { status: 403 });
  const cookie = request.headers.get("Cookie");
  if (!cookie) return Response.json({ message: "Please sign in again." }, { status: 401 });
  const headers = new Headers({ Accept: "application/json", Cookie: cookie });
  const key = edgeKey(env);
  if (key) headers.set(EDGE_KEY_HEADER, key);
  try {
    const response = await fetch(new URL("/api/v1/auth/me", env.API_ORIGIN), { headers, redirect: "manual" });
    if (!response.ok) return Response.json({ message: "Please sign in again." }, { status: 401 });
    const user = await response.json() as { roles?: string[] };
    if (!user.roles?.some((role) => role === "ADMIN" || role === "OWNER")) {
      return Response.json({ message: "You are not allowed to manage product photos." }, { status: 403 });
    }
    return null;
  } catch {
    return Response.json({ message: "The store is not reachable right now." }, { status: 503 });
  }
}

function imageSignatureMatches(type: string, bytes: Uint8Array): boolean {
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes[0] === 0x89 && String.fromCharCode(...bytes.slice(1, 4)) === "PNG";
  if (type === "image/webp") return String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (type === "image/avif") return String.fromCharCode(...bytes.slice(4, 12)).startsWith("ftypavif")
    || String.fromCharCode(...bytes.slice(4, 12)).startsWith("ftypavis");
  return false;
}

async function uploadImages(request: Request, env: Env): Promise<Response> {
  const denied = await authorizeAdmin(request, env);
  if (denied) return denied;
  if (!("MEDIA_BUCKET" in env)) return Response.json({ message: "Image storage is not enabled yet." }, { status: 503 });
  const declaredSize = Number(request.headers.get("Content-Length") ?? 0);
  if (declaredSize > IMAGE_BATCH_MAX_BYTES) {
    return Response.json({ message: "The selected photos are too large. Choose fewer or smaller files." }, { status: 413 });
  }
  let form: FormData;
  try { form = await request.formData(); } catch {
    return Response.json({ message: "Choose valid image files and try again." }, { status: 400 });
  }
  const files = form.getAll("files").filter((value): value is File => value instanceof File);
  if (!files.length || files.length > 10) {
    return Response.json({ message: "Choose between 1 and 10 photos." }, { status: 400 });
  }
  if (files.some((file) => file.size === 0 || file.size > IMAGE_MAX_BYTES)) {
    return Response.json({ message: "Each photo must be smaller than 10 MB." }, { status: 413 });
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > IMAGE_BATCH_MAX_BYTES) {
    return Response.json({ message: "The selected photos are too large. Choose fewer or smaller files." }, { status: 413 });
  }
  const prepared: { file: File; type: string; extension: string }[] = [];
  for (const file of files) {
    const extension = IMAGE_TYPES.get(file.type);
    if (!extension) return Response.json({ message: "Use JPG, PNG, WebP, or AVIF photos." }, { status: 415 });
    const header = await file.slice(0, 16).arrayBuffer();
    if (!imageSignatureMatches(file.type, new Uint8Array(header))) {
      return Response.json({ message: "One of the selected files is not a valid image." }, { status: 415 });
    }
    prepared.push({ file, type: file.type, extension });
  }
  const bucket = (env as MediaEnv).MEDIA_BUCKET;
  const saved: string[] = [];
  const images: { publicId: string; url: string }[] = [];
  try {
    for (const item of prepared) {
      const key = `${crypto.randomUUID()}.${item.extension}`;
      await bucket.put(key, item.file.stream(), {
        httpMetadata: { contentType: item.type, cacheControl: "public, max-age=31536000, immutable" },
      });
      saved.push(key);
      images.push({ publicId: key, url: `/media/${key}` });
    }
  } catch {
    await Promise.allSettled(saved.map((key) => bucket.delete(key)));
    return Response.json({ message: "Could not save the photos. Try again." }, { status: 502 });
  }
  return Response.json(images, { headers: { "Cache-Control": "no-store" } });
}

async function serveImage(request: Request, env: Env, key: string): Promise<Response> {
  if (!IMAGE_KEY.test(key) || !("MEDIA_BUCKET" in env)) return new Response("Not found", { status: 404 });
  const object = await (env as MediaEnv).MEDIA_BUCKET.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

async function deleteImage(request: Request, env: Env, key: string): Promise<Response> {
  const denied = await authorizeAdmin(request, env);
  if (denied) return denied;
  if (!IMAGE_KEY.test(key) || !("MEDIA_BUCKET" in env)) return new Response(null, { status: 404 });
  await (env as MediaEnv).MEDIA_BUCKET.delete(key);
  return new Response(null, { status: 204 });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname, hostname } = new URL(request.url);
    // One address for the store: www.lupinwear.store permanently redirects to lupinwear.store, so
    // cookies, search engines and shared links all agree on a single origin.
    if (hostname.startsWith("www.")) {
      const target = new URL(request.url);
      target.hostname = hostname.slice(4);
      return Response.redirect(target.toString(), 301);
    }
    if (pathname.startsWith("/api/")) {
      return proxyApi(request, env);
    }
    if (pathname === "/media/upload" && request.method === "POST") {
      return uploadImages(request, env);
    }
    if (pathname.startsWith("/media/")) {
      const key = pathname.slice("/media/".length);
      if (request.method === "GET" || request.method === "HEAD") return serveImage(request, env, key);
      if (request.method === "DELETE") return deleteImage(request, env, key);
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD, DELETE" } });
    }
    const response = await requestHandler(request, { cloudflare: { env, ctx } });
    if (!response.headers.get("Content-Type")?.includes("text/html")) {
      return response;
    }
    const secured = new Response(response.body, response);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      secured.headers.set(name, value);
    }
    if (new URL(request.url).protocol === "https:") {
      secured.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    return secured;
  },
} satisfies ExportedHandler<Env>;

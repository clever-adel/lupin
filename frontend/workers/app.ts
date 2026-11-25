import { createRequestHandler } from "react-router";
import { EDGE_KEY_HEADER, edgeKey, httpsRedirect } from "../app/lib/edge";
import { isPhotoWidth, PHOTO_WIDTHS, sizedKey } from "../app/lib/photo-sizes";

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

/** Staff only. Changes also need the CSRF check; reads do not (browsers send no Origin on same-origin GETs). */
async function authorizeAdmin(request: Request, env: Env, { read = false } = {}): Promise<Response | null> {
  if (!read && !csrfValid(request)) return Response.json({ message: "Refresh the page and try again." }, { status: 403 });
  const cookie = request.headers.get("Cookie");
  if (!cookie) return Response.json({ message: "Please sign in again." }, { status: 401 });
  const headers = new Headers({ Accept: "application/json", Cookie: cookie });
  const key = edgeKey(env);
  if (key) headers.set(EDGE_KEY_HEADER, key);
  try {
    const response = await fetch(new URL("/api/v1/auth/me", env.API_ORIGIN), { headers, redirect: "manual" });
    if (!response.ok) return Response.json({ message: "Please sign in again." }, { status: 401 });
    const user = await response.json() as { roles?: string[]; twoFactor?: string };
    if (!user.roles?.some((role) => role === "ADMIN" || role === "OWNER")) {
      return Response.json({ message: "You are not allowed to manage product photos." }, { status: 403 });
    }
    // Same rule as the dashboard API: staff sign-ins count only after the authenticator-app code.
    if (user.twoFactor !== "ON") {
      return Response.json({ message: "Confirm your sign-in with the code from your authenticator app." }, { status: 403 });
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

/**
 * /media/<key> is the photo as uploaded; /media/<key>?w=<width> is its WebP copy at that width, or the
 * original while no copy exists yet (answered with a short cache, so the copy is picked up once made).
 */
async function serveImage(request: Request, env: Env, key: string): Promise<Response> {
  if (!IMAGE_KEY.test(key) || !("MEDIA_BUCKET" in env)) return new Response("Not found", { status: 404 });
  const bucket = (env as MediaEnv).MEDIA_BUCKET;
  const width = Number(new URL(request.url).searchParams.get("w"));
  const sized = isPhotoWidth(width) ? await bucket.get(sizedKey(key, width)) : null;
  const object = sized ?? await bucket.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  const fallback = isPhotoWidth(width) && !sized;
  headers.set("Cache-Control", fallback ? "public, max-age=600" : "public, max-age=31536000, immutable");
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

async function deleteImage(request: Request, env: Env, key: string): Promise<Response> {
  const denied = await authorizeAdmin(request, env);
  if (denied) return denied;
  if (!IMAGE_KEY.test(key) || !("MEDIA_BUCKET" in env)) return new Response(null, { status: 404 });
  await (env as MediaEnv).MEDIA_BUCKET.delete([key, ...PHOTO_WIDTHS.map((w) => sizedKey(key, w))]);
  return new Response(null, { status: 204 });
}

const SIZED_MAX_BYTES = 3 * 1024 * 1024;

/** Stores the WebP copies of one uploaded photo: form fields w320, w480, … one file each, all required. */
async function saveImageSizes(request: Request, env: Env, key: string): Promise<Response> {
  const denied = await authorizeAdmin(request, env);
  if (denied) return denied;
  if (!IMAGE_KEY.test(key) || !("MEDIA_BUCKET" in env)) return Response.json({ message: "Photo not found." }, { status: 404 });
  const bucket = (env as MediaEnv).MEDIA_BUCKET;
  if (!(await bucket.head(key))) return Response.json({ message: "Photo not found." }, { status: 404 });
  let form: FormData;
  try { form = await request.formData(); } catch {
    return Response.json({ message: "Send the photo sizes as a form." }, { status: 400 });
  }
  const copies: { width: (typeof PHOTO_WIDTHS)[number]; file: File }[] = [];
  for (const width of PHOTO_WIDTHS) {
    const file = form.get(`w${width}`);
    if (!(file instanceof File) || file.type !== "image/webp" || file.size === 0 || file.size > SIZED_MAX_BYTES) {
      return Response.json({ message: `The ${width}px copy is missing or not a WebP image.` }, { status: 400 });
    }
    if (!imageSignatureMatches("image/webp", new Uint8Array(await file.slice(0, 16).arrayBuffer()))) {
      return Response.json({ message: `The ${width}px copy is not a valid WebP image.` }, { status: 415 });
    }
    copies.push({ width, file });
  }
  await Promise.all(copies.map(({ width, file }) => bucket.put(sizedKey(key, width), file.stream(), {
    httpMetadata: { contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable" },
  })));
  return new Response(null, { status: 204 });
}

/** Uploaded photos that do not have their phone-size copies yet (photos from before copies were made). */
async function imagesWithoutSizes(request: Request, env: Env): Promise<Response> {
  const denied = await authorizeAdmin(request, env, { read: true });
  if (denied) return denied;
  if (!("MEDIA_BUCKET" in env)) return Response.json([]);
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await (env as MediaEnv).MEDIA_BUCKET.list({ cursor, limit: 1000 });
    keys.push(...page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const present = new Set(keys);
  const missing = keys.filter((key) => IMAGE_KEY.test(key) && PHOTO_WIDTHS.some((w) => !present.has(sizedKey(key, w))));
  return Response.json(missing, { headers: { "Cache-Control": "no-store" } });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname, hostname } = new URL(request.url);
    // HTTPS only. Plain-HTTP requests are sent to the same address over HTTPS (308 keeps the method and
    // body), so nothing, cookies or passwords included, travels unencrypted even if the Cloudflare
    // "Always Use HTTPS" setting is ever switched off. Local development runs on plain http.
    const secure = httpsRedirect(request.url);
    if (secure) return Response.redirect(secure, 308);
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
    if (pathname === "/media/without-sizes" && request.method === "GET") {
      return imagesWithoutSizes(request, env);
    }
    if (pathname.startsWith("/media/") && pathname.endsWith("/sizes") && request.method === "POST") {
      return saveImageSizes(request, env, pathname.slice("/media/".length, -"/sizes".length));
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

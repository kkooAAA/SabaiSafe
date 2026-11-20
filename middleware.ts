import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { isAiRoute, isLimited, rateLimit } from "./lib/rate-limit";

const intl = createIntlMiddleware(routing);
const ADMIN_MAX_FAILS = 10;

// Vercel sets x-real-ip itself; x-forwarded-for's first entry can be spoofed off-platform.
export function clientIp(req: Request) {
  return (
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ||
    "unknown"
  );
}

export function isAdminPath(pathname: string) {
  return /^\/api\/admin(\/|$)/.test(pathname) || /^\/(en|zh)\/admin(\/|$)/.test(pathname);
}

export function envLimit(value: string | undefined, fallback: number) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

function errorResponse(isApi: boolean, status: number, code: string, message: string, headers?: HeadersInit) {
  return isApi
    ? NextResponse.json({ error: { code, message } }, { status, headers })
    : new NextResponse(message, { status, headers });
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function parseBasicAuth(header: string | null): { user: string; pass: string } | null {
  if (!header) return null;
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) return null;
  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    return null;
  }
  const i = decoded.indexOf(":");
  if (i < 0) return null;
  return { user: decoded.slice(0, i), pass: decoded.slice(i + 1) };
}

function checkAdmin(req: NextRequest, isApi: boolean): NextResponse | null {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return errorResponse(isApi, 503, "unavailable", "Admin disabled: set ADMIN_PASSWORD");
  // Throttle check comes BEFORE the password compare, so a locked-out IP can't keep guessing.
  const failKey = `admin-fail:${clientIp(req)}`;
  if (isLimited(failKey, ADMIN_MAX_FAILS)) {
    return errorResponse(isApi, 429, "rate_limited", "Too many failed attempts. Please wait a minute.");
  }
  const creds = parseBasicAuth(req.headers.get("authorization"));
  if (creds && creds.user === "admin" && safeEqual(creds.pass, password)) return null;
  if (creds) rateLimit(failKey, ADMIN_MAX_FAILS);
  return errorResponse(isApi, 401, "unauthorized", "Authentication required", {
    "WWW-Authenticate": 'Basic realm="SabaiSafe admin"',
  });
}

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (isAdminPath(pathname)) {
    const denied = checkAdmin(req, isApi);
    if (denied) return denied;
  }

  if (isApi) {
    const ai = isAiRoute(pathname);
    const limit = ai
      ? envLimit(process.env.RATE_LIMIT_AI_PER_MIN, 15)
      : envLimit(process.env.RATE_LIMIT_DATA_PER_MIN, 60);
    const r = rateLimit(`${ai ? "ai" : "data"}:${clientIp(req)}`, limit);
    if (!r.ok) {
      return NextResponse.json(
        { error: { code: "rate_limited", message: "Too many requests. Please wait a minute." } },
        { status: 429, headers: { "Retry-After": String(Math.ceil((r.resetAt - Date.now()) / 1000)) } },
      );
    }
    return NextResponse.next();
  }

  return intl(req);
}

export const config = {
  // Double backslash: in a JS string "\\." is a literal dot in the regex (skips files like /favicon.ico).
  matcher: ["/api/:path*", "/((?!api(?:/|$)|_next|_vercel|.*\\..*).*)"],
};

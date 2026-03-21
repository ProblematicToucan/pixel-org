import { HttpError } from "./httpError.js";

const DEFAULT_HEALER_BASE = "https://healer.garamm.dev";

type CachedToken = { token: string; expiresAtMs: number };

let oauthTokenCache: CachedToken | null = null;

/** Clears cached JWT so the next report fetches a fresh token (e.g. after 401 from API). */
function clearHealerTokenCache(): void {
  oauthTokenCache = null;
}

function healerBaseUrl(): string {
  return (process.env.HEALER_BASE_URL ?? DEFAULT_HEALER_BASE).replace(/\/$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches OAuth client-credentials token. Caches until ~5s before `expires_in` TTL, then refreshes.
 * Retries transient token endpoint failures a few times (not auth failures like 401).
 */
async function getHealerBearerToken(): Promise<string | undefined> {
  const clientId = process.env.HEALER_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.HEALER_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return undefined;

  const now = Date.now();
  if (oauthTokenCache && oauthTokenCache.expiresAtMs > now + 5000) {
    return oauthTokenCache.token;
  }

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${healerBaseUrl()}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const bodyText = await res.text();
      if (!res.ok) {
        // Wrong client_id/secret — retrying won't help
        if (res.status === 401 || res.status === 400) {
          console.error("Healer OAuth token request failed:", res.status, bodyText);
          return undefined;
        }
        console.error("Healer OAuth token request failed:", res.status, bodyText);
        if (attempt < maxAttempts) {
          await sleep(200 * attempt);
          continue;
        }
        return undefined;
      }
      let data: { access_token?: string; expires_in?: number };
      try {
        data = JSON.parse(bodyText) as { access_token?: string; expires_in?: number };
      } catch {
        console.error("Healer OAuth response was not JSON");
        if (attempt < maxAttempts) {
          await sleep(200 * attempt);
          continue;
        }
        return undefined;
      }
      if (!data.access_token) {
        console.error("Healer OAuth response missing access_token");
        return undefined;
      }
      const ttlSec = typeof data.expires_in === "number" && data.expires_in > 0 ? data.expires_in : 3600;
      const issuedAt = Date.now();
      oauthTokenCache = {
        token: data.access_token,
        expiresAtMs: issuedAt + ttlSec * 1000,
      };
      return oauthTokenCache.token;
    } catch (e) {
      console.error("Healer OAuth token request error (attempt", attempt, "):", e);
      if (attempt < maxAttempts) {
        await sleep(200 * attempt);
        continue;
      }
      return undefined;
    }
  }
  return undefined;
}

function messageForHealer(err: unknown): string {
  if (err instanceof HttpError && err.cause instanceof Error) return err.cause.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

function stackForHealer(err: unknown): string | undefined {
  if (err instanceof HttpError && err.cause instanceof Error) return err.cause.stack;
  if (err instanceof Error) return err.stack;
  return undefined;
}

/**
 * Fire-and-forget POST /error to the self-healing service when env is configured.
 * Requires HEALER_REPO_SOURCE and HEALER_REPO_BRANCH (git URL + branch to patch).
 */
export function reportErrorToHealer(payload: {
  err: unknown;
  req?: { method: string; path: string };
  kind?: "http" | "unhandledRejection" | "uncaughtException";
}): void {
  const source = process.env.HEALER_REPO_SOURCE?.trim();
  const branch = process.env.HEALER_REPO_BRANCH?.trim();
  if (!source || !branch) return;

  const body = {
    message: messageForHealer(payload.err),
    stack: stackForHealer(payload.err),
    source,
    branch,
    timestamp: new Date().toISOString(),
    metadata: {
      service: "pixel-org-backend",
      kind: payload.kind ?? "http",
      ...(payload.req && {
        method: payload.req.method,
        path: payload.req.path,
      }),
    },
  };

  void (async () => {
    try {
      const url = `${healerBaseUrl()}/error`;
      const payload = JSON.stringify(body);
      const oauthConfigured =
        Boolean(process.env.HEALER_OAUTH_CLIENT_ID?.trim()) &&
        Boolean(process.env.HEALER_OAUTH_CLIENT_SECRET?.trim());

      const postOnce = async (): Promise<Response> => {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        const bearer = await getHealerBearerToken();
        if (bearer) headers.Authorization = `Bearer ${bearer}`;
        return fetch(url, {
          method: "POST",
          headers,
          body: payload,
          signal: AbortSignal.timeout(12_000),
        });
      };

      let res = await postOnce();
      // Stale JWT or clock skew: server returns 401 — drop cache and obtain a new token once.
      if (res.status === 401 && oauthConfigured) {
        clearHealerTokenCache();
        res = await postOnce();
      }

      if (!res.ok) {
        console.error("Healer POST /error failed:", res.status, await res.text());
      }
    } catch (e) {
      console.error("Healer report failed:", e);
    }
  })();
}

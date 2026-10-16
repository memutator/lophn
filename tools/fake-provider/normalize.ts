// 요청 비교와 log에 쓰는 정규화. object key만 정렬하고 array·tool 순서는 건드리지 않는다.

const SECRET_KEYS = new Set([
  "authorization",
  "x-api-key",
  "api-key",
  "api_key",
  "apikey",
  "access_token",
  "refresh_token",
  "id_token",
  "client_secret",
  "password",
  "secret",
  "code_verifier",
  "code",
  "device_code",
]);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export function isSecretKey(name: string): boolean {
  return SECRET_KEYS.has(name.toLowerCase());
}

// log·mismatch 표시용. 인증 값과 secret 필드는 존재만 남긴다.
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (
      const [key, child] of Object.entries(value as Record<string, unknown>)
    ) {
      out[key] = isSecretKey(key) ? { present: true } : redact(child);
    }
    return out;
  }
  return value;
}

export async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// memory로 받은 nonempty secret은 길이와 관계없이 검사한다.
export function secretHits(text: string, secrets: string[]): string[] {
  return secrets.filter((secret) => secret.length > 0 && text.includes(secret));
}

// matcher, OAuth, safe log가 같은 Content-Type 해석을 쓴다.
export function parseRequestBody(type: string, text: string): unknown {
  const media = type.split(";", 1)[0].trim().toLowerCase();
  if (media === "application/x-www-form-urlencoded") {
    return Object.fromEntries(new URLSearchParams(text));
  }
  if (media === "application/json" && text) {
    try {
      return JSON.parse(text);
    } catch {
      // 실패한 JSON도 matcher에는 그대로 넘기되 log에는 원문을 넣지 않는다.
    }
  }
  return text;
}

export function safeBody(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return { omitted: true };
  }
  return redact(value);
}

// vendor 이름 표. 아이콘(svg·CSS)과 갈라 둬서 아이콘을 그리지 않는 곳(폰의 data 층, coding agent 얼굴 고르기)이 이름만 읽는다.

export const VENDORS = [
  "claude",
  "opencode",
  "pi",
  "omp",
  "cursor",
  "copilot",
  "kimi",
  "kiro",
  "antigravity",
  "grok",
  "droid",
  "amp",
  "devin",
  "qwen",
  "qoder",
  "hermes",
  "muse",
  "codebuddy",
  "command-code",
  "prime-agent",
  "mimocode",
  "cline",
  "letta",
  "kilo",
  "anthropic",
  "openai",
  "google",
  "xai",
  "openrouter",
  "groq",
  "deepseek",
  "ollama",
  "mistral",
] as const;

export type Vendor = (typeof VENDORS)[number];

const KNOWN: ReadonlySet<string> = new Set(VENDORS);

/** harness 이름이나 provider 이름으로 아이콘을 고른다. 모르는 이름이면 undefined. */
export function vendorOf(name: string): Vendor | undefined {
  const key = name.toLowerCase().replace(/\s+/g, "-");
  if (KNOWN.has(key)) return key as Vendor;
  if (key === "gemini" || key === "google-gemini") return "google";
  if (key === "google-antigravity") return "antigravity";
  if (key === "opencode-go") return "opencode";
  if (key === "hermes-agent") return "hermes";
  if (key === "claude-code") return "claude";
  if (key === "codex") return "openai";
  return undefined;
}

// provider 아이콘은 harness가 아니다. harness id가 provider 이름과 겹치는 일(예: grok과 xai)을 막는다.
const PROVIDER_VENDORS: ReadonlySet<Vendor> = new Set<Vendor>([
  "anthropic",
  "openai",
  "google",
  "xai",
  "openrouter",
  "groq",
  "deepseek",
  "ollama",
  "mistral",
]);

/**
 * harness id(`claude`, `codex` 등)로 제품 아이콘을 고른다. `vendorOf`는 model provider 이름도
 * 받아 `anthropic` 같은 provider가 섞이므로, harness가 확실한 곳은 이것을 쓴다.
 */
export function harnessVendorOf(harness: string): Vendor | undefined {
  // Codex는 OpenAI 매듭 표지를 쓴다(Codex desktop app도 같다).
  if (harness === "codex") return "openai";
  if (!KNOWN.has(harness)) return undefined;
  const vendor = harness as Vendor;
  return PROVIDER_VENDORS.has(vendor) ? undefined : vendor;
}

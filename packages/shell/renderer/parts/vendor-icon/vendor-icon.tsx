// harness와 provider의 vendor 아이콘. 출처와 license는 LICENSE에 파일별로 적었다.
// 한 색 아이콘은 currentColor라 둘레 글자 색(light·dark)을 따른다.
import { componentMark } from "@lophn/ui/shared";
import amp from "./amp.svg";
import anthropic from "./anthropic.svg";
import antigravity from "./antigravity.svg";
import claude from "./claude.svg";
import cline from "./cline.svg";
import codebuddy from "./codebuddy.svg";
import commandCode from "./command-code.svg";
import copilot from "./copilot.svg";
import cursor from "./cursor.svg";
import deepseek from "./deepseek.svg";
import devin from "./devin.svg";
import droid from "./droid.svg";
import google from "./google.svg";
import grok from "./grok.svg";
import groq from "./groq.svg";
import hermes from "./hermes.svg";
import kilo from "./kilo.svg";
import kimi from "./kimi.svg";
import kiro from "./kiro.svg";
import letta from "./letta.svg";
import mimocode from "./mimocode.svg";
import mistral from "./mistral.svg";
import muse from "./muse.svg";
import ollama from "./ollama.svg";
import omp from "./omp.svg";
import openai from "./openai.svg";
import opencode from "./opencode.svg";
import openrouter from "./openrouter.svg";
import pi from "./pi.svg";
import primeAgent from "./prime-agent.svg";
import qoder from "./qoder.svg";
import qwen from "./qwen.svg";
import xai from "./xai.svg";
import styles from "./vendor-icon.module.css";

const RAW_ICONS = {
  claude,
  opencode,
  pi,
  omp,
  cursor,
  copilot,
  kimi,
  kiro,
  antigravity,
  grok,
  droid,
  amp,
  devin,
  qwen,
  qoder,
  hermes,
  muse,
  codebuddy,
  "command-code": commandCode,
  "prime-agent": primeAgent,
  mimocode,
  cline,
  letta,
  kilo,
  anthropic,
  openai,
  google,
  xai,
  openrouter,
  groq,
  deepseek,
  ollama,
  mistral,
} as const;

export type Vendor = keyof typeof RAW_ICONS;

// svg의 <title>은 native tooltip을 띄운다. 이름은 둘레의 label이 말하니 inline할 때 한 번 뗀다.
const ICONS = Object.fromEntries(
  Object.entries(RAW_ICONS).map(([vendor, svg]) => [
    vendor,
    svg.replace(/<title>[\s\S]*?<\/title>/, ""),
  ]),
) as Record<Vendor, string>;

/** harness 이름이나 provider 이름으로 아이콘을 고른다. 모르는 이름이면 undefined. */
export function vendorOf(name: string): Vendor | undefined {
  const key = name.toLowerCase().replace(/\s+/g, "-");
  if (key in ICONS) return key as Vendor;
  if (key === "gemini" || key === "google-gemini") return "google";
  if (key === "google-antigravity") return "antigravity";
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
  if (!(harness in ICONS)) return undefined;
  const vendor = harness as Vendor;
  return PROVIDER_VENDORS.has(vendor) ? undefined : vendor;
}

export function VendorIcon({
  vendor,
  size = 16,
  label,
}: {
  vendor: Vendor;
  size?: number;
  /** 아이콘만 있고 옆에 이름이 없을 때 읽는 이름. */
  label?: string;
}) {
  return (
    <span
      className={styles.icon}
      style={{ width: size, height: size }}
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      {...componentMark("VendorIcon")}
      dangerouslySetInnerHTML={{ __html: ICONS[vendor] }}
    />
  );
}

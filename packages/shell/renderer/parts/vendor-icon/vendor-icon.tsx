// harness와 provider의 vendor 아이콘. svg는 @lobehub/icons-static-svg 1.95.1(MIT, LICENSE)에서 가져왔다.
// 한 색 아이콘은 currentColor라 둘레 글자 색(light·dark)을 따른다.
import { componentMark } from "@lophn/ui/shared";
import anthropic from "./anthropic.svg";
import claudeCode from "./claude-code.svg";
import codex from "./codex.svg";
import deepseek from "./deepseek.svg";
import geminiCli from "./gemini-cli.svg";
import google from "./google.svg";
import hermes from "./hermes.svg";
import mistral from "./mistral.svg";
import ollama from "./ollama.svg";
import openai from "./openai.svg";
import openclaw from "./openclaw.svg";
import opencode from "./opencode.svg";
import openrouter from "./openrouter.svg";
import pi from "./pi.svg";
import xai from "./xai.svg";
import styles from "./vendor-icon.module.css";

const ICONS = {
  "claude-code": claudeCode,
  codex,
  "gemini-cli": geminiCli,
  opencode,
  pi,
  hermes,
  openclaw,
  anthropic,
  openai,
  google,
  xai,
  openrouter,
  deepseek,
  ollama,
  mistral,
} as const;

export type Vendor = keyof typeof ICONS;

/** harness 이름이나 provider 이름으로 아이콘을 고른다. 모르는 이름이면 undefined. */
export function vendorOf(name: string): Vendor | undefined {
  const key = name.toLowerCase().replace(/\s+/g, "-");
  if (key in ICONS) return key as Vendor;
  if (key === "gemini" || key === "google-gemini") return "google";
  if (key === "hermes-agent") return "hermes";
  return undefined;
}

export function VendorIcon(
  { vendor, size = 16, label }: {
    vendor: Vendor;
    size?: number;
    /** 아이콘만 있고 옆에 이름이 없을 때 읽는 이름. */
    label?: string;
  },
) {
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

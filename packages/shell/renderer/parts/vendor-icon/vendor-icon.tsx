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
import styles from "./vendor-icon.module.css";
import xai from "./xai.svg";
import type { Vendor } from "./vendors.ts";

export { harnessVendorOf, type Vendor, vendorOf } from "./vendors.ts";

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
} as const satisfies Record<Vendor, string>;

// svg의 <title>은 native tooltip을 띄운다. 이름은 둘레의 label이 말하니 inline할 때 한 번 뗀다.
const ICONS = Object.fromEntries(
  Object.entries(RAW_ICONS).map(([vendor, svg]) => [
    vendor,
    svg.replace(/<title>[\s\S]*?<\/title>/, ""),
  ]),
) as Record<Vendor, string>;

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

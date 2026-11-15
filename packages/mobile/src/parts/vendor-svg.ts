// The desktop vendor icons, read as text from their own files (svg-text-transformer.js). Sources and licenses are in
// that folder's LICENSE.
import amp from "../../../shell/renderer/parts/vendor-icon/amp.svg";
import anthropic from "../../../shell/renderer/parts/vendor-icon/anthropic.svg";
import antigravity from "../../../shell/renderer/parts/vendor-icon/antigravity.svg";
import claude from "../../../shell/renderer/parts/vendor-icon/claude.svg";
import cline from "../../../shell/renderer/parts/vendor-icon/cline.svg";
import codebuddy from "../../../shell/renderer/parts/vendor-icon/codebuddy.svg";
import commandCode from "../../../shell/renderer/parts/vendor-icon/command-code.svg";
import copilot from "../../../shell/renderer/parts/vendor-icon/copilot.svg";
import cursor from "../../../shell/renderer/parts/vendor-icon/cursor.svg";
import deepseek from "../../../shell/renderer/parts/vendor-icon/deepseek.svg";
import devin from "../../../shell/renderer/parts/vendor-icon/devin.svg";
import droid from "../../../shell/renderer/parts/vendor-icon/droid.svg";
import google from "../../../shell/renderer/parts/vendor-icon/google.svg";
import grok from "../../../shell/renderer/parts/vendor-icon/grok.svg";
import groq from "../../../shell/renderer/parts/vendor-icon/groq.svg";
import hermes from "../../../shell/renderer/parts/vendor-icon/hermes.svg";
import kilo from "../../../shell/renderer/parts/vendor-icon/kilo.svg";
import kimi from "../../../shell/renderer/parts/vendor-icon/kimi.svg";
import kiro from "../../../shell/renderer/parts/vendor-icon/kiro.svg";
import letta from "../../../shell/renderer/parts/vendor-icon/letta.svg";
import mimocode from "../../../shell/renderer/parts/vendor-icon/mimocode.svg";
import mistral from "../../../shell/renderer/parts/vendor-icon/mistral.svg";
import muse from "../../../shell/renderer/parts/vendor-icon/muse.svg";
import ollama from "../../../shell/renderer/parts/vendor-icon/ollama.svg";
import omp from "../../../shell/renderer/parts/vendor-icon/omp.svg";
import openai from "../../../shell/renderer/parts/vendor-icon/openai.svg";
import opencode from "../../../shell/renderer/parts/vendor-icon/opencode.svg";
import openrouter from "../../../shell/renderer/parts/vendor-icon/openrouter.svg";
import pi from "../../../shell/renderer/parts/vendor-icon/pi.svg";
import primeAgent from "../../../shell/renderer/parts/vendor-icon/prime-agent.svg";
import qoder from "../../../shell/renderer/parts/vendor-icon/qoder.svg";
import qwen from "../../../shell/renderer/parts/vendor-icon/qwen.svg";
import xai from "../../../shell/renderer/parts/vendor-icon/xai.svg";
import type { Vendor } from "../../../shell/renderer/parts/vendor-icon/vendors.ts";

export const VENDOR_SVG = {
  amp,
  anthropic,
  antigravity,
  claude,
  cline,
  codebuddy,
  "command-code": commandCode,
  copilot,
  cursor,
  deepseek,
  devin,
  droid,
  google,
  grok,
  groq,
  hermes,
  kilo,
  kimi,
  kiro,
  letta,
  mimocode,
  mistral,
  muse,
  ollama,
  omp,
  openai,
  opencode,
  openrouter,
  pi,
  "prime-agent": primeAgent,
  qoder,
  qwen,
  xai,
} as const satisfies Record<Vendor, string>;

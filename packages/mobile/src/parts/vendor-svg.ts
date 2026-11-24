// The desktop vendor icons, read as text from their own files (svg-text-transformer.js). Sources and licenses are in
// that folder's LICENSE. Antigravity uses a rasterized PNG of the same SVG because its 11 <filter>/<feGaussianBlur>
// layers inside <mask> crash/misrender in react-native-svg on Android.
import type { ImageSourcePropType } from "react-native";
import amp from "../../../shell/renderer/parts/vendor-icon/amp.svg";
import anthropic from "../../../shell/renderer/parts/vendor-icon/anthropic.svg";
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
import antigravityPng from "./antigravity.png";

export type VendorAsset =
  | { readonly kind: "svg"; readonly xml: string }
  | { readonly kind: "image"; readonly source: ImageSourcePropType };

const svg = (xml: string): VendorAsset => ({ kind: "svg", xml });
const image = (source: ImageSourcePropType): VendorAsset => ({ kind: "image", source });

export const VENDOR_ICON = {
  amp: svg(amp),
  anthropic: svg(anthropic),
  antigravity: image(antigravityPng),
  claude: svg(claude),
  cline: svg(cline),
  codebuddy: svg(codebuddy),
  "command-code": svg(commandCode),
  copilot: svg(copilot),
  cursor: svg(cursor),
  deepseek: svg(deepseek),
  devin: svg(devin),
  droid: svg(droid),
  google: svg(google),
  grok: svg(grok),
  groq: svg(groq),
  hermes: svg(hermes),
  kilo: svg(kilo),
  kimi: svg(kimi),
  kiro: svg(kiro),
  letta: svg(letta),
  mimocode: svg(mimocode),
  mistral: svg(mistral),
  muse: svg(muse),
  ollama: svg(ollama),
  omp: svg(omp),
  openai: svg(openai),
  opencode: svg(opencode),
  openrouter: svg(openrouter),
  pi: svg(pi),
  "prime-agent": svg(primeAgent),
  qoder: svg(qoder),
  qwen: svg(qwen),
  xai: svg(xai),
} as const satisfies Record<Vendor, VendorAsset>;

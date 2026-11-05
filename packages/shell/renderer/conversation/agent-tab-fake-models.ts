// fake source(agent-tab-fake-source.ts)가 쓰는 model 목록. model catalog가 낸 값을 ACP 꼴로 옮겨 고정했다.
// model id는 core와 같이 `<provider id>/<model name>`이고 묶음 id는 provider id다.
import type {
  AcpModel,
  AcpModelAxis,
  AcpModelGroup,
} from "../../../protocol/acp/mod.ts";

const ANTHROPIC = "pvd_01arz3ndektsv4rrffq69g5fa1";
const OPENAI = "pvd_01arz3ndektsv4rrffq69g5fa2";
const XAI = "pvd_01arz3ndektsv4rrffq69g5fa3";
export const CUSTOM_PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fa4";

// effort 값의 id는 contract의 이름이고 표시 이름은 고정이다(very_high는 XHigh).
export const effortLowToMax: AcpModelAxis = {
  id: "effort",
  label: "Effort",
  kind: "choice",
  values: [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "very_high", label: "XHigh" },
    { value: "maximum", label: "Max" },
  ],
};
const effortMinimalToXHigh: AcpModelAxis = {
  id: "effort",
  label: "Effort",
  kind: "choice",
  values: [
    { value: "minimal", label: "Minimal" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "very_high", label: "XHigh" },
  ],
};
const speedStandardFast: AcpModelAxis = {
  id: "speed",
  label: "Speed",
  kind: "choice",
  values: [
    { value: "standard", label: "Standard" },
    { value: "fast", label: "Fast" },
  ],
};
const speedStandardPriority: AcpModelAxis = {
  id: "speed",
  label: "Speed",
  kind: "choice",
  values: [
    { value: "standard", label: "Standard" },
    { value: "priority", label: "Priority" },
  ],
};

function model(
  provider: string,
  name: string,
  axes: readonly AcpModelAxis[] = [],
): AcpModel {
  return { id: `${provider}/${name}`, label: name, axes: [...axes] };
}

export const SONNET = model(ANTHROPIC, "Sonnet 5.5", [effortLowToMax]);
const OPUS = model(ANTHROPIC, "Opus 5.5", [effortLowToMax, speedStandardFast]);
const HAIKU = model(ANTHROPIC, "Haiku 5.5");
const SOL = model(OPENAI, "GPT-6.1 Sol", [
  effortMinimalToXHigh,
  speedStandardPriority,
]);

/** 내장 provider 셋. */
export const BUILT_IN_GROUPS: readonly AcpModelGroup[] = [
  {
    id: ANTHROPIC,
    label: "Anthropic",
    models: [OPUS, SONNET, HAIKU],
  },
  {
    id: OPENAI,
    label: "OpenAI",
    models: [SOL, model(OPENAI, "GPT-6.1 Mini")],
  },
  { id: XAI, label: "xAI", models: [model(XAI, "Grok 4.7")] },
];

// 앞 둘은 provider가 알려 준 이름이고, 마지막은 사람이 정보(effort 포함)를 적은 model이다. 알려 준 이름만 있는
// model은 catalog 항목이 없어 option 축이 없다.
export const CUSTOM_WITH_INFO = "deepseek-v4.1-flash";
export const CUSTOM_GROUP: AcpModelGroup = {
  id: CUSTOM_PROVIDER,
  label: "Local server",
  models: [
    model(CUSTOM_PROVIDER, "llama-3.3-70b"),
    model(CUSTOM_PROVIDER, "qwen-3-coder"),
    model(CUSTOM_PROVIDER, CUSTOM_WITH_INFO, [effortLowToMax]),
  ],
};

/** model을 처음 고를 때의 축 값. */
export const DEFAULT_OPTIONS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  [SONNET.id]: { effort: "medium" },
  [OPUS.id]: { effort: "high", speed: "fast" },
  [SOL.id]: { effort: "very_high", speed: "priority" },
  [`${CUSTOM_PROVIDER}/${CUSTOM_WITH_INFO}`]: { effort: "high" },
};

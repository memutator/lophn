// fake source(agent-tab-fake-source.ts)가 쓰는 model picker 값. model catalog가 낸 값을 그대로 옮겨 고정했다.
import type {
  PickerAxisView,
  PickerModelRef,
  PickerProviderGroup,
} from "./model-picker/types.ts";

const ANTHROPIC = "pvd_01arz3ndektsv4rrffq69g5fa1";
const OPENAI = "pvd_01arz3ndektsv4rrffq69g5fa2";
const XAI = "pvd_01arz3ndektsv4rrffq69g5fa3";

function row(provider: string, modelName: string): PickerModelRef {
  return { provider, modelName };
}

// effort 값의 id는 contract의 이름이고 표시 이름은 고정이다(very_high는 XHigh).
export const effortLowToMax: PickerAxisView = {
  id: "effort",
  label: "Effort",
  values: [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "maximum", label: "Max" },
  ],
};
const effortMinimalToXHigh: PickerAxisView = {
  id: "effort",
  label: "Effort",
  values: [
    { value: "minimal", label: "Minimal" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "very_high", label: "XHigh" },
  ],
};
const speedStandardFast: PickerAxisView = {
  id: "speed",
  label: "Speed",
  values: [
    { value: "standard", label: "Standard" },
    { value: "fast", label: "Fast" },
  ],
};
const speedStandardPriority: PickerAxisView = {
  id: "speed",
  label: "Speed",
  values: [
    { value: "standard", label: "Standard" },
    { value: "priority", label: "Priority" },
  ],
};

/** 고른 model 하나와 그 model의 축·값. */
export interface PickerScenario {
  readonly current: PickerModelRef;
  readonly currentLabel: string;
  readonly axes: readonly PickerAxisView[];
  readonly optionValues: Readonly<Record<string, string>>;
}

export const SONNET: PickerScenario = {
  current: { provider: ANTHROPIC, modelName: "Sonnet 5.5" },
  currentLabel: "Sonnet 5.5",
  axes: [effortLowToMax],
  optionValues: { effort: "medium" },
};
/** effort 밖의 축(Speed)도 같은 자리에 나온다. */
export const OPUS: PickerScenario = {
  current: { provider: ANTHROPIC, modelName: "Opus 5.5" },
  currentLabel: "Opus 5.5",
  axes: [effortLowToMax, speedStandardFast],
  optionValues: { effort: "high", speed: "fast" },
};
export const HAIKU: PickerScenario = {
  current: { provider: ANTHROPIC, modelName: "Haiku 5.5" },
  currentLabel: "Haiku 5.5",
  axes: [],
  optionValues: {},
};
export const SOL: PickerScenario = {
  current: { provider: OPENAI, modelName: "GPT-6.1 Sol" },
  currentLabel: "GPT-6.1 Sol",
  axes: [effortMinimalToXHigh, speedStandardPriority],
  optionValues: { effort: "very_high", speed: "priority" },
};

const OPUS_ROW = row(ANTHROPIC, "Opus 5.5");
const SONNET_ROW = row(ANTHROPIC, "Sonnet 5.5");
const HAIKU_ROW = row(ANTHROPIC, "Haiku 5.5");
const SOL_ROW = row(OPENAI, "GPT-6.1 Sol");
const MINI_ROW = row(OPENAI, "GPT-6.1 Mini");
const GROK_ROW = row(XAI, "Grok 4.7");

const ANTHROPIC_GROUP: PickerProviderGroup = {
  provider: ANTHROPIC,
  label: "Anthropic",
  models: [OPUS_ROW, SONNET_ROW, HAIKU_ROW],
};
const OPENAI_GROUP: PickerProviderGroup = {
  provider: OPENAI,
  label: "OpenAI",
  models: [SOL_ROW, MINI_ROW],
};
const XAI_GROUP: PickerProviderGroup = {
  provider: XAI,
  label: "xAI",
  models: [GROK_ROW],
};

/** 검색이 없을 때. */
export const LAYOUT_ALL = {
  providers: [ANTHROPIC_GROUP, OPENAI_GROUP, XAI_GROUP],
};

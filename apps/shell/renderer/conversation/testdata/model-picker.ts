// model picker test의 입력. model catalog(harness/model의 options·picker-order)가 낸 값을 그대로 옮겨 고정한
// 순수 data다. 정렬·거르기·값 맞춤 규칙은 여기서 다시 만들지 않고 결과를 적어 둔다.
import type {
  ModelPickerProps,
  PickerAxisView,
  PickerModelRef,
  PickerModelRow,
  PickerNoticeView,
  PickerProviderGroup,
} from "../model-picker/model-picker.tsx";

export const ANTHROPIC = "pvd_01arz3ndektsv4rrffq69g5fa1";
export const OPENAI = "pvd_01arz3ndektsv4rrffq69g5fa2";
export const XAI = "pvd_01arz3ndektsv4rrffq69g5fa3";

function row(
  provider: string,
  providerLabel: string,
  modelName: string,
  starred: boolean,
): PickerModelRow {
  return { provider, providerLabel, modelName, starred };
}

export function ref(row: PickerModelRef): PickerModelRef {
  return { provider: row.provider, modelName: row.modelName };
}

// effort 값의 id는 contract의 이름이고 표시 이름은 고정이다(very_high는 XHigh).
const effortLowToMax: PickerAxisView = {
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
/** GPT-6.1 Sol의 XHigh를 Sonnet 5.5로 바꿔 High로 맞춘 직후. */
export const SONNET_AFTER_SOL: PickerScenario = {
  ...SONNET,
  optionValues: { effort: "high" },
};
export const FITTED_NOTICE: PickerNoticeView = {
  axisLabel: "Effort",
  fromLabel: "XHigh",
  toLabel: "High",
};

const OPUS_ROW = row(ANTHROPIC, "Anthropic", "Opus 5.5", false);
const SONNET_ROW = row(ANTHROPIC, "Anthropic", "Sonnet 5.5", true);
const HAIKU_ROW = row(ANTHROPIC, "Anthropic", "Haiku 5.5", false);
const SOL_ROW = row(OPENAI, "OpenAI", "GPT-6.1 Sol", true);
const MINI_ROW = row(OPENAI, "OpenAI", "GPT-6.1 Mini", false);
const GROK_ROW = row(XAI, "xAI", "Grok 4.7", false);

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

/**
 * 검색이 없을 때. 별표를 찍은 순서는 GPT-6.1 Sol, Sonnet 5.5이고 provider 묶음 순서와 다르다. 즐겨찾기 model도
 * provider 묶음에 그대로 있다.
 */
export const LAYOUT_ALL = {
  favorites: [SOL_ROW, SONNET_ROW],
  providers: [ANTHROPIC_GROUP, OPENAI_GROUP, XAI_GROUP],
};
/** 검색 "so"(대소문자 무시, model 이름 부분 일치). 즐겨찾기가 먼저이고 순서는 별표 순서다. */
export const LAYOUT_SO = {
  favorites: [SOL_ROW, SONNET_ROW],
  providers: [
    { ...ANTHROPIC_GROUP, models: [SONNET_ROW] },
    { ...OPENAI_GROUP, models: [SOL_ROW] },
  ],
};
/** 즐겨찾기가 없다. */
export const LAYOUT_NO_FAVORITES = {
  favorites: [],
  providers: [
    {
      ...ANTHROPIC_GROUP,
      models: [OPUS_ROW, { ...SONNET_ROW, starred: false }, HAIKU_ROW],
    },
    { ...OPENAI_GROUP, models: [{ ...SOL_ROW, starred: false }, MINI_ROW] },
    XAI_GROUP,
  ],
};
/** 맞는 model이 없는 검색. */
export const LAYOUT_NONE = { favorites: [], providers: [] };

export interface PickerCalls {
  readonly opened: boolean[];
  readonly queries: string[];
  readonly picked: PickerModelRef[];
  readonly starred: PickerModelRef[];
  readonly options: [axis: string, value: string][];
  defaults: number;
}

export function pickerCalls(): PickerCalls {
  return {
    opened: [],
    queries: [],
    picked: [],
    starred: [],
    options: [],
    defaults: 0,
  };
}

/** 기본값: picker가 열려 있고 Sonnet 5.5 · Medium을 고른 상태, 검색 없음, 알림 없음. */
export function pickerProps(
  over: Partial<ModelPickerProps> & { scenario?: PickerScenario } = {},
  calls: PickerCalls = pickerCalls(),
): ModelPickerProps {
  const { scenario = SONNET, ...rest } = over;
  return {
    open: true,
    onOpenChange: (open) => calls.opened.push(open),
    current: scenario.current,
    currentLabel: scenario.currentLabel,
    axes: scenario.axes,
    optionValues: scenario.optionValues,
    query: "",
    layout: LAYOUT_ALL,
    notices: [],
    onQueryChange: (query) => calls.queries.push(query),
    onPick: (model) => calls.picked.push(model),
    onToggleFavorite: (model) => calls.starred.push(model),
    onOptionChange: (axis, value) => calls.options.push([axis, value]),
    onChangeDefaults: () => calls.defaults += 1,
    ...rest,
  };
}

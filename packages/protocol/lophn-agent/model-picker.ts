import type { CatalogEntry, OptionAxis } from "./models.ts";
import { EFFORT_VALUES, OPTION_AXIS_EFFORT } from "./option-axes.ts";

// model 선택 화면이 쓰는 순수 규칙이다. 화면(renderer)과 core가
// 같은 입력에 같은 결과를 얻도록 한 곳에 둔다. 의존성·시각·무작위·IO가 없고 zod를 import하지 않는다.
// 어떤 model에 어떤 축과 값이 있는지는 catalog 자료(CatalogEntry.options)만 말한다.

// 축 id → 값. 없는 축은 "모델에 맡김"이다.
export type OptionValues = Readonly<Record<string, string>>;

// 선택 화면이 보는 축이다. wire는 화면이 모르므로 싣지 않는다.
type AxisView = {
  id: string;
  label: string;
  values: { value: string; label: string }[];
  default_value: string | null;
};

// model을 바꿔 값을 맞췄다는 알림 한 건이다. 문구는 design/i18n이 만든다.
type OptionNotice = { axis: string; from: string; to: string };

type FitResult = {
  option_values: Record<string, string>;
  notices: OptionNotice[];
};

// 고른 model이 가진 축만, catalog가 선언한 순서와 표시 이름 그대로 낸다.
// options가 null(미확인)이거나 빈 배열(없음)이면 축이 없다.
export function optionAxesOf(entry: CatalogEntry): AxisView[] {
  return (entry.options ?? []).map((axis) => ({
    id: axis.id,
    label: axis.label,
    values: axis.values.map(({ value, label }) => ({ value, label })),
    default_value: axis.default_value,
  }));
}

// 지원하지 않는 값을 맞출 값이다. effort는 끔을 뺀 지원 값 중 요청보다 약하면서 가장 강한 값,
// 없으면 끔을 뺀 가장 약한 값이다. effort 밖 축은 이름 순서가 없어 첫 값이다.
function fittedValue(axis: OptionAxis, requested: string): string {
  const names = axis.values.map((candidate) => candidate.value);
  if (axis.id !== OPTION_AXIS_EFFORT) return names[0];
  const rank = (name: string) => EFFORT_VALUES.indexOf(name as never);
  const targets = names.filter((name) => name !== "off");
  if (targets.length === 0) return names[0];
  const wanted = rank(requested);
  const weaker =
    wanted < 0 ? [] : targets.filter((name) => rank(name) < wanted);
  const pool = weaker.length > 0 ? weaker : targets;
  return pool.reduce((best, name) =>
    weaker.length > 0
      ? rank(name) > rank(best)
        ? name
        : best
      : rank(name) < rank(best)
        ? name
        : best,
  );
}

// 사람이 model을 바꿀 때 값을 새 model에 맞춘다. 입력을 바꾸지 않는다.
// - 새 model에 그 축이 없으면 값을 버린다(알림 없음).
// - 값이 지원되면 그대로 둔다.
// - 지원되지 않는 effort 값은 더 약하면서 가장 가까운 지원 값으로, 그런 값이 없으면 가장 약한
//   지원 값으로 맞춘다. off는 맞춤 대상이 아니다. 맞춘 값마다 알림 한 건, 순서는 current의 키 순서.
// - effort 밖 축은 약하고 강함을 비교할 이름 순서가 없어 가장 약한(첫) 지원 값으로 맞춘다.
export function fitOptionValues(
  next: CatalogEntry,
  current: OptionValues,
): FitResult {
  const option_values: Record<string, string> = {};
  const notices: OptionNotice[] = [];
  for (const [id, value] of Object.entries(current)) {
    const axis = next.options?.find((candidate) => candidate.id === id);
    if (axis === undefined) continue;
    if (axis.values.some((candidate) => candidate.value === value)) {
      option_values[id] = value;
      continue;
    }
    const fitted = fittedValue(axis, value);
    option_values[id] = fitted;
    notices.push({ axis: id, from: value, to: fitted });
  }
  return { option_values, notices };
}

// 고를 수 있는 model 하나다. entry는 catalog에 같은 이름이 있을 때만 채워지는 정보(한도·option)이고
// 고를 수 있는지는 정하지 않는다.
export type SelectableModel = {
  model_name: string;
  entry: CatalogEntry | null;
};

// provider가 알려 준 목록(reported)이 있으면 그 목록이 기본이다. null(못 읽음)이거나 빈 목록이면 그 정의의
// catalog 항목 전부다. 빈 목록을 "전부 숨김"으로 읽으면 읽기가 틀렸을 때 model이 모두 사라지므로 그렇게 읽지
// 않는다. 어느 쪽이든 사람이 정보를 적은(source가 "user") 그 정의의 항목은 목록에 없어도 더한다. 다른 정의의
// 항목은 섞지 않는다.
export function selectableModels(input: {
  definition: string;
  catalog: readonly CatalogEntry[];
  reported: readonly string[] | null;
}): SelectableModel[] {
  const own = input.catalog.filter(
    (entry) => entry.provider_definition === input.definition,
  );
  const base: SelectableModel[] =
    input.reported === null || input.reported.length === 0
      ? own.map((entry) => ({ model_name: entry.model_name, entry }))
      : [...new Set(input.reported)].map((model_name) => ({
          model_name,
          entry: own.find((entry) => entry.model_name === model_name) ?? null,
        }));
  const listed = new Set(base.map((model) => model.model_name));
  const typed = own.filter(
    (entry) => entry.source === "user" && !listed.has(entry.model_name),
  );
  return [
    ...base,
    ...typed.map((entry) => ({ model_name: entry.model_name, entry })),
  ];
}

// 내장 정의 provider 중 model 목록을 provider에게서 읽는 것이다(custom provider는 따로 늘 읽는다). catalog(models.dev)는
// 새 model을 늦게 싣기 때문에 provider가 열자마자 고를 수 있게 한다. openrouter는 목록이 수백 개라 catalog만 쓰고,
// SuperGrok 구독은 목록을 읽는 곳이 없다.
const API_KEY_MODEL_LISTS = new Set([
  "anthropic",
  "openai",
  "xai",
  "groq",
  "deepseek",
  "google-gemini",
  // OpenCode Go는 gateway 목록이 model마다 wire를 알려 준다. 셋이 같은 목록을 읽고 자기 wire만 남긴다.
  "opencode-go-chat",
  "opencode-go-responses",
  "opencode-go-messages",
]);
const OAUTH_MODEL_LISTS = new Set([
  "anthropic",
  "openai",
  "google-antigravity",
]);

export function builtinListsModels(definition: string, kind: string): boolean {
  if (kind === "api_key") return API_KEY_MODEL_LISTS.has(definition);
  if (kind === "oauth") return OAUTH_MODEL_LISTS.has(definition);
  return false;
}

// 구독 OAuth provider의 목록만 계정의 허락 목록이다. custom·API key provider의 목록은 찾기 위한 것이다.
function isEntitlement(kind: string, reported: readonly string[] | null) {
  return kind === "oauth" && reported !== null;
}

// 허락 목록이 있으면 그 밖의 이름은 받지 않는다. 그 밖에는 항상 true다.
export function entitlementAllows(
  kind: string,
  reported: readonly string[] | null,
  modelName: string,
): boolean {
  return !isEntitlement(kind, reported) || reported!.includes(modelName);
}

// 선택 화면의 규칙이다. 켠 model 목록은 ShownModels.items다.

// 선택 화면에 보일 수 있는 model 하나다. 연결된 provider의 현재 catalog에서 온다.
type PickerModel = { provider: string; model_name: string };

type PickerLayout = {
  // provider 묶음. 입력 순서(provider 순서, 그 안의 model 순서)를 그대로 지킨다. 최근 사용 묶음은 없다.
  providers: { provider: string; models: PickerModel[] }[];
};

// model은 provider와 model 이름의 쌍으로 구별한다.
function pairKey(model: PickerModel): string {
  return JSON.stringify([model.provider, model.model_name]);
}

// 켠 model만 보이되, 지금 쓰는 model(current)은 꺼져 있어도 보인다. 안 보이면 지금 무엇을 쓰는지 모른다.
// query는 대소문자를 가리지 않는 model 이름 부분 일치다. 빈 query(공백만 포함)는 전부 보인다.
export function orderPicker(input: {
  shown: readonly PickerModel[];
  models: readonly PickerModel[];
  current: PickerModel | null;
  query: string;
}): PickerLayout {
  const needle = input.query.trim().toLowerCase();
  const matches = (model: PickerModel) =>
    needle === "" || model.model_name.toLowerCase().includes(needle);
  const on = new Set(input.shown.map(pairKey));
  const currentKey = input.current === null ? null : pairKey(input.current);
  const visible = (model: PickerModel) =>
    on.has(pairKey(model)) || pairKey(model) === currentKey;

  // Map은 삽입 순서를 지키므로 provider 묶음은 입력에서 처음 나온 순서가 된다.
  const groups = new Map<string, PickerModel[]>();
  for (const model of input.models) {
    if (!matches(model) || !visible(model)) continue;
    const group = groups.get(model.provider);
    if (group) group.push(model);
    else groups.set(model.provider, [model]);
  }

  return {
    providers: [...groups].map(([provider, models]) => ({ provider, models })),
  };
}

// targets(model 하나, 또는 provider의 지금 model 전부)를 켜거나(show) 끈다. 결과는 ChangeShownModels의
// 입력이 된다. 입력을 바꾸지 않는다. provider 단위로 따로 저장하지 않는다.
export function setShown(
  shown: readonly PickerModel[],
  targets: readonly PickerModel[],
  show: boolean,
): PickerModel[] {
  const keys = new Set(targets.map(pairKey));
  const kept = shown.filter((item) => !keys.has(pairKey(item)));
  if (!show) return kept;
  return [
    ...kept,
    ...targets.map((model) => ({
      provider: model.provider,
      model_name: model.model_name,
    })),
  ];
}

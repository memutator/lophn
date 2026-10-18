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

// model을 바꿔 값을 맞췄다는 알림 한 건이다. 문구는 shell/wording이 만든다.
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
  const weaker = wanted < 0
    ? []
    : targets.filter((name) => rank(name) < wanted);
  const pool = weaker.length > 0 ? weaker : targets;
  return pool.reduce((best, name) =>
    weaker.length > 0
      ? (rank(name) > rank(best) ? name : best)
      : (rank(name) < rank(best) ? name : best)
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

// 계정이 쓸 수 있는 model 목록(credential.account_models)으로 거른다. null은 아직 못 읽은 것이라 거르지 않는다.
export function accountAllows(
  accountModels: readonly string[] | null,
  modelName: string,
): boolean {
  return accountModels === null || accountModels.includes(modelName);
}

// 선택 화면의 순서 규칙이다. 즐겨찾기 목록은 별표를 찍은 순서의 ModelFavorites.items이고,
// 이 규칙은 그 순서를 바꾸지 않는다.

// 선택 화면에 보일 수 있는 model 하나다. 연결된 provider의 현재 catalog에서 온다.
type PickerModel = { provider: string; model_name: string };

type PickerLayout = {
  // 맨 위 Favorites 묶음. 별표를 찍은 순서 그대로이고 provider로 다시 묶지 않는다.
  favorites: PickerModel[];
  // 그 아래 provider 묶음. 입력 순서(provider 순서, 그 안의 model 순서)를 그대로 지키고
  // 즐겨찾기 model도 여기에 보인다. 최근 사용 묶음은 없다.
  providers: { provider: string; models: PickerModel[] }[];
};

// model은 provider와 model 이름의 쌍으로 구별한다.
function pairKey(model: PickerModel): string {
  return JSON.stringify([model.provider, model.model_name]);
}

// query는 대소문자를 가리지 않는 model 이름 부분 일치다. 빈 query(공백만 포함)는 전부 보인다.
// 즐겨찾기 가운데 지금 models에 없는 것(catalog에서 사라졌거나 provider가 연결돼 있지 않음)은
// 숨기되 favorites 입력은 건드리지 않아, 다시 나타나면 원래 자리에 돌아온다.
export function orderPicker(input: {
  favorites: readonly PickerModel[];
  models: readonly PickerModel[];
  query: string;
}): PickerLayout {
  const needle = input.query.trim().toLowerCase();
  const matches = (model: PickerModel) =>
    needle === "" || model.model_name.toLowerCase().includes(needle);

  const listed = new Set(input.models.map(pairKey));
  const favorites = input.favorites.filter((favorite) =>
    listed.has(pairKey(favorite)) && matches(favorite)
  );

  // Map은 삽입 순서를 지키므로 provider 묶음은 입력에서 처음 나온 순서가 된다.
  const groups = new Map<string, PickerModel[]>();
  for (const model of input.models) {
    if (!matches(model)) continue;
    const group = groups.get(model.provider);
    if (group) group.push(model);
    else groups.set(model.provider, [model]);
  }

  return {
    favorites,
    providers: [...groups].map(([provider, models]) => ({ provider, models })),
  };
}

// 별표를 찍으면 맨 끝에 붙고, 끄면 그 항목만 빠지며 나머지 순서는 그대로다.
// 결과는 ChangeModelFavorites의 입력이 된다. 입력을 바꾸지 않는다.
export function toggleFavorite(
  favorites: readonly PickerModel[],
  model: PickerModel,
): PickerModel[] {
  const key = pairKey(model);
  if (favorites.some((favorite) => pairKey(favorite) === key)) {
    return favorites.filter((favorite) => pairKey(favorite) !== key);
  }
  return [...favorites, {
    provider: model.provider,
    model_name: model.model_name,
  }];
}

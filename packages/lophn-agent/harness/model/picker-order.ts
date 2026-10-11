// model 선택 화면의 순서 규칙이다(harness/model#R26). 즐겨찾기 목록은 별표를 찍은 순서의
// ModelFavorites.items이고, 이 모듈은 그 순서를 바꾸지 않는다.

// 선택 화면에 보일 수 있는 model 하나다. 연결된 provider의 현재 catalog에서 온다.
export type PickerModel = { provider: string; model_name: string };

export type PickerLayout = {
  // 맨 위 Favorites 묶음. 별표를 찍은 순서 그대로이고 provider로 다시 묶지 않는다.
  favorites: PickerModel[];
  // 그 아래 provider 묶음. 입력 순서(provider 순서, 그 안의 model 순서)를 그대로 지키고
  // 즐겨찾기 model도 여기에 보인다. 최근 사용 묶음은 없다.
  providers: { provider: string; models: PickerModel[] }[];
};

// model은 provider와 model 이름의 쌍으로 구별한다(harness/model#R1).
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

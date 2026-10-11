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

// query는 대소문자를 가리지 않는 model 이름 부분 일치다. 빈 query(공백만 포함)는 전부 보인다.
// 즐겨찾기 가운데 지금 models에 없는 것(catalog에서 사라졌거나 provider가 연결돼 있지 않음)은
// 숨기되 favorites 입력은 건드리지 않아, 다시 나타나면 원래 자리에 돌아온다.
export function orderPicker(
  _input: {
    favorites: readonly PickerModel[];
    models: readonly PickerModel[];
    query: string;
  },
): PickerLayout {
  throw new Error("not implemented: agent-I5");
}

// 별표를 찍으면 맨 끝에 붙고, 끄면 그 항목만 빠지며 나머지 순서는 그대로다.
// 결과는 ChangeModelFavorites의 입력이 된다. 입력을 바꾸지 않는다.
export function toggleFavorite(
  _favorites: readonly PickerModel[],
  _model: PickerModel,
): PickerModel[] {
  throw new Error("not implemented: agent-I5");
}

// model picker가 받는 화면 값. 그리는 쪽(model-picker.tsx)과 값을 만드는 쪽이 같이 쓰며,
// CSS를 부르는 component 없이 type만 가져올 수 있게 따로 둔다.

/** model 하나. 같은 이름이 provider마다 있을 수 있어 provider와 이름의 쌍으로 구별한다. */
export interface PickerModelRef {
  /** provider(계정) id. */
  readonly provider: string;
  readonly modelName: string;
}

export interface PickerModelRow extends PickerModelRef {
  /** 줄에 보이는 provider 이름. Favorites 줄에서 어느 provider의 것인지 알린다. */
  readonly providerLabel: string;
  /** 별표가 켜졌는지. Favorites 줄은 항상 켜져 있고, provider 묶음 줄은 즐겨찾기에 있으면 켜진다. */
  readonly starred: boolean;
}

export interface PickerProviderGroup {
  readonly provider: string;
  /** 묶음 머리 글(Anthropic 등). */
  readonly label: string;
  readonly models: readonly PickerModelRow[];
}

/** 검색을 반영한 목록. Favorites는 별표를 찍은 순서 그대로이고 검색 중에도 먼저다. */
export interface PickerLayoutView {
  readonly favorites: readonly PickerModelRow[];
  readonly providers: readonly PickerProviderGroup[];
}

/** 고른 model이 가진 option 축 하나(effort, speed 등). 순서와 표시 이름은 catalog가 정한다. */
export interface PickerAxisView {
  readonly id: string;
  readonly label: string;
  readonly values: readonly {
    readonly value: string;
    readonly label: string;
  }[];
}

/** model 목록이 없는 provider와, 거기에 model 이름을 적어 고르는 길. 없으면 빈 목록이다. */
export interface CustomModelView {
  readonly providers: readonly { readonly id: string; readonly name: string }[];
  readonly onUse: (provider: string, modelName: string) => void;
}

export interface ModelPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 이 session에서 고른 model. */
  current: PickerModelRef;
  /** 고른 model의 표시 이름(Sonnet 5.5). 단추에 쓴다. */
  currentLabel: string;
  /** 고른 model이 가진 축. 없으면 빈 배열이다. */
  axes: readonly PickerAxisView[];
  /** 축 id → 고른 값. 없는 축은 모델에 맡김이라 단추에 붙이지 않는다. */
  optionValues: Readonly<Record<string, string>>;
  /** 검색칸의 글. */
  query: string;
  layout: PickerLayoutView;
  onQueryChange: (query: string) => void;
  onPick: (model: PickerModelRef) => void;
  /** 별표를 눌렀다. 줄을 고른 것으로 치지 않는다. */
  onToggleFavorite: (model: PickerModelRef) => void;
  onOptionChange: (axis: string, value: string) => void;
  custom: CustomModelView;
  /** "Change defaults…" 를 눌렀다. Settings › Agents로 간다. */
  onChangeDefaults: () => void;
}

/** form 칸이 보이는 model 하나와 그 model의 option. `model`은 선택지의 value이다. */
export interface ModelSelectionView {
  readonly model: string;
  readonly axes: readonly PickerAxisView[];
  readonly optionValues: Readonly<Record<string, string>>;
}

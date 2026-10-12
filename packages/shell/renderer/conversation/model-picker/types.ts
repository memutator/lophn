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

/** model을 바꿔 값을 맞췄다는 알림 한 건. 문구는 shell/wording이 만든다. */
export interface PickerNoticeView {
  readonly axisLabel: string;
  /** 맞추기 전 값의 표시 이름(XHigh). */
  readonly fromLabel: string;
  /** 맞춘 뒤 값의 표시 이름(High). */
  readonly toLabel: string;
}

export interface ModelPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 이 session에서 고른 model. */
  current: PickerModelRef;
  /** 고른 model의 표시 이름(Sonnet 5.5). 단추와 알림 문구에 쓴다. */
  currentLabel: string;
  /** 고른 model이 가진 축. 없으면 빈 배열이다. */
  axes: readonly PickerAxisView[];
  /** 축 id → 고른 값. 없는 축은 모델에 맡김이라 단추에 붙이지 않는다. */
  optionValues: Readonly<Record<string, string>>;
  /** 검색칸의 글. */
  query: string;
  layout: PickerLayoutView;
  /** 방금 model을 바꾸며 맞춘 값. 비어 있으면 알림이 없다. */
  notices: readonly PickerNoticeView[];
  onQueryChange: (query: string) => void;
  onPick: (model: PickerModelRef) => void;
  /** 별표를 눌렀다. 줄을 고른 것으로 치지 않는다. */
  onToggleFavorite: (model: PickerModelRef) => void;
  onOptionChange: (axis: string, value: string) => void;
  /** "Change defaults…" 를 눌렀다. Settings › Agents로 간다. */
  onChangeDefaults: () => void;
  /**
   * 고른 값이 어디에 적용되는지. 기본 session은 이 session에만(composer)이고, definition은 agent 정의의 model을
   * 정하는 editor 칸이라 설명이 달라진다.
   */
  scope?: "session" | "definition";
}

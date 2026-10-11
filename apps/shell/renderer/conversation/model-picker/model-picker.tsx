// composer의 model 단추와 picker(shell/desktop#R44, lophn-agent/harness/model#R21·R25·R26). 화면 코드에는
// model 이름도 option 값도 없다. 정렬·거르기·option 축·값 맞춤 알림은 model catalog 쪽 모듈
// (harness/model의 options·picker-order)이 계산해 props로 주고, 이 component는 받은 순서대로 그린다.
// renderer는 contracts·design·sdk만 import하므로 그 모듈을 부르는 연결은 core source 쪽 몫이다.
import type { ReactNode } from "react";

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

/** 검색을 반영한 목록. Favorites는 별표를 찍은 순서 그대로이고 검색 중에도 먼저다(R26). */
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
  /** "Change defaults…" 를 눌렀다. Settings › Agents로 간다(R50). */
  onChangeDefaults: () => void;
}

export function ModelPicker(_props: ModelPickerProps): ReactNode {
  throw new Error("not implemented: agent-I23");
}

// model picker가 받는 화면 값. 그리는 쪽(model-picker.tsx)과 값을 만드는 쪽이 같이 쓰며,
// CSS를 부르는 component 없이 type만 가져올 수 있게 따로 둔다.
import type { AgentValueLayer } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import type { UserModelInfo } from "../../../../protocol/lophn-agent/models.ts";
import type { MODEL_MEDIA } from "../../../../protocol/lophn-agent/resolved-model.ts";

export type ModelMedia = (typeof MODEL_MEDIA)[number];

/** model 하나. 같은 이름이 provider마다 있을 수 있어 provider와 이름의 쌍으로 구별한다. */
export interface PickerModelRef {
  /** provider(계정) id. */
  readonly provider: string;
  readonly modelName: string;
  /** 목록에 보일 이름. 없으면 `modelName`이다(harness는 id와 이름이 다르다). */
  readonly label?: string;
}

export interface PickerProviderGroup {
  readonly provider: string;
  /** 묶음 머리 글(Anthropic 등). */
  readonly label: string;
  readonly models: readonly PickerModelRef[];
}

/** 검색을 반영한 목록. 끈 model은 없고, 지금 model은 꺼져 있어도 있다. */
export interface PickerLayoutView {
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

/** role 한 줄(omp `/switch @role`). 이 session만 그 role의 model로 바꾼다. role 배정을 바꾸는 칸은 없다. */
export interface PickerRoleView {
  readonly id: string;
  readonly label: string;
  readonly kind: "chat" | "model";
  /** 지금 배정된 model의 이름. 없으면 null이다. */
  readonly model: string | null;
  /** vendor 아이콘을 고르는 provider 이름. 모르면 null이다. */
  readonly provider: string | null;
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
  onOptionChange: (axis: string, value: string) => void;
  /** 지금 model이 온 층. session 층은 대화 source만 안다. 어디에도 없으면 null이다. */
  layer: AgentValueLayer | null;
  /** option 축을 보일 수 있는지. catalog를 읽지 못했으면 false라 "No options"를 말하지 않는다. 없으면 true다. */
  axesReady?: boolean;
  /** 위 층의 값을 따르는 줄. agent와 project의 Model 칸만 가진다. */
  follow?: FollowView;
  /** 목록 맨 아래의 Roles 절. role이 없는 source에는 없다. */
  roles?: {
    readonly items: readonly PickerRoleView[];
    readonly onUse: (role: string) => void;
  };
}

/** 목록 맨 위의 "Use project default — X" 줄. `on`이면 지금 이 칸은 따르는 중이다. 고르면 `onFollow`를 부른다. */
export interface FollowView {
  readonly label: string;
  readonly on: boolean;
  readonly onFollow: () => void;
}

/** Manage models 창의 model 한 줄. */
export interface ManageModelView {
  readonly modelName: string;
  readonly shown: boolean;
  /** catalog가 아는 입력 media. 모르면 null이다. */
  readonly inputMedia: readonly ModelMedia[] | null;
  /** catalog가 아는 context 한도. 모르면 null이다. */
  readonly contextLimit: number | null;
  /** 사람이 적은 정보. 없으면 null이다. */
  readonly info: UserModelInfo | null;
}

/** Manage models 창의 provider 묶음 하나. */
export interface ManageProviderView {
  readonly id: string;
  readonly name: string;
  /** 이 provider에서 고를 수 있는 model과 켠 여부. */
  readonly models: readonly ManageModelView[];
  /** model 목록을 다시 읽을 수 있는 provider(custom)다. */
  readonly refreshable: boolean;
  /** model 정보를 적을 수 있는가: custom provider다. catalog에 있는 provider의 model은 읽기만 한다. */
  readonly editable: boolean;
}

// model picker가 쓰는 catalog 예시 data. provider → model → option 축 순서로 둔다. 화면 code는 이 data만
// 읽고 model마다 갈라지지 않는다. 이 파일의 값만 바꾸면 picker, 편집 form, 설정 표의 그림이 함께 바뀐다.
// 실제 앱에서는 이 자리가 model catalog에서 온다.

/** option 값 하나. `rank`는 그 축에서 센 정도(높을수록 세다)라서, 없는 값은 가까운 약한 값으로 맞출 수 있다. */
export interface OptionValue {
  readonly value: string;
  readonly rank: number;
}

/** model이 가진 option 축(effort, speed 같은). effort 밖의 축도 같은 모양이다. */
export interface OptionAxis {
  readonly id: string;
  readonly label: string;
  readonly values: readonly OptionValue[];
  readonly initial: string;
  /** 이 값은 이름 뒤에 붙이지 않는다(보통 값). */
  readonly quiet?: string;
  /** 축 아래 작은 회색 말. */
  readonly note?: string;
}

export interface CatalogModel {
  readonly name: string;
  readonly options: readonly OptionAxis[];
}

export interface CatalogProvider {
  readonly provider: string;
  readonly models: readonly CatalogModel[];
}

const effort = (
  names: readonly string[],
  ranks: readonly number[],
): OptionAxis => ({
  id: "effort",
  label: "Effort",
  values: names.map((value, index) => ({ value, rank: ranks[index] })),
  initial: "Medium",
});

const speed = (names: readonly string[], note?: string): OptionAxis => ({
  id: "speed",
  label: "Speed",
  values: names.map((value, index) => ({ value, rank: index === 0 ? 0 : 1 })),
  initial: names[0],
  quiet: names[0],
  note,
});

export const MODEL_CATALOG: readonly CatalogProvider[] = [
  {
    provider: "Anthropic",
    models: [
      {
        name: "Opus 5.5",
        options: [
          effort(["Low", "Medium", "High", "Max"], [1, 2, 3, 5]),
          speed(["Standard", "Fast"]),
        ],
      },
      {
        name: "Sonnet 5.5",
        options: [effort(["Low", "Medium", "High", "Max"], [1, 2, 3, 5])],
      },
      { name: "Haiku 5.5", options: [] },
    ],
  },
  {
    provider: "OpenAI",
    models: [
      {
        name: "GPT-6.1 Sol",
        options: [
          effort(
            ["Minimal", "Low", "Medium", "High", "XHigh"],
            [0, 1, 2, 3, 4],
          ),
          speed(["Standard", "Priority"]),
        ],
      },
      {
        name: "GPT-6.1 Mini",
        options: [effort(["Low", "Medium", "High"], [1, 2, 3])],
      },
    ],
  },
  {
    provider: "xAI",
    models: [
      {
        name: "Grok 4.7",
        options: [speed(["Standard", "Fast"], "Fast uses grok-4.7-fast.")],
      },
    ],
  },
];

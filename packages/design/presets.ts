// 사람이 고르는 글꼴·글자 크기·밀도 preset. 모양은 tokens.ts의 `tokens`와 같은 경로라서 flatten하면 CSS 변수
// 이름이 token과 똑같다. 기본 preset(pretendard, jetbrains-mono, default, comfortable)은 비어 있거나 tokens.ts의
// 값이고, 기본이 아닌 것만 token을 덮어쓴다. 색은 preset이 아니라 theme(themes.ts)이다.
import { type Themed, tokens } from "./tokens.ts";

type Shape<T> = T extends { readonly light: string; readonly dark: string }
  ? Themed
  : T extends readonly unknown[]
    ? never
    : T extends object
      ? { readonly [K in keyof T]?: Shape<T[K]> }
      : string;

/** `tokens`의 일부를 덮어쓰는 값. 없는 경로나 틀린 모양은 type이 거절한다. */
export type TokenOverride = Shape<typeof tokens>;

/** 글꼴 stack. custom은 사람이 적은 설치된 글꼴 이름을 앞에 두고 기본 stack으로 이어진다. */
const SANS_SYSTEM = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO_SYSTEM =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
// 글꼴을 싣지 않고 OS의 serif를 쓴다. 한글은 Noto Serif KR(나눔명조) 쪽으로 간다.
const READING_SERIF =
  '"Noto Serif KR", "Noto Serif CJK KR", "Nanum Myeongjo", Georgia, "Times New Roman", serif';

export const fontStacks = {
  sans: {
    pretendard: tokens.font.sans,
    system: SANS_SYSTEM,
    custom: (name: string) => `"${name}", ${tokens.font.sans}`,
  },
  mono: {
    "jetbrains-mono": tokens.font.mono,
    system: MONO_SYSTEM,
    custom: (name: string) => `"${name}", ${tokens.font.mono}`,
  },
  reading: {
    serif: READING_SERIF,
    custom: (name: string) => `"${name}", ${tokens.font.reading}`,
  },
} as const;

const px = (value: string) => Number.parseFloat(value);

/** type 단계의 글자와 줄 높이를 같은 비율로 키우거나 줄인다. */
function typeScale(ratio: number): TokenOverride {
  const scaled: Record<string, { size: string; line: string }> = {};
  const { tracking: _tracking, ...steps } = tokens.type;
  for (const [name, step] of Object.entries(steps)) {
    scaled[name] = {
      size: `${Math.round(px(step.size) * ratio)}px`,
      line: `${Math.round(px(step.line) * ratio)}px`,
    };
  }
  return { type: scaled } as TokenOverride;
}

const less = (value: string, by: number) => `${px(value) - by}px`;

/** compact: control 높이와 안 여백, 목록·menu·palette 행, 칸 사이와 pane 여백을 줄인다. */
const compact: TokenOverride = {
  control: {
    sm: {
      height: less(tokens.control.sm.height, 4),
      padX: less(tokens.control.sm.padX, 2),
    },
    md: {
      height: less(tokens.control.md.height, 4),
      padX: less(tokens.control.md.padX, 2),
    },
    lg: {
      height: less(tokens.control.lg.height, 4),
      padX: less(tokens.control.lg.padX, 2),
    },
    gap: less(tokens.control.gap, 2),
  },
  field: { gap: less(tokens.field.gap, 2) },
  menu: { row: less(tokens.menu.row, 4) },
  tree: { row: less(tokens.tree.row, 4) },
  palette: { item: less(tokens.palette.item, 4) },
  layout: {
    panePadding: {
      narrow: less(tokens.layout.panePadding.narrow, 4),
      wide: less(tokens.layout.panePadding.wide, 8),
    },
  },
  tab: { contentGap: less(tokens.tab.contentGap, 8) },
};

/**
 * touch: 손가락으로 누르는 phone 화면. control은 44px 이상이고 목록·menu·tree 행도 그만큼 키운다. 본문 글자는
 * 16px이다(그보다 작으면 phone browser가 입력 칸에 focus할 때 화면을 확대한다). Settings에서 고르는 값이 아니다.
 */
const touch: TokenOverride = {
  type: { body: { size: "16px", line: "24px" } },
  control: {
    sm: { height: "44px", padX: "12px" },
    md: { height: "48px", padX: "16px", icon: "20px" },
    lg: { height: "52px", padX: "20px", icon: "20px" },
    gap: "8px",
  },
  field: { gap: "8px" },
  menu: { row: "44px" },
  tree: { row: "44px" },
  palette: { item: "48px" },
};

/** 기본이 아닌 preset 이름과 token 덮어쓰기. 기본은 `{}`라서 아무것도 덮지 않는다. */
export const appearancePresets = {
  textSize: {
    small: typeScale(0.92),
    default: {},
    large: typeScale(1.12),
  },
  density: { comfortable: {}, compact, touch },
} as const satisfies {
  textSize: Record<string, TokenOverride>;
  density: Record<string, TokenOverride>;
};

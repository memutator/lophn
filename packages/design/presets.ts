// 사람이 고르는 appearance preset. 모양은 tokens.ts의 `tokens`와 같은 경로라서 flatten하면 CSS 변수
// 이름이 token과 똑같다. 기본 preset(ink, warm, pretendard, jetbrains-mono, default, comfortable)은
// 비어 있거나 tokens.ts의 값이고, 기본이 아닌 것만 token을 덮어쓴다.
// 색은 대비를 계산해 정했다: ink 글자와 바탕 4.5:1 이상(hover 포함), focus와 모든 surface 3:1 이상,
// primary·secondary·muted 글자와 모든 surface 4.5:1 이상, primary 글자와 ink.soft 4.5:1 이상.
import { type Themed, tokens } from "./tokens.ts";

type Shape<T> = T extends { readonly light: string; readonly dark: string }
  ? Themed
  : T extends readonly unknown[] ? never
  : T extends object ? { readonly [K in keyof T]?: Shape<T[K]> }
  : string;

/** `tokens`의 일부를 덮어쓰는 값. 없는 경로나 틀린 모양은 type이 거절한다. */
export type TokenOverride = Shape<typeof tokens>;

interface InkPreset {
  readonly color: {
    readonly ink: {
      readonly background: Themed;
      readonly text: Themed;
      readonly hover: Themed;
      readonly soft: Themed;
    };
    readonly focus: Themed;
    readonly selection: Themed;
  };
}

const ink = (
  background: Themed,
  text: Themed,
  hover: Themed,
  focus: Themed,
  selection: Themed,
  soft: Themed,
): InkPreset => ({
  color: { ink: { background, text, hover, soft }, focus, selection },
});

const accent = {
  ink: ink(
    { light: "#1a1a18", dark: "#f3f3f0" },
    { light: "#ffffff", dark: "#161615" },
    { light: "#32322f", dark: "#d9d8d2" },
    { light: "#2a78d6", dark: "#3987e5" },
    { light: "#e7f0fb", dark: "#16263b" },
    { light: "#dde9f8", dark: "#223c5c" },
  ),
  blue: ink(
    { light: "#1d5bbf", dark: "#7db0f2" },
    { light: "#ffffff", dark: "#0b1626" },
    { light: "#164a9e", dark: "#5f9be8" },
    { light: "#2468c9", dark: "#3987e5" },
    { light: "#e7f0fb", dark: "#16263b" },
    { light: "#dce7f6", dark: "#223c5c" },
  ),
  green: ink(
    { light: "#1b7a3c", dark: "#6fcb8b" },
    { light: "#ffffff", dark: "#0a1c10" },
    { light: "#145f2d", dark: "#55b573" },
    { light: "#1f8a45", dark: "#3fae62" },
    { light: "#e4f3e8", dark: "#14281b" },
    { light: "#dbece1", dark: "#244a2f" },
  ),
  purple: ink(
    { light: "#6b3fc4", dark: "#b79cf5" },
    { light: "#ffffff", dark: "#170e2b" },
    { light: "#5632a0", dark: "#a086e6" },
    { light: "#7a4fd6", dark: "#9475ea" },
    { light: "#eee8fa", dark: "#221a38" },
    { light: "#eae3f8", dark: "#41365d" },
  ),
  orange: ink(
    { light: "#b34a0c", dark: "#f29a5c" },
    { light: "#ffffff", dark: "#211104" },
    { light: "#8f3a08", dark: "#e0884a" },
    { light: "#c2570f", dark: "#e8803a" },
    { light: "#fbece0", dark: "#33200f" },
    { light: "#f5e4d9", dark: "#5d3a22" },
  ),
} as const;

interface Palette {
  readonly surface: readonly [Themed, Themed, Themed, Themed];
  readonly border: readonly [Themed, Themed, Themed];
  readonly text: readonly [Themed, Themed, Themed, Themed];
  /** 탭 줄 바탕과 hover, 떠 있는 표면과 hover. 모두 surface와 한 단계씩 맞춘다. */
  readonly derived: readonly [Themed, Themed, Themed, Themed];
}

const palette = ({ surface, border, text, derived }: Palette) =>
  ({
    color: {
      surface: {
        floor: surface[0],
        base: surface[1],
        subtle: surface[2],
        muted: surface[3],
      },
      border: { subtle: border[0], base: border[1], strong: border[2] },
      text: {
        primary: text[0],
        secondary: text[1],
        muted: text[2],
        disabled: text[3],
      },
    },
    tabStrip: { bar: derived[0], hover: derived[1] },
    floating: { surface: derived[2], hover: derived[3] },
  }) satisfies TokenOverride;

const pair = (light: string, dark: string): Themed => ({ light, dark });

const backgrounds = {
  warm: palette({
    surface: [
      pair("#f9f9f7", "#0d0d0d"),
      pair("#ffffff", "#161615"),
      pair("#f3f2ef", "#1d1d1b"),
      pair("#ebeae6", "#252523"),
    ],
    border: [
      pair("#e8e7e2", "#232321"),
      pair("#e1e0d9", "#2c2c2a"),
      pair("#c3c2b7", "#44443f"),
    ],
    text: [
      pair("#1a1a18", "#f3f3f0"),
      pair("#52514e", "#c3c2b7"),
      pair("#6b6a65", "#96958d"),
      pair("#a3a29c", "#5f5e59"),
    ],
    derived: [
      pair("#f3f2ef", "#0d0d0d"),
      pair("#ebeae6", "#1d1d1b"),
      pair("#ffffff", "#1d1d1b"),
      pair("#f3f2ef", "#2a2a28"),
    ],
  }),
  neutral: palette({
    surface: [
      pair("#f8f8f8", "#0d0d0d"),
      pair("#ffffff", "#161616"),
      pair("#f2f2f2", "#1d1d1d"),
      pair("#eaeaea", "#252525"),
    ],
    border: [
      pair("#e6e6e6", "#232323"),
      pair("#dedede", "#2c2c2c"),
      pair("#c0c0c0", "#444444"),
    ],
    text: [
      pair("#1a1a1a", "#f2f2f2"),
      pair("#525252", "#c2c2c2"),
      pair("#686868", "#969696"),
      pair("#a3a3a3", "#5e5e5e"),
    ],
    derived: [
      pair("#f2f2f2", "#0d0d0d"),
      pair("#eaeaea", "#1d1d1d"),
      pair("#ffffff", "#1d1d1d"),
      pair("#f2f2f2", "#2a2a2a"),
    ],
  }),
  cool: palette({
    surface: [
      pair("#f6f8fa", "#0b0e12"),
      pair("#ffffff", "#12161c"),
      pair("#eff2f6", "#1a1f26"),
      pair("#e6eaf0", "#232932"),
    ],
    border: [
      pair("#e3e8ee", "#1f252d"),
      pair("#dbe1e9", "#2a313b"),
      pair("#bbc4d0", "#414a57"),
    ],
    text: [
      pair("#161a20", "#eef1f5"),
      pair("#4a5361", "#bcc4cf"),
      pair("#5c6676", "#8d97a5"),
      pair("#9ca5b3", "#596270"),
    ],
    derived: [
      pair("#eff2f6", "#0b0e12"),
      pair("#e6eaf0", "#1a1f26"),
      pair("#ffffff", "#1a1f26"),
      pair("#eff2f6", "#272d36"),
    ],
  }),
} as const;

/** 글꼴 stack. custom은 사람이 적은 설치된 글꼴 이름을 앞에 두고 기본 stack으로 이어진다. */
const SANS_SYSTEM = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO_SYSTEM =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

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

/** 기본이 아닌 preset 이름과 token 덮어쓰기. 기본은 `{}`라서 아무것도 덮지 않는다. */
export const appearancePresets = {
  accent,
  background: backgrounds,
  textSize: {
    small: typeScale(0.92),
    default: {},
    large: typeScale(1.12),
  },
  density: { comfortable: {}, compact },
} as const satisfies {
  accent: Record<string, TokenOverride>;
  background: Record<string, TokenOverride>;
  textSize: Record<string, TokenOverride>;
  density: Record<string, TokenOverride>;
};

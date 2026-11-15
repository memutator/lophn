import { createContext, type ReactNode, useContext } from "react";
import { type TextStyle, useColorScheme } from "react-native";
import { appearancePresets } from "../presets.ts";
import { type StatusTone, type Themed, tokens } from "../tokens.ts";

export type Scheme = keyof Themed;
/** Index into the shared space scale: 0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64. */
export type Space = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
export type ControlSize = "sm" | "md" | "lg";
export type TypeName =
  | "caption"
  | "small"
  | "body"
  | "reading"
  | "titleSmall"
  | "title"
  | "display";

const px = (value: string) => Number.parseFloat(value);
const touch = appearancePresets.density.touch;

// What a control looks like. Smaller ones still take presses on the full 44px target (see `touch`), so the
// drawn height can stay as quiet as on desktop.
const CONTROL: Record<
  ControlSize,
  { height: number; padX: number; icon: number; text: number }
> = {
  sm: { height: 32, padX: 10, icon: 14, text: 14 },
  md: { height: 40, padX: 14, icon: 16, text: 15 },
  lg: { height: 48, padX: 18, icon: 18, text: 16 },
};

function build(scheme: Scheme) {
  const pick = (value: Themed) => value[scheme];
  const { color } = tokens;
  const type = (name: Exclude<TypeName, "body" | "small" | "caption">) => ({
    fontSize: px(tokens.type[name].size),
    lineHeight: px(tokens.type[name].line),
  });
  const status = (tone: StatusTone) => ({
    marker: pick(tokens.status[tone].marker),
    text: pick(tokens.status[tone].text),
  });
  const weight: Record<
    "regular" | "medium" | "semibold",
    TextStyle["fontWeight"]
  > = { regular: "400", medium: "500", semibold: "600" };
  return {
    scheme,
    color: {
      surface: {
        floor: pick(color.surface.floor),
        base: pick(color.surface.base),
        subtle: pick(color.surface.subtle),
        muted: pick(color.surface.muted),
      },
      border: {
        subtle: pick(color.border.subtle),
        base: pick(color.border.base),
        strong: pick(color.border.strong),
      },
      text: {
        primary: pick(color.text.primary),
        secondary: pick(color.text.secondary),
        muted: pick(color.text.muted),
        disabled: pick(color.text.disabled),
      },
      ink: {
        background: pick(color.ink.background),
        text: pick(color.ink.text),
        pressed: pick(color.ink.hover),
        soft: pick(color.ink.soft),
      },
      link: pick(color.link),
      danger: {
        background: pick(color.danger.background),
        text: pick(color.danger.text),
        pressed: pick(color.danger.hover),
      },
      status: {
        good: status("good"),
        warning: status("warning"),
        serious: status("serious"),
        critical: status("critical"),
        neutral: status("neutral"),
      },
      diff: {
        addLine: pick(tokens.diff.addLine),
        deleteLine: pick(tokens.diff.deleteLine),
      },
      backdrop: scheme === "dark" ? "rgba(0,0,0,0.6)" : "rgba(26,26,24,0.32)",
    },
    // Body is the touch preset's 16/24. Small and caption step up one px from desktop so they stay readable at arm's length.
    type: {
      caption: { fontSize: 12, lineHeight: 16 },
      small: { fontSize: 14, lineHeight: 20 },
      body: {
        fontSize: px(touch.type.body.size),
        lineHeight: px(touch.type.body.line),
      },
      reading: { fontSize: 16, lineHeight: 26 },
      titleSmall: { fontSize: 17, lineHeight: 24 },
      title: type("title"),
      display: type("display"),
    } satisfies Record<TypeName, { fontSize: number; lineHeight: number }>,
    // The same two families as desktop. The host app embeds them under these names.
    font: { sans: "Pretendard", mono: "JetBrainsMono", weight },
    space: tokens.space.map(px),
    radius: {
      xs: px(tokens.radius.xs),
      sm: px(tokens.radius.sm),
      md: px(tokens.radius.md),
      lg: px(tokens.radius.lg),
      xl: px(tokens.radius.xl),
      full: 9999,
    },
    control: CONTROL,
    /** Smallest side of anything a finger presses. */
    touch: 44,
    row: px(touch.menu.row),
    icon: { small: 16, base: 20, large: 24, stroke: tokens.icon.stroke },
    motion: {
      short: px(tokens.motion.duration.short),
      medium: px(tokens.motion.duration.medium),
      long: px(tokens.motion.duration.long),
    },
  };
}

export type Theme = ReturnType<typeof build>;

export const themes: Record<Scheme, Theme> = {
  light: build("light"),
  dark: build("dark"),
};

const ThemeContext = createContext<Theme | undefined>(undefined);

export interface ThemeProviderProps {
  /** Follows the phone's light or dark setting when omitted. */
  scheme?: Scheme;
  children: ReactNode;
}

export function ThemeProvider({ scheme, children }: ThemeProviderProps) {
  const system = useColorScheme();
  const theme = themes[scheme ?? (system === "dark" ? "dark" : "light")];
  return <ThemeContext value={theme}>{children}</ThemeContext>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (theme === undefined) throw new Error("useTheme needs a ThemeProvider");
  return theme;
}

import { createContext, type ReactNode, useContext } from "react";
import { useColorScheme } from "react-native";
import { type StatusTone, type Themed, tokens } from "../tokens.ts";

export type Scheme = keyof Themed;

// The phone's type steps. Sizes and line heights come from the approved phone wireframes
// (tools/wireframes/drafts/phone/phone.module.css), which draw the desktop tokens at arm's length.
const TYPE = {
  /** 12/16: times, meta lines, the line under a title. */
  caption: { fontSize: 12, lineHeight: 16 },
  /** 13/18: a row's second line, section labels, row ends. */
  small: { fontSize: 13, lineHeight: 18 },
  /** 13/19: quiet notes under a card's title. */
  note: { fontSize: 13, lineHeight: 19 },
  /** 14/20: compact controls and dense cards. */
  detail: { fontSize: 14, lineHeight: 20 },
  /** 15/22: sidebar rows, links, steps. */
  control: { fontSize: 15, lineHeight: 22 },
  /** 16/24: the phone's body text. */
  body: { fontSize: 16, lineHeight: 24 },
  /** 16/25: an agent's answer in a conversation. */
  reading: { fontSize: 16, lineHeight: 25 },
  /** 17/24: the top bar's title. */
  title: { fontSize: 17, lineHeight: 24, letterSpacing: -0.17 },
  /** 18/26: a sheet's title, a second-level heading. */
  heading: { fontSize: 18, lineHeight: 26, letterSpacing: -0.18 },
  /** 24/32: the first heading of a page. */
  h1: { fontSize: 24, lineHeight: 32, letterSpacing: -0.48 },
  /** 28/36: a welcome screen's line. */
  hero: { fontSize: 28, lineHeight: 36, letterSpacing: -0.56 },
  /** 30/38: a stat's number. */
  stat: { fontSize: 30, lineHeight: 38, letterSpacing: -0.6 },
} as const;

export type TypeName = keyof typeof TYPE;

function build(scheme: Scheme) {
  const pick = (value: Themed) => value[scheme];
  const { color } = tokens;
  const status = (tone: StatusTone) => ({
    marker: pick(tokens.status[tone].marker),
    text: pick(tokens.status[tone].text),
  });
  return {
    scheme,
    color: {
      surface: {
        floor: pick(color.surface.floor),
        base: pick(color.surface.base),
        subtle: pick(color.surface.subtle),
        muted: pick(color.surface.muted),
        shell: pick(color.surface.shell),
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
      focus: pick(color.focus),
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
      chart: tokens.chart.series.map((series) => pick(series)),
      diff: {
        addLine: pick(tokens.diff.addLine),
        deleteLine: pick(tokens.diff.deleteLine),
      },
      scrim: "rgba(15,15,14,0.38)",
    },
    shadow: {
      popover: pick(tokens.shadow.popover),
      sheet: "0 -12px 40px rgba(15,15,14,0.16)",
      drawer: "12px 0 40px rgba(15,15,14,0.14)",
      fab: "0 8px 20px rgba(15,15,14,0.24)",
      lift: "0 1px 2px rgba(15,15,14,0.12)",
      composer: "0 2px 8px rgba(15,15,14,0.04)",
    },
    type: TYPE,
    // The same two families as desktop. The host app embeds them under these names, weights 400, 500 and 600.
    font: { sans: "Pretendard", mono: "JetBrainsMono" },
    /** Smallest side of anything a finger presses. */
    touch: 44,
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

// The color text and icons take when they name none, like CSS currentColor: a row's end, a button's label.
const InkContext = createContext<string | undefined>(undefined);

export function Ink({
  color,
  children,
}: {
  color: string;
  children: ReactNode;
}) {
  return <InkContext value={color}>{children}</InkContext>;
}

export function useInk(): string {
  const theme = useTheme();
  return useContext(InkContext) ?? theme.color.text.primary;
}

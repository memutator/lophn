import type { ReactNode } from "react";
import { Text as NativeText, type TextStyle } from "react-native";
import type { StatusTone } from "../../tokens.ts";
import { type Theme, type TypeName, useTheme } from "../theme.tsx";

export type TextTone =
  | "primary"
  | "secondary"
  | "muted"
  | "disabled"
  | "link"
  | "danger"
  | "inverse"
  | StatusTone;

export function toneColor(theme: Theme, tone: TextTone): string {
  switch (tone) {
    case "primary":
    case "secondary":
    case "muted":
    case "disabled":
      return theme.color.text[tone];
    case "link":
      return theme.color.link;
    case "danger":
      return theme.color.status.critical.text;
    case "inverse":
      return theme.color.ink.text;
    default:
      return theme.color.status[tone].text;
  }
}

export interface TextProps {
  variant?: TypeName;
  tone?: TextTone;
  weight?: "regular" | "medium" | "semibold";
  mono?: boolean;
  align?: TextStyle["textAlign"];
  numberOfLines?: number;
  selectable?: boolean;
  /** Takes the free width in a row and lets the text shrink instead of pushing its neighbours out. */
  grow?: boolean;
  onPress?: () => void;
  children: ReactNode;
}

export function Text({
  variant = "body",
  tone = "primary",
  weight,
  mono,
  align,
  numberOfLines,
  selectable,
  grow,
  onPress,
  children,
}: TextProps) {
  const theme = useTheme();
  const heading =
    variant === "titleSmall" || variant === "title" || variant === "display";
  return (
    <NativeText
      numberOfLines={numberOfLines}
      selectable={selectable}
      onPress={onPress}
      style={[
        theme.type[variant],
        {
          color: toneColor(theme, tone),
          fontWeight:
            theme.font.weight[weight ?? (heading ? "semibold" : "regular")],
          textAlign: align,
        },
        mono && { fontFamily: theme.font.mono },
        grow && { flex: 1, minWidth: 0 },
      ]}
    >
      {children}
    </NativeText>
  );
}

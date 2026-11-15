import type { ReactNode } from "react";
import {
  Text as NativeText,
  type StyleProp,
  type TextStyle,
} from "react-native";
import type { StatusTone } from "../../tokens.ts";
import { type Theme, type TypeName, useInk, useTheme } from "../theme.tsx";

export type TextTone =
  | "primary"
  | "secondary"
  | "muted"
  | "disabled"
  | "link"
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
    case "inverse":
      return theme.color.ink.text;
    default:
      return theme.color.status[tone].text;
  }
}

export type Weight = "regular" | "medium" | "semibold";
const WEIGHT: Record<Weight, TextStyle["fontWeight"]> = {
  regular: "400",
  medium: "500",
  semibold: "600",
};

export interface TextProps {
  variant?: TypeName;
  /** Takes the surrounding color (a row's end, a button's label) when omitted. */
  tone?: TextTone;
  weight?: Weight;
  mono?: boolean;
  align?: TextStyle["textAlign"];
  numberOfLines?: number;
  selectable?: boolean;
  /** Takes the free width in a row and lets the text shrink instead of pushing its neighbours out. */
  grow?: boolean;
  onPress?: () => void;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
}

export function Text({
  variant = "body",
  tone,
  weight = "regular",
  mono,
  align,
  numberOfLines,
  selectable,
  grow,
  onPress,
  style,
  children,
}: TextProps) {
  const theme = useTheme();
  const ink = useInk();
  return (
    <NativeText
      numberOfLines={numberOfLines}
      selectable={selectable}
      onPress={onPress}
      style={[
        theme.type[variant],
        {
          fontFamily: mono ? theme.font.mono : theme.font.sans,
          fontWeight: WEIGHT[weight],
          color: tone === undefined ? ink : toneColor(theme, tone),
          textAlign: align,
        },
        grow && { flex: 1, minWidth: 0 },
        style,
      ]}
    >
      {children}
    </NativeText>
  );
}

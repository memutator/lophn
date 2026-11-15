import type { LucideIcon } from "lucide-react-native";
import { useInk, useTheme } from "../theme.tsx";
import { type TextTone, toneColor } from "./text.tsx";

export interface IconProps {
  icon: LucideIcon;
  /** Side in dp. 20 is the phone's base icon. */
  size?: number;
  /** Takes the surrounding color when omitted. */
  tone?: TextTone;
  /** A color outside the text tones (an icon on an ink button, a status marker). */
  color?: string;
  strokeWidth?: number;
}

// Every Lucide icon on the phone is drawn with the wireframes' 1.6 stroke.
export function Icon({
  icon: Glyph,
  size = 20,
  tone,
  color,
  strokeWidth = 1.6,
}: IconProps) {
  const theme = useTheme();
  const ink = useInk();
  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      color={color ?? (tone === undefined ? ink : toneColor(theme, tone))}
    />
  );
}

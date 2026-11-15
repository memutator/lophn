import type { LucideIcon } from "lucide-react-native";
import { useTheme } from "../theme.tsx";
import { type TextTone, toneColor } from "./text.tsx";

export interface IconProps {
  icon: LucideIcon;
  size?: "small" | "base" | "large";
  tone?: TextTone;
}

// Every Lucide icon is drawn with the same 1.5 stroke as on desktop.
export function Icon({
  icon: Glyph,
  size = "base",
  tone = "primary",
}: IconProps) {
  const theme = useTheme();
  return (
    <Glyph
      size={theme.icon[size]}
      strokeWidth={theme.icon.stroke}
      color={toneColor(theme, tone)}
    />
  );
}

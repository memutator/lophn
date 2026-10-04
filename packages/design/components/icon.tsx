import type { LucideIcon } from "lucide-react";
import { tokens } from "../tokens.ts";

export interface IconProps {
  icon: LucideIcon;
  pixels: number;
  className?: string;
}

// 모든 Lucide 아이콘은 선 1.5로 그린다(shell/design-system#R43).
export function Icon({ icon: Glyph, pixels, className }: IconProps) {
  return (
    <Glyph
      size={pixels}
      strokeWidth={tokens.icon.stroke}
      className={className}
      aria-hidden="true"
      focusable="false"
    />
  );
}

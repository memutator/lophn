import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import { type Space, useTheme } from "../theme.tsx";

export interface StackProps {
  direction?: "column" | "row";
  gap?: Space;
  padding?: Space;
  paddingX?: Space;
  paddingY?: Space;
  align?: ViewStyle["alignItems"];
  justify?: ViewStyle["justifyContent"];
  /** Takes the free space of its parent. */
  grow?: boolean;
  wrap?: boolean;
  children?: ReactNode;
}

// Screens are stacks. Spacing comes from the shared scale so apps do not invent their own gaps.
export function Stack({
  direction = "column",
  gap = 0,
  padding,
  paddingX,
  paddingY,
  align,
  justify,
  grow,
  wrap,
  children,
}: StackProps) {
  const { space } = useTheme();
  const step = (value: Space | undefined) =>
    value === undefined ? undefined : space[value];
  return (
    <View
      style={{
        flexDirection: direction,
        gap: space[gap],
        padding: step(padding),
        paddingHorizontal: step(paddingX),
        paddingVertical: step(paddingY),
        alignItems: align,
        justifyContent: justify,
        flexWrap: wrap ? "wrap" : undefined,
        ...(grow ? { flex: 1, minWidth: 0 } : undefined),
      }}
    >
      {children}
    </View>
  );
}

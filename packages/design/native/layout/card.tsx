import type { ReactNode } from "react";
import { View } from "react-native";
import { type Space, useTheme } from "../theme.tsx";

export interface CardProps {
  padding?: Space;
  children: ReactNode;
}

export function Card({ padding = 6, children }: CardProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.color.surface.base,
        borderColor: theme.color.border.subtle,
        borderWidth: 1,
        borderRadius: theme.radius.lg,
        padding: theme.space[padding],
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
}

import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import { useTheme } from "../theme.tsx";
import { RowInset } from "./list.tsx";

export interface CardProps {
  /** subtle: a card that stands apart from the page (the default). base: a card on the page's own color with a firmer edge. */
  tone?: "subtle" | "base";
  /** Margin and padding; a card has none of its own. */
  style?: ViewStyle;
  children: ReactNode;
}

// A rounded box that holds one thing: a waiting request, a step list, a note.
export function Card({ tone = "subtle", style, children }: CardProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          borderWidth: 1,
          borderColor: theme.color.border.base,
          borderRadius: 16,
          backgroundColor: theme.color.surface[tone],
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export interface PlainProps {
  style?: ViewStyle;
  children: ReactNode;
}

// A quiet white box with a faint edge: a numbered list on the welcome screen.
export function Plain({ style, children }: PlainProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          borderWidth: 1,
          borderColor: theme.color.border.subtle,
          borderRadius: 16,
          backgroundColor: theme.color.surface.base,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function RowBox({
  margin,
  inset,
  children,
}: {
  margin: number;
  inset: { x: number; y: number };
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        marginHorizontal: margin,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: theme.color.border.subtle,
        borderRadius: 16,
        backgroundColor: theme.color.surface.base,
      }}
    >
      <RowInset value={inset}>{children}</RowInset>
    </View>
  );
}

export interface GroupProps {
  children: ReactNode;
}

// Settings rows grouped in a card on a floor screen, inset 16 from the screen's edges.
export function Group({ children }: GroupProps) {
  return (
    <RowBox margin={16} inset={{ x: 14, y: 6 }}>
      {children}
    </RowBox>
  );
}

export interface ListCardProps {
  children: ReactNode;
}

// Rows in a card inside an app's own layout (an order list). Its parent sets the width.
export function ListCard({ children }: ListCardProps) {
  return (
    <RowBox margin={0} inset={{ x: 14, y: 8 }}>
      {children}
    </RowBox>
  );
}

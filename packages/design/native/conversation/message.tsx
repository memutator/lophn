import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Icon } from "../primitives/icon.tsx";
import { Text } from "../primitives/text.tsx";
import { Ink, useTheme } from "../theme.tsx";

export interface UserBubbleProps {
  children: string;
  /** A quiet line under the bubble: how it went in (Steer · went into the running turn). */
  note?: string;
  noteIcon?: LucideIcon;
}

// What the person said, on the right.
export function UserBubble({ children, note, noteIcon }: UserBubbleProps) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: "flex-end", gap: 6 }}>
      <View
        style={{
          maxWidth: "86%",
          paddingVertical: 9,
          paddingHorizontal: 14,
          borderRadius: 18,
          backgroundColor: theme.color.ink.soft,
        }}
      >
        <Text selectable>{children}</Text>
      </View>
      {note !== undefined && (
        <Ink color={theme.color.text.muted}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            {noteIcon && <Icon icon={noteIcon} size={12} />}
            <Text variant="caption">{note}</Text>
          </View>
        </Ink>
      )}
    </View>
  );
}

export interface AgentTurnProps {
  /** The agent's face, 20 wide. */
  face: ReactNode;
  name: string;
  /** The turn's parts in order: Markdown, Act lines, EditCards, a Meta line. */
  children: ReactNode;
}

// One answer from an agent, on the left under its face and name.
export function AgentTurn({ face, name, children }: AgentTurnProps) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {face}
        <Text variant="control" weight="semibold">
          {name}
        </Text>
      </View>
      {children}
    </View>
  );
}

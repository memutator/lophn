import type { LucideIcon } from "lucide-react-native";
import { ShieldQuestion } from "lucide-react-native";
import { Text as NativeText, ScrollView, View } from "react-native";
import { Button } from "../primitives/button.tsx";
import { Icon } from "../primitives/icon.tsx";
import { Text } from "../primitives/text.tsx";
import { useTheme } from "../theme.tsx";

export interface ApprovalChoice {
  id: string;
  label: string;
  /** allow: the main answer, drawn filled. deny: refuses. other: a narrower or wider allow. */
  kind: "allow" | "deny" | "other";
}

export interface ApprovalCardProps {
  icon?: LucideIcon;
  /** What is being asked: "Run a command", "Change 3 files". */
  title: string;
  /** Who asks and where: the agent, the project. */
  meta?: string;
  /** The exact thing to be run or changed, in mono. Long lines scroll sideways. */
  subject?: string;
  /** Why, or what it will affect. */
  detail?: string;
  choices: readonly ApprovalChoice[];
  onDecide: (id: string) => void;
  /** The answer is on its way; the buttons stop taking presses. */
  busy?: boolean;
}

// The agent stops here until the person answers. Buttons stack full width so each one is an easy target.
export function ApprovalCard({
  icon = ShieldQuestion,
  title,
  meta,
  subject,
  detail,
  choices,
  onDecide,
  busy,
}: ApprovalCardProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.color.status.warning.marker,
        backgroundColor: theme.color.surface.base,
        padding: theme.space[6],
        gap: theme.space[5],
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: theme.space[4],
        }}
      >
        <Icon icon={icon} tone="warning" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text weight="semibold">{title}</Text>
          {meta !== undefined && (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {meta}
            </Text>
          )}
        </View>
      </View>
      {subject !== undefined && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{
            borderRadius: theme.radius.sm,
            backgroundColor: theme.color.surface.subtle,
          }}
          contentContainerStyle={{ padding: theme.space[5] }}
        >
          <NativeText
            selectable
            style={{
              fontFamily: theme.font.mono,
              fontSize: 13,
              lineHeight: 20,
              color: theme.color.text.primary,
            }}
          >
            {subject}
          </NativeText>
        </ScrollView>
      )}
      {detail !== undefined && (
        <Text variant="small" tone="secondary">
          {detail}
        </Text>
      )}
      <View style={{ gap: theme.space[4] }}>
        {choices.map((choice) => (
          <Button
            key={choice.id}
            block
            variant={
              choice.kind === "allow"
                ? "primary"
                : choice.kind === "deny"
                  ? "ghost"
                  : "secondary"
            }
            disabled={busy}
            onPress={() => onDecide(choice.id)}
          >
            {choice.label}
          </Button>
        ))}
      </View>
    </View>
  );
}

import { View } from "react-native";
import { Text } from "../primitives/text.tsx";
import { Markdown } from "../reading/markdown.tsx";
import { useTheme } from "../theme.tsx";

export interface UserMessageProps {
  text: string;
  /** Quiet line under the bubble: "Queued", "Not sent", a time. */
  note?: string;
  /** The note reports a failure. */
  failed?: boolean;
}

// The person's own words sit on the right in a soft bubble. Everything the agent says is plain text on the left.
export function UserMessage({ text, note, failed }: UserMessageProps) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: "flex-end", gap: theme.space[2] }}>
      <View
        style={{
          maxWidth: "86%",
          backgroundColor: theme.color.ink.soft,
          borderRadius: theme.radius.xl,
          borderBottomRightRadius: theme.radius.xs,
          paddingHorizontal: theme.space[6],
          paddingVertical: theme.space[5],
        }}
      >
        <Text selectable>{text}</Text>
      </View>
      {note !== undefined && (
        <Text variant="caption" tone={failed ? "danger" : "muted"}>
          {note}
        </Text>
      )}
    </View>
  );
}

export interface AgentMessageProps {
  /** Markdown. */
  source: string;
  /** Still being written. */
  streaming?: boolean;
  onOpenLink?: (href: string) => void;
}

export function AgentMessage({
  source,
  streaming,
  onOpenLink,
}: AgentMessageProps) {
  return (
    <Markdown
      source={source}
      streaming={streaming}
      variant="chat"
      onOpenLink={onOpenLink}
    />
  );
}

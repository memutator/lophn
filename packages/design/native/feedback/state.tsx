import type { LucideIcon } from "lucide-react-native";
import { CircleX } from "lucide-react-native";
import { ActivityIndicator, View } from "react-native";
import { Button } from "../primitives/button.tsx";
import { Icon } from "../primitives/icon.tsx";
import { Text } from "../primitives/text.tsx";
import { useTheme } from "../theme.tsx";

export interface EmptyAction {
  label: string;
  onPress: () => void;
}

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  /** What the person can do about it. */
  body?: string;
  action?: EmptyAction;
}

export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: theme.space[9],
        gap: theme.space[4],
      }}
    >
      {icon && <Icon icon={icon} size="large" tone="muted" />}
      <Text weight="medium" align="center">
        {title}
      </Text>
      {body !== undefined && (
        <Text variant="small" tone="muted" align="center">
          {body}
        </Text>
      )}
      {action && (
        <View style={{ marginTop: theme.space[5] }}>
          <Button onPress={action.onPress}>{action.label}</Button>
        </View>
      )}
    </View>
  );
}

export interface ErrorStateProps {
  title: string;
  body?: string;
  /** Shows a Try again button. */
  onRetry?: () => void;
}

export function ErrorState({ title, body, onRetry }: ErrorStateProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: theme.space[9],
        gap: theme.space[4],
      }}
    >
      <Icon icon={CircleX} size="large" tone="critical" />
      <Text weight="medium" align="center">
        {title}
      </Text>
      {body !== undefined && (
        <Text variant="small" tone="muted" align="center">
          {body}
        </Text>
      )}
      {onRetry && (
        <View style={{ marginTop: theme.space[5] }}>
          <Button onPress={onRetry}>Try again</Button>
        </View>
      )}
    </View>
  );
}

export interface LoadingProps {
  /** What is loading, for the screen reader and under the spinner. */
  label?: string;
}

export function Loading({ label }: LoadingProps) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: theme.space[5],
        padding: theme.space[9],
      }}
    >
      <ActivityIndicator color={theme.color.text.muted} />
      {label !== undefined && (
        <Text variant="small" tone="muted">
          {label}
        </Text>
      )}
    </View>
  );
}

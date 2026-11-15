// Pieces Jobs and Agents share: a labelled fact line, the offline banner, the quiet closing note, a read that failed.
import { t } from "@lophn/i18n";
import { Banner, Button, Text } from "@lophn/ui-native";
import { WifiOff } from "lucide-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useCurrentComputer } from "../../data/mod.ts";

/** One labelled fact of a job or an agent: the wireframe's Fact, a quiet label and the value beside it. */
export function FactRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <View
      style={{
        minHeight: 44,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        paddingTop: 10,
        paddingBottom: 6,
        paddingHorizontal: 20,
      }}
    >
      <View style={{ width: 92 }}>
        <Text variant="detail" tone="muted">
          {label}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof children === "string" ? (
          <Text variant="control">{children}</Text>
        ) : (
          children
        )}
      </View>
    </View>
  );
}

/** Said at the top when the computer does not answer: what shows below was last read, and it cannot be changed. */
export function OfflineBanner() {
  const computer = useCurrentComputer();
  return (
    <Banner
      icon={WifiOff}
      title={t("mobile.ops.offline.title", { computer: computer?.name ?? "" })}
    >
      {t("mobile.ops.offline.body")}
    </Banner>
  );
}

/** The line under a main action. */
export function Foot({ children }: { children: string }) {
  return (
    <Text variant="note" tone="muted" align="center">
      {children}
    </Text>
  );
}

export function ReadFailed({
  target,
  onRetry,
}: {
  target: string;
  onRetry: () => void;
}) {
  return (
    <View style={{ gap: 12, alignItems: "flex-start", padding: 20 }}>
      <Text tone="muted">{t("common.error.load-failed", { target })}</Text>
      <Button size="sm" onPress={onRetry}>
        {t("common.button.retry")}
      </Button>
    </View>
  );
}

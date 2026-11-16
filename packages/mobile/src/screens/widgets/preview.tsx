// A widget's value as "Choose a widget" shows it (tools/wireframes/drafts/phone/widgets.tsx Pick and Nodes): the first rows,
// drawn the way the home screen widget draws them, on a quiet box. Sizes are the kit's type steps, the nearest to the widget's.
import { t } from "@lophn/i18n";
import { Text, type TextTone, useTheme } from "@lophn/ui-native";
import { View } from "react-native";
import type {
  AppWidget,
  WidgetNode,
  WidgetTone,
} from "../../../../protocol/apps/widget.ts";

// The first rows are enough to tell the widgets of an app apart.
const ROWS = 2;
const ITEMS = 2;

const TONE: Record<WidgetTone, TextTone | undefined> = {
  neutral: undefined,
  good: "good",
  warn: "warning",
  bad: "critical",
};

function Node({ node }: { node: WidgetNode }) {
  const theme = useTheme();
  switch (node.kind) {
    case "text":
      return (
        <Text
          variant={
            node.style === "title"
              ? "control"
              : node.style === "body"
                ? "small"
                : "caption"
          }
          weight={node.style === "title" ? "semibold" : "regular"}
          tone={
            node.tone === undefined
              ? node.style === "caption"
                ? "muted"
                : undefined
              : TONE[node.tone]
          }
          numberOfLines={1}
        >
          {node.text}
        </Text>
      );
    case "stat":
      return (
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
          <Text variant="h1" weight="semibold" tone={node.tone && TONE[node.tone]}>
            {node.value}
          </Text>
          <Text variant="caption" tone="secondary" grow numberOfLines={1}>
            {node.label}
          </Text>
        </View>
      );
    case "progress": {
      const marker = { good: "good", warn: "warning", bad: "critical" } as const;
      const fill =
        node.tone === undefined || node.tone === "neutral"
          ? theme.color.ink.background
          : theme.color.status[marker[node.tone]].marker;
      return (
        <View style={{ gap: 2 }}>
          <View
            style={{
              height: 6,
              borderRadius: 3,
              backgroundColor: theme.color.surface.muted,
            }}
          >
            <View
              style={{
                width: `${node.value * 100}%`,
                height: 6,
                borderRadius: 3,
                backgroundColor: fill,
              }}
            />
          </View>
          {node.label !== undefined && (
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {node.label}
            </Text>
          )}
        </View>
      );
    }
    case "list":
      return (
        <View style={{ gap: 2 }}>
          {node.items.slice(0, ITEMS).map((item) => (
            <View key={item.text} style={{ flexDirection: "row", gap: 8 }}>
              <Text
                variant="caption"
                tone={item.tone && TONE[item.tone]}
                grow
                numberOfLines={1}
              >
                {item.text}
              </Text>
              {item.trail !== undefined && (
                <Text
                  variant="caption"
                  tone={TONE[item.tone ?? "neutral"] ?? "secondary"}
                >
                  {item.trail}
                </Text>
              )}
            </View>
          ))}
        </View>
      );
  }
}

export function Preview({ widget }: { widget: AppWidget }) {
  const theme = useTheme();
  const rows = widget.value?.rows.slice(0, ROWS) ?? null;
  return (
    <View
      style={{
        gap: 4,
        overflow: "hidden",
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderWidth: 1,
        borderColor: theme.color.border.base,
        borderRadius: 14,
        backgroundColor: theme.color.surface.base,
      }}
    >
      {rows === null ? (
        <Text variant="caption" tone="muted">
          {t("mobile.widget.empty")}
        </Text>
      ) : (
        rows.map((node, at) => <Node key={`${node.kind}${at}`} node={node} />)
      )}
    </View>
  );
}

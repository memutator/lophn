import { t } from "@lophn/i18n";
import * as Clipboard from "expo-clipboard";
import { Check, Copy } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Icon } from "../primitives/icon.tsx";
import { Text } from "../primitives/text.tsx";
import { useTheme } from "../theme.tsx";

export interface CodeBlockProps {
  code: string;
  language?: string;
}

const COPIED_MS = 1500;

// Long lines scroll sideways instead of wrapping, so indentation stays readable on a narrow screen.
export function CodeBlock({ code, language }: CodeBlockProps) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <View
      style={{
        paddingTop: 8,
        paddingBottom: 12,
        borderRadius: 14,
        backgroundColor: theme.color.surface.subtle,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
          paddingHorizontal: 14,
        }}
      >
        <Text variant="caption" tone="muted">
          {language ?? ""}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(
            copied ? "common.label.copied" : "common.button.copy-code",
          )}
          hitSlop={12}
          onPress={() => {
            void Clipboard.setStringAsync(code).then(() => setCopied(true));
          }}
        >
          <Icon
            icon={copied ? Check : Copy}
            size={15}
            tone={copied ? "good" : "muted"}
          />
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 14 }}
      >
        <Text mono selectable style={{ fontSize: 13, lineHeight: 20 }}>
          {code.replace(/\n$/, "")}
        </Text>
      </ScrollView>
    </View>
  );
}

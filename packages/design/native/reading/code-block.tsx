import * as Clipboard from "expo-clipboard";
import { Check, Copy } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Text as NativeText, Pressable, ScrollView, View } from "react-native";
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
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: theme.color.border.subtle,
        backgroundColor: theme.color.surface.subtle,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingLeft: theme.space[5],
        }}
      >
        <Text variant="caption" tone="muted" mono>
          {language ?? ""}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copied ? "Copied" : "Copy code"}
          hitSlop={8}
          onPress={() => {
            void Clipboard.setStringAsync(code).then(() => setCopied(true));
          }}
          style={{
            width: 36,
            height: 32,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon
            icon={copied ? Check : Copy}
            size="small"
            tone={copied ? "good" : "muted"}
          />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <NativeText
          selectable
          style={{
            fontFamily: theme.font.mono,
            fontSize: 13,
            lineHeight: 20,
            color: theme.color.text.primary,
            paddingHorizontal: theme.space[5],
            paddingBottom: theme.space[5],
          }}
        >
          {code.replace(/\n$/, "")}
        </NativeText>
      </ScrollView>
    </View>
  );
}

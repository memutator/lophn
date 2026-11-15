import { t } from "@lophn/i18n";
import { ChevronLeft, PanelLeft, X } from "lucide-react-native";
import type { ReactNode } from "react";
import { ScrollView, StatusBar, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconButton } from "../primitives/icon-button.tsx";
import { Text } from "../primitives/text.tsx";
import { useTheme } from "../theme.tsx";

export interface ScreenProps {
  /** base: most screens. floor: an app or a settings list of grouped cards. shell: behind the sidebar. */
  tone?: "base" | "floor" | "shell";
  /** The TopBar. Stays above the body. */
  top?: ReactNode;
  /** Scrolls the body. Leave off when the body is its own list (a MessageList). */
  scroll?: boolean;
  /** Stays at the bottom above the home indicator and rides up on the keyboard: a composer, a main action. */
  footer?: ReactNode;
  /** Drawn over the whole screen: a toast, a floating button. */
  over?: ReactNode;
  children?: ReactNode;
}

// On a wide screen (a tablet, a phone on its side) the body and the footer stop at a width that still reads well and
// stand in the middle; the top bar spans the whole screen (wireframe 9 Wide screens).
const READING_WIDTH = 680;
const column = {
  width: "100%",
  maxWidth: READING_WIDTH,
  alignSelf: "center",
} as const;

// One screen. It owns the safe-area insets so nothing sits under the status bar or the gesture bar.
export function Screen({
  tone = "base",
  top,
  scroll,
  footer,
  over,
  children,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      behavior="padding"
      // The footer keeps its bottom inset; lifting by that much less puts it flush on the keyboard.
      keyboardVerticalOffset={footer === undefined ? 0 : -insets.bottom}
      style={{
        flex: 1,
        backgroundColor: theme.color.surface[tone],
        paddingTop: insets.top,
      }}
    >
      <StatusBar
        barStyle={theme.scheme === "dark" ? "light-content" : "dark-content"}
      />
      {top}
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            ...column,
            paddingBottom: footer === undefined ? insets.bottom + 16 : 8,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, minHeight: 0, ...column }}>{children}</View>
      )}
      {footer !== undefined && (
        <View style={{ paddingBottom: insets.bottom, ...column }}>
          {footer}
        </View>
      )}
      {over}
    </KeyboardAvoidingView>
  );
}

export interface TopBarProps {
  /** menu: opens the sidebar (every top-level place). back: a place inside a place. close: a full-screen step. */
  left?: "menu" | "back" | "close" | "none";
  onLeft?: () => void;
  /** Marks the menu button: something waits in the sidebar. */
  menuDot?: boolean;
  /** Before the title: an agent's face, an app's mark. */
  lead?: ReactNode;
  title: string;
  /** Quieter text on the same line: the session's name after the agent's. */
  sub?: string;
  /** A small line under the title. */
  under?: string;
  /** Icon buttons or a chip at the end. */
  right?: ReactNode;
}

const LEFT = { menu: PanelLeft, back: ChevronLeft, close: X } as const;
const LEFT_LABEL = {
  menu: "mobile.kit.button.open-sidebar",
  back: "common.button.back",
  close: "common.button.close",
} as const;

export function TopBar({
  left = "menu",
  onLeft,
  menuDot,
  lead,
  title,
  sub,
  under,
  right,
}: TopBarProps) {
  return (
    <View
      style={{
        height: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        paddingHorizontal: 8,
      }}
    >
      {left !== "none" && (
        <IconButton
          icon={LEFT[left]}
          label={t(LEFT_LABEL[left])}
          size={left === "back" ? 24 : 22}
          dot={left === "menu" && menuDot}
          onPress={onLeft}
        />
      )}
      <View
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingLeft: left === "none" ? 12 : 4,
          paddingRight: 4,
        }}
      >
        {lead}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", gap: 6, minWidth: 0 }}>
            <Text
              variant="title"
              weight="semibold"
              numberOfLines={1}
              style={{
                flexShrink: sub === undefined ? 1 : 0,
                maxWidth: "100%",
              }}
            >
              {title}
            </Text>
            {sub !== undefined && (
              <Text
                variant="title"
                tone="muted"
                numberOfLines={1}
                style={{ flexShrink: 1, letterSpacing: 0 }}
              >
                {`· ${sub}`}
              </Text>
            )}
          </View>
          {under !== undefined && (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {under}
            </Text>
          )}
        </View>
      </View>
      {right}
    </View>
  );
}

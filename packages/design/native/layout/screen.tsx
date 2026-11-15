import { ChevronLeft } from "lucide-react-native";
import type { ReactNode } from "react";
import { ScrollView, StatusBar, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconButton } from "../primitives/icon-button.tsx";
import { Text } from "../primitives/text.tsx";
import { useTheme } from "../theme.tsx";

export interface ScreenProps {
  title: string;
  /** One quiet line under the title: where this is, or its state. */
  subtitle?: string;
  /** Shows the back arrow. */
  onBack?: () => void;
  /** Icon buttons at the end of the header. */
  actions?: ReactNode;
  /** Scrolls the body. Leave off when the body is its own list. */
  scroll?: boolean;
  /** Stays at the bottom above the home indicator: a composer, a main action. */
  footer?: ReactNode;
  children: ReactNode;
}

// One screen: header, body, optional footer. It owns the safe-area insets so the body never sits under the status bar or the gesture bar.
export function Screen({
  title,
  subtitle,
  onBack,
  actions,
  scroll,
  footer,
  children,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      behavior="padding"
      // The footer keeps its bottom inset; lifting by that much less puts its content flush on the keyboard.
      keyboardVerticalOffset={footer === undefined ? 0 : -insets.bottom}
      style={{
        flex: 1,
        backgroundColor: theme.color.surface.floor,
        paddingTop: insets.top,
      }}
    >
      <StatusBar
        barStyle={theme.scheme === "dark" ? "light-content" : "dark-content"}
      />
      <View
        style={{
          minHeight: 52,
          borderBottomWidth: 1,
          borderBottomColor: theme.color.border.subtle,
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: onBack ? theme.space[2] : theme.space[6],
          paddingRight: theme.space[2],
          gap: theme.space[2],
        }}
      >
        {onBack && (
          <IconButton icon={ChevronLeft} label="Back" onPress={onBack} />
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="titleSmall" numberOfLines={1}>
            {title}
          </Text>
          {subtitle !== undefined && (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>
        {actions}
      </View>
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingBottom: footer ? 0 : insets.bottom + theme.space[6],
          }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{children}</View>
      )}
      {footer !== undefined && (
        <View style={{ paddingBottom: insets.bottom }}>{footer}</View>
      )}
    </KeyboardAvoidingView>
  );
}

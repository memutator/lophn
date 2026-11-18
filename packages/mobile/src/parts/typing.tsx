// What the screens that look at something live on the computer (a terminal, a browser page) share: watching only while
// the app is in front, a quiet line where typing would be, the text box with its send button, and one key of a key row.
import { Icon, Text, useTheme } from "@lophn/ui-native";
import { ArrowUp, type LucideIcon } from "lucide-react-native";
import {
  type ComponentRef,
  type ReactNode,
  type RefObject,
  useEffect,
  useState,
} from "react";
import { AppState, Pressable, TextInput, View } from "react-native";

/** False while the app is in the background: a screen stops watching then. */
export function useForeground(): boolean {
  const [on, setOn] = useState(AppState.currentState !== "background");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setOn(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  return on;
}

/** One quiet line under the screen: why the phone cannot type, or why what shows is not live. */
export function NoticeLine({
  icon,
  children,
}: {
  icon: LucideIcon;
  children: string;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        paddingTop: 6,
        paddingHorizontal: 20,
        paddingBottom: 10,
      }}
    >
      <View style={{ marginTop: 1 }}>
        <Icon icon={icon} size={16} tone="muted" />
      </View>
      <Text variant="note" tone="muted" grow>
        {children}
      </Text>
    </View>
  );
}

/** The text box with its round send button, and the line that sending failed under it. */
export function TypeBox({
  value,
  onChangeText,
  onSend,
  placeholder,
  sendLabel,
  failed,
  input,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  placeholder: string;
  sendLabel: string;
  /** Said under the box while the last send failed. */
  failed: string | null;
  input?: RefObject<ComponentRef<typeof TextInput> | null>;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ paddingTop: 6, paddingHorizontal: 12 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minHeight: 44,
          paddingLeft: 14,
          paddingRight: 6,
          borderWidth: 1,
          borderColor: focused ? theme.color.focus : theme.color.border.base,
          borderRadius: 12,
          backgroundColor: theme.color.surface.base,
        }}
      >
        <TextInput
          ref={input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.color.text.muted}
          autoCapitalize="none"
          autoCorrect={false}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={onSend}
          submitBehavior="submit"
          cursorColor={theme.color.text.primary}
          selectionColor={theme.color.ink.soft}
          style={{
            flex: 1,
            minWidth: 0,
            padding: 0,
            fontFamily: theme.font.sans,
            ...theme.type.body,
            color: theme.color.text.primary,
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sendLabel}
          disabled={value === ""}
          onPress={onSend}
          hitSlop={4}
          style={{
            width: 36,
            height: 36,
            borderRadius: 999,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor:
              value === "" ? theme.color.surface.muted : theme.color.ink.background,
          }}
        >
          <Icon
            icon={ArrowUp}
            size={20}
            strokeWidth={2}
            color={value === "" ? theme.color.text.disabled : theme.color.ink.text}
          />
        </Pressable>
      </View>
      {failed !== null && (
        <Text variant="caption" tone="critical" style={{ marginTop: 4, marginLeft: 4 }}>
          {failed}
        </Text>
      )}
    </View>
  );
}

/** A row of keys under the text box; the last row of a bar keeps a gap under it. */
export function KeyRow({ last, children }: { last: boolean; children: ReactNode }) {
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 5,
        paddingTop: 6,
        paddingHorizontal: 12,
        paddingBottom: last ? 8 : 0,
      }}
    >
      {children}
    </View>
  );
}

/** One key of a key row. `on`: a held modifier (given only for keys that hold). A string is drawn as the key's cap. */
export function KeyCap({
  label,
  on,
  onPress,
  children,
}: {
  label: string;
  on?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={on === undefined ? undefined : { selected: on }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: 0,
        height: 34,
        paddingHorizontal: 4,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: on ? theme.color.ink.background : theme.color.border.base,
        borderRadius: 8,
        backgroundColor: on
          ? theme.color.ink.background
          : pressed
            ? theme.color.surface.muted
            : theme.color.surface.base,
      })}
    >
      {typeof children === "string" ? (
        <Text
          variant="small"
          weight="medium"
          tone="secondary"
          numberOfLines={1}
          style={on ? { color: theme.color.ink.text } : undefined}
        >
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

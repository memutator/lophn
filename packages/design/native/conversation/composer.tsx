import { t } from "@lophn/i18n";
import { ArrowUp, FileText, Plus, Square } from "lucide-react-native";
import type { ReactNode } from "react";
import {
  Image,
  type ImageSourcePropType,
  Pressable,
  TextInput,
  View,
} from "react-native";
import { Icon } from "../primitives/icon.tsx";
import { Text } from "../primitives/text.tsx";
import { Ink, scaleText, useTheme } from "../theme.tsx";

export interface ComposerProps {
  value: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
  /** Says what sending does now: Reply…, Queue a message…, Ask lophn… */
  placeholder: string;
  /** The agent is working. With an empty draft the send button becomes Stop. */
  working?: boolean;
  onStop?: () => void;
  /** Shows the + button. */
  onAttach?: () => void;
  /** Chips in the bottom row after +: the model, the workspace. */
  chips?: ReactNode;
  /** Attachments above the text: Thumbs and FileChips. */
  above?: ReactNode;
  /** Nothing can be sent now (the computer is offline). */
  disabled?: boolean;
  /** There is something to send besides the text (pictures attached), so an empty text can still be sent. */
  canSend?: boolean;
}

// The bottom of a conversation. Put it in a Screen's footer so it rides on the keyboard.
export function Composer({
  value,
  onChangeText,
  onSend,
  placeholder,
  working,
  onStop,
  onAttach,
  chips,
  above,
  disabled,
  canSend,
}: ComposerProps) {
  const theme = useTheme();
  const empty = value.trim() === "" && !canSend;
  const stop = working && empty && onStop !== undefined;
  const off = !stop && (disabled || empty);
  return (
    <View style={{ paddingVertical: 6, paddingHorizontal: 12 }}>
      <View
        style={{
          paddingTop: 12,
          paddingHorizontal: 8,
          paddingBottom: 8,
          borderWidth: 1,
          borderColor: theme.color.border.base,
          borderRadius: 24,
          backgroundColor: theme.color.surface.base,
          boxShadow: theme.shadow.composer,
        }}
      >
        {above !== undefined && (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 8,
              paddingHorizontal: 8,
              paddingBottom: 10,
            }}
          >
            {above}
          </View>
        )}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.color.text.muted}
          multiline
          editable={!disabled}
          cursorColor={theme.color.text.primary}
          selectionColor={theme.color.ink.soft}
          style={{
            minHeight: 24,
            maxHeight: 144,
            padding: 0,
            paddingHorizontal: 10,
            marginBottom: 10,
            fontFamily: theme.font.sans,
            ...scaleText(theme, { fontSize: 16, lineHeight: 24 }),
            color: theme.color.text.primary,
            textAlignVertical: "top",
          }}
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          {onAttach && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("conversation.button.attach")}
              disabled={disabled}
              onPress={onAttach}
              style={({ pressed }) => ({
                width: 36,
                height: 36,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed
                  ? theme.color.surface.muted
                  : "transparent",
              })}
            >
              <Icon icon={Plus} size={22} color={theme.color.text.secondary} />
            </Pressable>
          )}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              flexShrink: 1,
            }}
          >
            {chips}
          </View>
          <View style={{ flex: 1 }} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(
              stop ? "conversation.button.stop" : "conversation.button.send",
            )}
            disabled={off}
            onPress={stop ? onStop : onSend}
            hitSlop={4}
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: off
                ? theme.color.surface.muted
                : theme.color.ink.background,
            }}
          >
            {stop ? (
              <Square
                size={14}
                strokeWidth={2}
                color={theme.color.ink.text}
                fill={theme.color.ink.text}
              />
            ) : (
              <Icon
                icon={ArrowUp}
                size={20}
                strokeWidth={2}
                color={off ? theme.color.text.disabled : theme.color.ink.text}
              />
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export interface ThumbProps {
  source?: ImageSourcePropType;
}

// A picture attached to a message.
export function Thumb({ source }: ThumbProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 64,
        height: 64,
        borderRadius: 12,
        overflow: "hidden",
        backgroundColor: theme.color.surface.muted,
      }}
    >
      {source !== undefined && (
        <Image source={source} style={{ width: 64, height: 64 }} />
      )}
    </View>
  );
}

export interface FileChipProps {
  name: string;
}

// A file attached to a message.
export function FileChip({ name }: FileChipProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        height: 38,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        borderWidth: 1,
        borderColor: theme.color.border.base,
        borderRadius: 10,
      }}
    >
      <Ink color={theme.color.text.secondary}>
        <Icon icon={FileText} size={16} />
        <Text variant="small" numberOfLines={1}>
          {name}
        </Text>
      </Ink>
    </View>
  );
}

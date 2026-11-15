import { ArrowUp, Plus, Square } from "lucide-react-native";
import type { ReactNode } from "react";
import { TextInput, View } from "react-native";
import { IconButton } from "../primitives/icon-button.tsx";
import { useTheme } from "../theme.tsx";

export interface ComposerProps {
  value: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
  /** The agent is working. With an empty draft the send button becomes Stop. */
  working?: boolean;
  onStop?: () => void;
  /** Shows the [+] button for attachments. */
  onAttach?: () => void;
  placeholder?: string;
  /** Nothing can be sent now (not connected, a message is still going out). */
  disabled?: boolean;
  /** A row above the text: attachment chips, a model chip. */
  accessory?: ReactNode;
}

// The bottom of a conversation. Put it in a Screen's footer so it rides on the keyboard.
export function Composer({
  value,
  onChangeText,
  onSend,
  working,
  onStop,
  onAttach,
  placeholder = "Message",
  disabled,
  accessory,
}: ComposerProps) {
  const theme = useTheme();
  const empty = value.trim() === "";
  const stop = working && empty && onStop !== undefined;
  return (
    <View
      style={{
        paddingHorizontal: theme.space[5],
        paddingTop: theme.space[4],
        paddingBottom: theme.space[4],
      }}
    >
      <View
        style={{
          borderRadius: theme.radius.xl,
          borderWidth: 1,
          borderColor: theme.color.border.base,
          backgroundColor: theme.color.surface.base,
          paddingHorizontal: theme.space[2],
          paddingVertical: theme.space[2],
        }}
      >
        {accessory !== undefined && (
          <View
            style={{
              paddingHorizontal: theme.space[4],
              paddingTop: theme.space[4],
            }}
          >
            {accessory}
          </View>
        )}
        <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
          {onAttach && (
            <IconButton
              icon={Plus}
              label="Attach"
              tone="secondary"
              disabled={disabled}
              onPress={onAttach}
            />
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
            style={[
              theme.type.body,
              {
                flex: 1,
                minHeight: theme.touch,
                maxHeight: 144,
                paddingHorizontal: theme.space[4],
                paddingTop: 10,
                paddingBottom: 10,
                color: theme.color.text.primary,
                textAlignVertical: "center",
              },
            ]}
          />
          {stop ? (
            <IconButton
              icon={Square}
              label="Stop"
              variant="filled"
              onPress={onStop}
            />
          ) : (
            <IconButton
              icon={ArrowUp}
              label="Send"
              variant="filled"
              disabled={disabled || empty}
              onPress={onSend}
            />
          )}
        </View>
      </View>
    </View>
  );
}

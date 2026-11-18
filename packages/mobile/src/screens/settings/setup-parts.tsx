// What an agent's request card and the Providers screen share to set up a computer: the protected field for a secret and
// a started sign-in's code.
import { t } from "@lophn/i18n";
import { Button, Text, useTheme } from "@lophn/ui-native";
import * as Clipboard from "expo-clipboard";
import { Copy } from "lucide-react-native";
import { type ComponentRef, type ReactElement, useEffect, useRef, useState } from "react";
import { TextInput, View } from "react-native";

// The protected field. What is typed lives only in a ref, never in React state, navigation or a log, and is emptied when
// it is taken to send and when the field goes away. The kit's Input holds its value in state, so this one is its own
// uncontrolled TextInput in the same look.

export interface SecretValue {
  /** Whether anything is typed; the value itself is not here. */
  readonly filled: boolean;
  /** Hands the typed value over and empties the field. */
  take(): string;
  readonly field: ReactElement;
}

export function useSecretField({ label, autoFocus }: { label: string; autoFocus?: boolean }): SecretValue {
  const theme = useTheme();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const value = useRef("");
  const [filled, setFilled] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(
    () => () => {
      value.current = "";
    },
    [],
  );
  const field = (
    <TextInput
      ref={input}
      onChangeText={(text) => {
        value.current = text;
        setFilled(text.length > 0);
      }}
      accessibilityLabel={label}
      secureTextEntry
      autoCorrect={false}
      autoCapitalize="none"
      autoComplete="off"
      importantForAutofill="no"
      textContentType="none"
      spellCheck={false}
      autoFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      cursorColor={theme.color.text.primary}
      selectionColor={theme.color.ink.soft}
      style={{
        minHeight: 48,
        paddingHorizontal: 14,
        borderWidth: 1,
        borderColor: focused ? theme.color.focus : theme.color.border.base,
        borderRadius: 12,
        backgroundColor: theme.color.surface.base,
        fontFamily: theme.font.sans,
        ...theme.type.body,
        color: theme.color.text.primary,
      }}
    />
  );
  return {
    filled,
    take() {
      const taken = value.current;
      value.current = "";
      input.current?.clear();
      setFilled(false);
      return taken;
    },
    field,
  };
}

/** Why a started sign-in did not connect, said as the desktop's Connect window says it. */
export function signInFailure(code: string): string {
  return t(
    code === "forbidden"
      ? "settings.error.sign-in-refused"
      : code === "not_found"
        ? "settings.error.sign-in-expired"
        : "settings.error.connect-failed",
  );
}

/** The code of a started sign-in with Copy, and the line that says the computer waits. */
export function SignInCode({ code }: { code: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      {code !== null && (
        <View style={{ marginTop: 10, gap: 4 }}>
          <Text variant="caption" tone="muted">
            {t("mobile.setup.label.code")}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Text variant="h1" mono selectable>
              {code}
            </Text>
            <Button
              size="sm"
              icon={Copy}
              onPress={() => void Clipboard.setStringAsync(code).then(() => setCopied(true))}
            >
              {t(copied ? "common.label.copied" : "common.button.copy")}
            </Button>
          </View>
        </View>
      )}
      <Text variant="note" tone="muted" style={{ marginTop: 10 }}>
        {t("mobile.setup.notice.code-waiting")}
      </Text>
    </>
  );
}

// When the camera cannot be used: the pairing text the computer shows, pasted in.
import { t } from "@lophn/i18n";
import { Button, Input, Sheet, Text } from "@lophn/ui-native";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { View } from "react-native";
import { Rich } from "../../app/rich.tsx";
import { parseQr } from "../../pairing/pair.ts";
import type { RemotePairing } from "../../remote.ts";

export function EnterCodeSheet({
  open,
  onClose,
  onCode,
}: {
  open: boolean;
  onClose: () => void;
  onCode: (qr: RemotePairing) => void;
}) {
  const [text, setText] = useState("");
  const [wrong, setWrong] = useState(false);
  const pair = () => {
    const qr = parseQr(text.trim());
    if (qr === undefined) {
      setWrong(true);
      return;
    }
    setText("");
    setWrong(false);
    onClose();
    onCode(qr);
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("mobile.start.heading.enter-code")}
    >
      <View style={{ gap: 12, paddingHorizontal: 20, paddingBottom: 14 }}>
        <Rich
          id="mobile.start.note.enter-code"
          name="button"
          value={t("settings.button.remote-show-text")}
          variant="note"
          tone="muted"
        />
        <Input
          value={text}
          onChangeText={(next) => {
            setText(next);
            setWrong(false);
          }}
          placeholder={t("settings.label.remote-qr")}
          autoFocus
          onSubmit={pair}
        />
        {wrong && (
          <Text variant="note" tone="critical">
            {t("mobile.start.error.not-a-code")}
          </Text>
        )}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button
            block
            onPress={() =>
              void Clipboard.getStringAsync().then((pasted) => {
                setText(pasted);
                setWrong(false);
              })
            }
          >
            {t("project-workspace.button.explorer-paste")}
          </Button>
          <Button
            block
            variant="primary"
            disabled={text.trim() === ""}
            onPress={pair}
          >
            {t("mobile.start.button.pair")}
          </Button>
        </View>
      </View>
    </Sheet>
  );
}

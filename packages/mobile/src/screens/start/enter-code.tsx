// When the camera cannot be used: the invite text the computer shows, pasted in.
import { t } from "@lophn/i18n";
import { Button, Input, Sheet, Text } from "@lophn/ui-native";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { View } from "react-native";
import { Rich } from "../../app/rich.tsx";
import { parseInviteText } from "../../../../remote-client/mod.ts";
import type { RosterInviteText } from "../../remote.ts";

export function EnterCodeSheet({
  open,
  onClose,
  onCode,
}: {
  open: boolean;
  onClose: () => void;
  onCode: (invite: RosterInviteText) => void;
}) {
  const [text, setText] = useState("");
  const [wrong, setWrong] = useState<"not-a-code" | "computer-invite" | null>(null);
  const pair = () => {
    const invite = parseInviteText(text.trim());
    if (invite === undefined || invite.invite.body.kind !== "phone") {
      setWrong(invite === undefined ? "not-a-code" : "computer-invite");
      return;
    }
    setText("");
    setWrong(null);
    onClose();
    onCode(invite);
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
            setWrong(null);
          }}
          placeholder={t("settings.label.remote-qr")}
          autoFocus
          onSubmit={pair}
        />
        {wrong !== null && (
          <Text variant="note" tone="critical">
            {t(
              wrong === "not-a-code"
                ? "mobile.start.error.not-a-code"
                : "mobile.start.error.computer-invite",
            )}
          </Text>
        )}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button
            block
            onPress={() =>
              void Clipboard.getStringAsync().then((pasted) => {
                setText(pasted);
                setWrong(null);
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

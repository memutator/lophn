// Home's New app (tools/wireframes/drafts/phone/apps.tsx NewApp): a name and one line of purpose. The phone cannot register
// an app itself, so Create opens a new Home session with those words ready to send; lophn registers the app and builds it.
import { t } from "@lophn/i18n";
import { Button, Field, Input, Sheet } from "@lophn/ui-native";
import { useState } from "react";
import { View } from "react-native";

export function NewAppSheet({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  /** The words to open a Home session with. */
  onCreate: (text: string) => void;
}) {
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const ready = name.trim() !== "" && purpose.trim() !== "";
  return (
    <Sheet open={open} onClose={onClose} title={t("home.button.new-app")} sub={t("mobile.apps.new.note")}>
      <View style={{ gap: 14, paddingHorizontal: 20, paddingBottom: 14 }}>
        <Field label={t("mobile.apps.new.name")}>
          <Input value={name} onChangeText={setName} autoFocus />
        </Field>
        <Field label={t("mobile.apps.new.purpose")}>
          <Input value={purpose} onChangeText={setPurpose} />
        </Field>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          <Button onPress={onClose}>{t("common.button.cancel")}</Button>
          <Button
            variant="primary"
            disabled={!ready}
            onPress={() => {
              onCreate(t("mobile.apps.new.prompt", { name: name.trim(), purpose: purpose.trim() }));
              setName("");
              setPurpose("");
              onClose();
            }}
          >
            {t("home.button.new-app")}
          </Button>
        </View>
      </View>
    </Sheet>
  );
}

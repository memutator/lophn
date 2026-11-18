// Instead of the composer under a past coding session (tools/wireframes/drafts/phone/coding.tsx Ended): the computer
// opens the same harness session again as a chat and the phone goes to it.
import { t } from "@lophn/i18n";
import { Button, Text, Working } from "@lophn/ui-native";
import { MessageSquare } from "lucide-react-native";
import { View } from "react-native";
import { useNav } from "../../app/nav.ts";
import { useLocked } from "../../parts/mod.ts";
import { useOpenCoding } from "./open.tsx";

export function ContinueAsChat({
  project,
  harness,
  label,
  session,
}: {
  project: string;
  harness: string;
  label: string;
  /** The past session: a harness agent session of the ledger. */
  session: string;
}) {
  const nav = useNav();
  const locked = useLocked();
  const { open, busy, problem, computer } = useOpenCoding(true);
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 }}>
      <Text tone="secondary">{t("mobile.coding.notice.ended", { computer })}</Text>
      {problem !== null && (
        <Text variant="small" tone="critical" style={{ marginTop: 8 }}>
          {problem.text}
        </Text>
      )}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 12 }}>
        {busy ? (
          <Working>{t("mobile.coding.notice.opening", { computer })}</Working>
        ) : problem?.conflict === true ? (
          <Button
            onPress={() => nav.open({ name: "workspace", workspace: { kind: "project", id: project } })}
          >
            {t("mobile.coding.button.to-sessions")}
          </Button>
        ) : (
          <Button
            variant="primary"
            icon={MessageSquare}
            disabled={locked}
            onPress={() => void open(project, harness, label, { session })}
          >
            {t("mobile.coding.button.continue")}
          </Button>
        )}
      </View>
    </View>
  );
}

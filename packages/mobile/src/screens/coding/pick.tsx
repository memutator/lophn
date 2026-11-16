// The coding agents of the computer in the new session screen's agent sheet (tools/wireframes/drafts/phone/coding.tsx
// Pick): picking one opens it in a new terminal tab on the computer and goes to its chat. Only in a project. Without the
// computer's app the line that starts it stands here; the app is never started by looking at this.
import { t } from "@lophn/i18n";
import { Icon, Label, Row, Text, Working } from "@lophn/ui-native";
import { Monitor } from "lucide-react-native";
import { View } from "react-native";
import { HARNESS_ADAPTERS } from "../../../../protocol/coding-agent/harness-adapter.ts";
import { GUI_HARNESSES } from "../../../../protocol/extensions/mod.ts";
import { useCodingSessions } from "../../data/mod.ts";
import { Face } from "../../parts/mod.ts";
import { useOpenCoding } from "./open.tsx";
import { harnessProfile } from "./parts.tsx";
import { NotRunning, ReadFailed } from "./wake.tsx";

export function CodingAgentGroup({ project }: { project: string }) {
  const { shell, status, reload } = useCodingSessions(project);
  const { open, busy, problem, computer } = useOpenCoding(true);
  // Still reading: nothing yet. A read that failed is said, not hidden.
  if (shell === null && status !== "failed") return null;
  return (
    <>
      <Label>{t("mobile.ops.agents.coding", { computer })}</Label>
      {shell === null ? (
        <ReadFailed computer={computer} onRetry={reload} />
      ) : shell === "absent" ? (
        <NotRunning computer={computer} />
      ) : (
        <>
          {GUI_HARNESSES.map((harness) => {
            const label = HARNESS_ADAPTERS[harness].label;
            return (
              <Row
                key={harness}
                lead={<Face profile={harnessProfile(harness, label)} size={30} />}
                title={label}
                strong
                dim={busy}
                onPress={() => void open(project, harness, label)}
              />
            );
          })}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, paddingTop: 4 }}>
            {busy ? (
              <Working>{t("mobile.coding.notice.opening", { computer })}</Working>
            ) : (
              <>
                <Icon icon={Monitor} size={14} tone="muted" />
                <Text variant="note" tone="muted">
                  {t("mobile.coding.notice.new-terminal")}
                </Text>
              </>
            )}
          </View>
          {problem !== null && (
            <Text variant="small" tone="critical" style={{ paddingHorizontal: 20, paddingTop: 8 }}>
              {problem.text}
            </Text>
          )}
        </>
      )}
    </>
  );
}

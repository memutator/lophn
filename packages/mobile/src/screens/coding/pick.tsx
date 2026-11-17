// The coding agents of the computer in the new session screen's agent sheet (tools/wireframes/drafts/phone/coding.tsx
// Pick), under the lophn agents. Only in a project. The list is the fixed set of GUI harnesses, so it stands at once;
// the computer's answer only says whether its app runs, and until it comes a row cannot be picked. Picking one opens
// nothing: the new session's first message does. Without the computer's app the line that starts it stands under the
// rows; the app is never started by looking at this.
import { t } from "@lophn/i18n";
import { Icon, Label, Row } from "@lophn/ui-native";
import { Check } from "lucide-react-native";
import { HARNESS_ADAPTERS } from "../../../../protocol/coding-agent/harness-adapter.ts";
import { GUI_HARNESSES, type GuiHarness } from "../../../../protocol/extensions/mod.ts";
import { useCodingSessions, useCurrentComputer } from "../../data/mod.ts";
import { Face } from "../../parts/mod.ts";
import { harnessProfile } from "./parts.tsx";
import { NotRunning, ReadFailed } from "./wake.tsx";

export function CodingAgentGroup({
  project,
  picked,
  onPick,
}: {
  project: string;
  /** The harness picked now, if any. */
  picked: GuiHarness | null;
  onPick: (harness: GuiHarness) => void;
}) {
  const { shell, status, reload } = useCodingSessions(project);
  const computer = useCurrentComputer()?.name ?? "";
  const ready = shell === "attached";
  return (
    <>
      <Label>{t("mobile.ops.agents.coding", { computer })}</Label>
      {GUI_HARNESSES.map((harness) => {
        const label = HARNESS_ADAPTERS[harness].label;
        return (
          <Row
            key={harness}
            lead={<Face profile={harnessProfile(harness, label)} size={30} />}
            title={label}
            strong
            dim={!ready}
            end={picked === harness ? <Icon icon={Check} /> : undefined}
            onPress={ready ? () => onPick(harness) : undefined}
          />
        );
      })}
      {shell === "absent" ? (
        <NotRunning computer={computer} />
      ) : (
        status === "failed" && <ReadFailed computer={computer} onRetry={reload} />
      )}
    </>
  );
}

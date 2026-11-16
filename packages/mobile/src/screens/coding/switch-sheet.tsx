// Asking before a terminal session becomes a chat (tools/wireframes/drafts/phone/coding.tsx SwitchSheet). Switching
// restarts the agent on the computer: a running turn is cut off and the desktop tab turns into the chat view, so the
// sheet reads what would stop first and switches only when the person presses Switch.
import { t } from "@lophn/i18n";
import { Button, Sheet, Text } from "@lophn/ui-native";
import { RefreshCw } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { type CodingSession, useCodingActions, useCurrentComputer } from "../../data/mod.ts";
import { useLocked } from "../../parts/mod.ts";
import { blockedText } from "./parts.tsx";

type Plan = Extract<Awaited<ReturnType<ReturnType<typeof useCodingActions>["switchPlan"]>>, { ok: true }>["value"];

function problemText(code: string, harness: string, computer: string): string {
  switch (code) {
    case "conflict":
      return t("mobile.coding.error.switch-conflict", { harness, computer });
    case "unavailable":
      return t("mobile.coding.error.switch-unavailable", { computer });
    case "not_found":
      return t("mobile.coding.error.switch-not-found", { computer });
    default:
      return t("mobile.coding.error.switch-failed", { harness });
  }
}

/** Open while `session` is set. Closes itself once the switch went through; the session's screen then shows the chat. */
export function SwitchSheet({ session, onClose }: { session: CodingSession | null; onClose: () => void }) {
  const actions = useCodingActions();
  const computer = useCurrentComputer()?.name ?? "";
  const locked = useLocked();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = session?.session ?? null;
  const harness = session?.label ?? "";

  useEffect(() => {
    setPlan(null);
    setProblem(null);
    if (id === null) return;
    let live = true;
    void actions.switchPlan(id).then((read) => {
      if (!live) return;
      if (read.ok) setPlan(read.value);
      else setProblem(read.code);
    });
    return () => {
      live = false;
    };
  }, [actions, id]);

  const run = async () => {
    if (id === null) return;
    setBusy(true);
    setProblem(null);
    const done = await actions.switchView(id, "gui");
    setBusy(false);
    if (done.ok) onClose();
    else setProblem(done.code);
  };

  const blocked = plan?.blocked ?? null;
  return (
    <Sheet open={session !== null} onClose={onClose} title={t("mobile.coding.title.switch", { harness })}>
      <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12, gap: 8 }}>
        {plan !== null && (
          <Text tone="secondary">
            {blocked !== null
              ? blockedText(blocked, harness, computer)
              : t("mobile.coding.notice.switch", {
                  turn: plan.stops.turn ? "yes" : "no",
                  tasks: plan.stops.tasks,
                  harness,
                  computer,
                })}
          </Text>
        )}
        {plan !== null && blocked === null && plan.stops.queued > 0 && (
          <Text tone="secondary">{t("terminal.dialog.stop-queued", { count: plan.stops.queued })}</Text>
        )}
        {problem !== null && (
          <Text variant="small" tone="critical">
            {problemText(problem, harness, computer)}
          </Text>
        )}
        <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
          <Button block onPress={onClose}>
            {t("common.button.cancel")}
          </Button>
          <Button
            block
            variant="primary"
            icon={RefreshCw}
            disabled={plan === null || blocked !== null || busy || locked}
            onPress={() => void run()}
          >
            {t("terminal.button.switch")}
          </Button>
        </View>
      </View>
    </Sheet>
  );
}

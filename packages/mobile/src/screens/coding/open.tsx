// Opening a coding session on the computer from the phone: a new one in a project, or a past one continued as chat. The
// computer starts it in a new terminal and the phone goes to its conversation.
import { t } from "@lophn/i18n";
import { StackActions, useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { type PlaceOf, paramsOf, useNav } from "../../app/nav.ts";
import { useCodingActions, useCurrentComputer } from "../../data/mod.ts";
import { blockedText } from "./parts.tsx";

/** Why an open did not go through, in a sentence. Otherwise the computer's own sentence is shown as it is. */
export function problemText(failed: { code: string; message?: string; reason?: string }, harness: string, computer: string): string {
  const { code, message, reason } = failed;
  if (reason === "extension_off") return blockedText("extension_off", harness, computer);
  if (code === "unavailable" && message !== undefined && message !== "") return message;
  return code === "conflict"
    ? t("mobile.coding.error.open-conflict", { harness, computer })
    : t("mobile.coding.error.open-failed", { harness, computer });
}

/**
 * `open(project, harness, label, resume?)` asks the computer and goes to the new session's conversation (`replace`: in
 * place of the current screen, as the new session screen does). `problem` is the sentence for a refusal and `conflict`
 * says the session is already open on the computer.
 */
export function useOpenCoding(replace: boolean) {
  const actions = useCodingActions();
  const nav = useNav();
  const navigation = useNavigation();
  const computer = useCurrentComputer()?.name ?? "";
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; conflict: boolean } | null>(null);

  const open = async (project: string, harness: string, label: string, resume?: { session: string }) => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const opened = await actions.open({ project, harness, resume });
    setBusy(false);
    if (!opened.ok) {
      setProblem({
        text: problemText(opened, label, computer),
        conflict: opened.code === "conflict",
      });
      return;
    }
    const place: PlaceOf<"session"> = {
      name: "session",
      session: opened.value.session,
      coding: { harness, project, cwd: null },
    };
    if (replace) navigation.dispatch(StackActions.replace("session", paramsOf(place)));
    else nav.open(place);
  };
  return { open, busy, problem, computer };
}

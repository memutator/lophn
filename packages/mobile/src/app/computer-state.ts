import { t } from "@lophn/i18n";
import type { DotTone } from "@lophn/ui-native";
import type { ComputerItem } from "../data/mod.ts";

/** A computer's state as a dot and a word: the sidebar, Settings, a computer's page. */
export function stateOf(computer: ComputerItem): {
  tone: DotTone | undefined;
  text: string;
} {
  switch (computer.status) {
    case "connected":
      return { tone: "good", text: t("settings.label.status-connected") };
    case "connecting":
      return { tone: undefined, text: t("mobile.computer.status.connecting") };
    case "offline":
      return { tone: "off", text: t("mobile.computer.status.offline") };
    case "revoked":
      return { tone: "critical", text: t("mobile.computer.status.revoked") };
  }
}

/** The same with how it is reached, for the Computers sheet: "Connected · through the relay". */
export function stateWithPathOf(computer: ComputerItem): {
  tone: DotTone | undefined;
  text: string;
} {
  const state = stateOf(computer);
  if (computer.status !== "connected" || computer.path === null) return state;
  return {
    tone: state.tone,
    text: t(
      computer.path === "relay"
        ? "mobile.computer.status.relay"
        : "mobile.computer.status.direct",
    ),
  };
}

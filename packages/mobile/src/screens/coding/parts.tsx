// What the coding screens share: a coding session's face and name, its state in words, why it cannot switch, and the
// line that says the list did not come.
import { t } from "@lophn/i18n";
import { Button, type DotTone, Icon, Text, useTheme } from "@lophn/ui-native";
import { SquareTerminal } from "lucide-react-native";
import { View } from "react-native";
import { harnessVendorOf } from "../../../../shell/renderer/parts/vendor-icon/vendors.ts";
import type { Place } from "../../app/nav.ts";
import type { CodingSession, CodingTarget } from "../../data/mod.ts";
import { ago, type Look } from "../../parts/mod.ts";

/** The face of a harness: its product icon, or its initial when lophn has none for it. */
export function harnessAvatar(harness: string, label: string): Look {
  const vendor = harnessVendorOf(harness);
  return vendor === undefined
    ? { kind: "initial", text: label.slice(0, 1) }
    : { kind: "vendor", vendor };
}

export function targetOf(session: CodingSession): CodingTarget {
  return {
    session: session.session,
    coding: {
      harness: session.harness,
      project: session.project,
      cwd: session.cwd,
    },
  };
}

/** The session's name in a list: its title, or its harness's name before it has one. */
export function codingTitle(session: CodingSession): string {
  return session.title ?? session.label;
}

/** The conversation place of a coding session. */
export function codingPlace(session: CodingSession): Place {
  return { name: "session", ...targetOf(session) };
}

/** The session's state as its list line and dot: working, waiting on the person, or idle since its last activity. */
export function stateOf(session: CodingSession): {
  text: string | null;
  tone: DotTone | undefined;
} {
  const at = session.last_active_at;
  switch (session.state) {
    case "running":
      return {
        text:
          at === null
            ? t("conversation.label.status-working")
            : t("mobile.places.session.working", { when: ago(at) }),
        // Green means "finished and not seen" (shell/renderer/parts/agent-session/activity.ts), so running is its own tone.
        tone: "working",
      };
    case "waiting":
      return { text: t("common.label.tab-waiting"), tone: "warning" };
    case "idle":
      return {
        text: at === null ? t("mobile.coding.label.idle") : t("mobile.coding.label.idle-since", { when: ago(at) }),
        tone: undefined,
      };
    default:
      return { text: null, tone: undefined };
  }
}

/** Why the session cannot switch to chat now, in one line. */
export function blockedText(
  blocked: NonNullable<CodingSession["switch"]>["blocked"],
  harness: string,
): string {
  switch (blocked) {
    case "no_session":
      return t("mobile.coding.notice.blocked-no-session", { harness });
    case "not_running":
      return t("mobile.coding.notice.blocked-not-running");
    case "unsupported_os":
      return t("mobile.coding.notice.blocked-unsupported-os");
  }
}

/** The small Terminal mark of a session that runs in a terminal: the kit's Tag with an icon. */
export function TerminalMark() {
  const theme = useTheme();
  return (
    <View
      style={{
        height: 20,
        paddingLeft: 5,
        paddingRight: 7,
        gap: 3,
        borderRadius: 999,
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: theme.color.surface.muted,
      }}
    >
      <Icon icon={SquareTerminal} size={12} tone="secondary" />
      <Text variant="caption" weight="medium" tone="secondary">
        {t("terminal.label.output")}
      </Text>
    </View>
  );
}

/** The coding read did not go through: said in the group's place, with a way to read again. */
export function ReadFailed({ computer, onRetry }: { computer: string; onRetry: () => void }) {
  return (
    <View style={{ paddingHorizontal: 20, paddingVertical: 8 }}>
      <Text variant="small" tone="critical">
        {t("mobile.coding.error.read-failed", { computer })}
      </Text>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 12 }}>
        <Button size="sm" onPress={onRetry}>
          {t("common.button.retry")}
        </Button>
      </View>
    </View>
  );
}

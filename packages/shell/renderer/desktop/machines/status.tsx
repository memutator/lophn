// 기계의 상태를 색·아이콘·글로 보인다. 기계 고르기와 Settings의 Computers you view가 같은 글을 쓴다.
import { formatRelativeTime, t } from "@lophn/i18n";
import { StatusMark } from "@lophn/ui/feedback";

import type { MachineItem } from "./source.ts";

function lastSeen(at: string | null): string | null {
  return at === null
    ? null
    : t("machines.status.last-seen", {
        time: formatRelativeTime(new Date(at), new Date()),
      });
}

/** 상태 이름(label)과 덧붙일 말(detail: 연결된 길, 마지막으로 본 때). */
export function statusParts(machine: MachineItem): {
  label: string;
  detail: string | null;
} {
  switch (machine.status) {
    case "connecting":
      return { label: t("machines.status.connecting"), detail: null };
    case "connected":
      return {
        label: t("machines.status.connected"),
        detail:
          machine.path === null
            ? null
            : t(
                machine.path === "relay"
                  ? "machines.status.relay"
                  : "machines.status.direct",
              ),
      };
    case "offline":
      return {
        label: t("machines.status.offline"),
        detail: lastSeen(machine.lastSeenAt),
      };
    case "update":
      return {
        label:
          machine.update === "client"
            ? t("machine-update.viewer.status-desktop-client")
            : t("machine-update.viewer.status-host", { name: machine.name }),
        detail: null,
      };
    case "removed":
      return { label: t("machines.status.removed"), detail: null };
  }
}

const TONE = {
  connecting: "neutral",
  connected: "good",
  offline: "neutral",
  update: "warning",
  removed: "critical",
} as const;

/** 짧게(기계 고르기): 붙어 있으면 길, 꺼져 있으면 마지막으로 본 때. full이면 상태 이름을 앞에 붙인다(Settings). */
export function MachineStatus({
  machine,
  full = false,
}: {
  machine: MachineItem;
  full?: boolean;
}) {
  const { label, detail } = statusParts(machine);
  return (
    <StatusMark
      tone={TONE[machine.status]}
      label={
        full && detail !== null
          ? t("machines.status.with-detail", { label, detail })
          : (detail ?? label)
      }
    />
  );
}

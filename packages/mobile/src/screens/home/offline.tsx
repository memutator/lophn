// Home while the computer cannot be reached (tools/wireframes/drafts/phone/shell.tsx Offline): what is said, the apps dimmed,
// and the sessions as they were the last time the phone heard from it.
import { t } from "@lophn/i18n";
import { Banner, Button, Dot, type DotTone, Label, Row } from "@lophn/ui-native";
import { RefreshCw, WifiOff } from "lucide-react-native";
import {
  type ComputerItem,
  type SessionRow,
  type WorkspaceView,
} from "../../data/mod.ts";
import { Face, LOPHN } from "../../parts/mod.ts";
import { ago } from "./ago.ts";
import { Apps } from "./apps.tsx";

const DOT: Record<SessionRow["status"], DotTone | undefined> = {
  waiting: "warning",
  working: "good",
  failed: "critical",
  idle: undefined,
};

function wasOf(row: SessionRow) {
  if (row.status === "working") return t("mobile.home.row.was-working");
  return t(
    row.waitingFor === "approval"
      ? "mobile.home.row.was-approval"
      : row.waitingFor === "answer"
        ? "mobile.home.row.was-answer"
        : "mobile.home.row.was-waiting",
  );
}

export function OfflineBody({
  computer,
  apps,
  workspaces,
  leftAt,
  onRetry,
}: {
  computer: ComputerItem;
  apps: readonly WorkspaceView[];
  workspaces: readonly WorkspaceView[];
  /** When the phone last heard from it, if it did while this screen was up. */
  leftAt: number | null;
  onRetry: () => void;
}) {
  const now = Date.now();
  const rows = workspaces
    .flatMap((workspace) => workspace.groups.flatMap((group) => group.rows))
    .filter((row) => row.status === "waiting" || row.status === "working")
    .sort((a, b) => b.at - a.at);
  const minutes = leftAt === null ? 0 : Math.floor((now - leftAt) / 60_000);
  const seen =
    leftAt === null
      ? t("mobile.home.heading.last-known")
      : minutes < 1
        ? t("mobile.home.heading.last-seen-now")
        : t("mobile.home.heading.last-seen", { time: ago(leftAt, now) });
  const revoked = computer.status === "revoked";
  return (
    <>
      <Banner
        icon={WifiOff}
        title={
          revoked
            ? t("mobile.computer.status.revoked")
            : t(
                computer.status === "connecting"
                  ? "mobile.home.banner.connecting"
                  : "mobile.home.banner.offline",
                { name: computer.name },
              )
        }
        action={
          computer.status === "offline" ? (
            <Button size="sm" icon={RefreshCw} onPress={onRetry}>
              {t("common.button.retry")}
            </Button>
          ) : undefined
        }
      >
        {revoked
          ? undefined
          : t(
              computer.status === "connecting"
                ? "mobile.home.note.connecting"
                : "mobile.home.note.offline",
            )}
      </Banner>
      {apps.length > 0 && (
        <>
          <Label>{t("common.heading.apps")}</Label>
          <Apps apps={apps} offline onOpen={() => {}} />
        </>
      )}
      {rows.length > 0 && (
        <>
          <Label>{seen}</Label>
          {rows.map((row) => (
            <Row
              key={row.id}
              dim
              lead={<Face profile={row.who?.profile ?? LOPHN} />}
              title={row.title ?? t("left-sidebar.label.untitled")}
              sub={wasOf(row)}
              end={<Dot tone={DOT[row.status]} />}
            />
          ))}
        </>
      )}
    </>
  );
}

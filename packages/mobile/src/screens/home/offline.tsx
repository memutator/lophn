// Home while the computer cannot be reached (tools/wireframes/drafts/phone/shell.tsx Offline): what is said, the apps
// (dimmed but for the ones on this phone, which open), and the sessions as they were the last time the phone heard from it.
import { formatRelativeTime, t } from "@lophn/i18n";
import { Label, Row } from "@lophn/ui-native";
import type { SessionRow, WorkspaceView } from "../../data/mod.ts";
import { Face, LOPHN, OfflineBanner, SessionDot } from "../../parts/mod.ts";
import { Apps } from "./apps.tsx";

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
  apps,
  onPhone,
  onOpen,
  workspaces,
  leftAt,
}: {
  apps: readonly WorkspaceView[];
  /** The apps installed on this phone: they open without the computer. */
  onPhone: ReadonlySet<string>;
  onOpen: (app: WorkspaceView) => void;
  workspaces: readonly WorkspaceView[];
  /** When the phone last heard from it, if it did while this screen was up. */
  leftAt: number | null;
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
        : t("mobile.home.heading.last-seen", { time: formatRelativeTime(new Date(leftAt), new Date(now)) });
  return (
    <>
      <OfflineBanner
        note={t(onPhone.size > 0 ? "mobile.local.note.offline" : "mobile.home.note.offline")}
      />
      {apps.length > 0 && (
        <>
          <Label>{t("common.heading.apps")}</Label>
          <Apps apps={apps} away={(app) => !onPhone.has(app.key)} onOpen={onOpen} />
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
              end={<SessionDot status={row.status} />}
            />
          ))}
        </>
      )}
    </>
  );
}

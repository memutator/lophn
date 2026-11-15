// A workspace's sessions: grouped by worktree, then Recent. The sessions tab of a project and of an app.
import { t } from "@lophn/i18n";
import { type DotTone, Dot, Label, Row } from "@lophn/ui-native";
import { Fragment } from "react";
import { lophnIdOf } from "../../../../protocol/lophn-agent/workspaces.ts";
import { useNav } from "../../app/nav.ts";
import {
  type SessionRow,
  type SessionStatus,
  type WorkspaceView,
} from "../../data/mod.ts";
import { Face, LOPHN } from "../../parts/mod.ts";
import { Empty, when } from "./common.tsx";

const DOT: Record<SessionStatus, DotTone | undefined> = {
  waiting: "warning",
  working: "good",
  failed: "critical",
  idle: undefined,
};

function subOf(row: SessionRow): string {
  switch (row.status) {
    case "waiting":
      return t(
        row.waitingFor === "approval"
          ? "conversation.label.status-waiting-approval"
          : row.waitingFor === "answer"
            ? "conversation.label.status-waiting-answer"
            : "common.label.tab-waiting",
      );
    case "working":
      return row.at === 0
        ? t("conversation.label.status-working")
        : t("mobile.places.session.working", { when: when(row.at) });
    default:
      return row.at === 0
        ? t("app-detail.label.state-done")
        : t("mobile.places.session.done", { when: when(row.at) });
  }
}

export function SessionList({ view }: { view: WorkspaceView }) {
  const nav = useNav();
  const open = (row: SessionRow) =>
    nav.open({
      name: "session",
      session: row.id,
      // A session's agent is known once its first event arrives; until then it is its workspace's lophn.
      agent: row.agent ?? lophnIdOf(row.workspace),
      workspace: row.workspace,
    });
  if (view.groups.length === 0 && view.recent.length === 0) {
    return <Empty>{t("mobile.places.session.empty")}</Empty>;
  }
  return (
    <>
      {view.groups.map((group) => (
        <Fragment key={group.label ?? ""}>
          {group.label !== null && <Label>{group.label}</Label>}
          {group.rows.map((row) => (
            <Row
              key={row.id}
              lead={<Face profile={row.who?.profile ?? LOPHN} size={24} />}
              title={row.title ?? t("left-sidebar.label.untitled")}
              sub={subOf(row)}
              end={<Dot tone={DOT[row.status]} />}
              onPress={() => open(row)}
            />
          ))}
        </Fragment>
      ))}
      {view.recent.length > 0 && (
        <>
          <Label end={String(view.recent.length)}>
            {t("left-sidebar.label.recent")}
          </Label>
          {view.recent.map((row) => (
            <Row
              key={row.id}
              dim
              lead={<Face profile={row.who?.profile ?? LOPHN} size={24} />}
              title={row.title ?? t("left-sidebar.label.untitled")}
              sub={row.at === 0 ? undefined : when(row.at)}
              onPress={() => open(row)}
            />
          ))}
        </>
      )}
    </>
  );
}

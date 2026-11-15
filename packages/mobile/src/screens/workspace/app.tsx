// An app workspace: the app's line on top, tabs for its sessions and its activity, the release that is live, and a box
// at the bottom that asks lophn to change the app. The app's own screen on the phone comes in a later plan, so for now
// this is where lophn's work on the app is seen.
import { formatDate, t } from "@lophn/i18n";
import {
  Banner,
  Button,
  Icon,
  Label,
  Row,
  Screen,
  Tabs,
  Text,
  TopBar,
} from "@lophn/ui-native";
import { History, Info, ScrollText } from "lucide-react-native";
import { Fragment, useState } from "react";
import { type PlaceOf, useNav } from "../../app/nav.ts";
import {
  useWorkspaces,
  type Workspace,
  type WorkspaceView,
} from "../../data/mod.ts";
import {
  type ActivityRun,
  useAppActivity,
  useAppRelease,
  useSessionTarget,
} from "../../data/places.ts";
import { WorkspaceMark } from "../../parts/mod.ts";
import { AskBar, Empty, Failed, when } from "./common.tsx";
import { SessionList } from "./sessions.tsx";

const humanize = (tool: string) => {
  const words = tool.replace(/[_-]+/g, " ");
  return words.slice(0, 1).toUpperCase() + words.slice(1);
};

const STATE = {
  done: ["app-detail.label.state-done", "good"],
  failed: ["app-detail.label.state-failed", "critical"],
  running: ["app-detail.label.state-running", "muted"],
  cancelled: ["run-list.label.cancelled", "muted"],
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

// The day a run belongs to, said as Today, Yesterday, then the date.
function dayOf(at: string): string {
  const day = (time: number) =>
    Math.floor(new Date(time).setHours(0, 0, 0, 0) / DAY_MS);
  const age = day(Date.now()) - day(Date.parse(at));
  if (age <= 0) return t("common.label.range-today");
  if (age === 1) return t("mobile.places.activity.yesterday");
  return formatDate(new Date(at));
}

function FailedNote({ run }: { run: ActivityRun }) {
  const nav = useNav();
  const target = useSessionTarget(run.session);
  return (
    <Banner
      icon={Info}
      title={run.error ?? ""}
      action={
        target === null ? undefined : (
          <Button
            size="sm"
            onPress={() => nav.open({ name: "session", ...target })}
          >
            {t("mobile.places.activity.open-session")}
          </Button>
        )
      }
    />
  );
}

/** What the app did, newest first, a day at a time; a failed run says why. */
export function ActivityList({ app }: { app: string }) {
  const activity = useAppActivity(app);
  if (activity.loaded.state === "failed") {
    return <Failed onRetry={activity.reload} />;
  }
  if (activity.loaded.state !== "ready") return null;
  const runs = activity.loaded.value;
  if (runs.length === 0) {
    return <Empty>{t("mobile.places.activity.empty")}</Empty>;
  }
  let last = "";
  return (
    <>
      {runs.map((run) => {
        const day = dayOf(run.at);
        const head = day !== last;
        last = day;
        const [label, tone] = STATE[run.state];
        return (
          <Fragment key={run.id}>
            {head && <Label>{day}</Label>}
            <Row
              lead={<Icon icon={ScrollText} />}
              title={
                run.tool === null
                  ? t("mobile.places.activity.agent-run")
                  : humanize(run.tool)
              }
              sub={
                run.tool === null
                  ? when(run.at)
                  : t("mobile.places.activity.sub", {
                      tool: run.tool,
                      by: run.job ? "job" : "other",
                      when: when(run.at),
                    })
              }
              end={
                <Text variant="small" tone={tone}>
                  {t(label)}
                </Text>
              }
            />
            {run.state === "failed" && run.error !== null && (
              <FailedNote run={run} />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

function ReleaseRow({ app }: { app: string }) {
  const release = useAppRelease(app);
  if (release.loaded.state !== "ready" || release.loaded.value === null) {
    return null;
  }
  const { number, activatedAt } = release.loaded.value;
  return (
    <Row
      lead={<Icon icon={History} />}
      title={t("shell.label.app-release", { number })}
      sub={t("mobile.places.app.went-live", { when: when(activatedAt) })}
    />
  );
}

export function AppWorkspace({ view }: { view: WorkspaceView }) {
  const nav = useNav();
  const [tab, setTab] = useState(0);
  const name = view.name ?? view.key;
  return (
    <Screen
      top={
        <>
          <TopBar
            {...nav.menuButton}
            lead={<WorkspaceMark icon={view.icon} name={name} />}
            title={name}
          />
          <Tabs
            items={[
              t("mobile.frame.label.sessions"),
              t("app-detail.label.tab-activity"),
            ]}
            on={tab}
            onChange={setTab}
          />
        </>
      }
      scroll
      footer={
        <AskBar
          workspace={view.workspace as Workspace}
          placeholder={t("mobile.places.composer.app")}
        />
      }
    >
      <ReleaseRow app={view.key} />
      {tab === 0 ? (
        <SessionList view={view} />
      ) : (
        <ActivityList app={view.key} />
      )}
    </Screen>
  );
}

/** The Activity place: the same list as the tab, on its own screen (the app menu opens it). */
export function AppActivityScreen({
  place,
}: {
  place: PlaceOf<"app-activity">;
}) {
  const nav = useNav();
  const name =
    useWorkspaces().find((one) => one.key === place.app)?.name ?? place.app;
  return (
    <Screen
      top={
        <TopBar
          left="back"
          onLeft={nav.back}
          title={t("app-detail.label.tab-activity")}
          under={name}
        />
      }
      scroll
    >
      <ActivityList app={place.app} />
    </Screen>
  );
}

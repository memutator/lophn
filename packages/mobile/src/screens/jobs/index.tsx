// Jobs and one job (tools/wireframes/drafts/phone/more.tsx Jobs, JobDetail). The phone shows, switches on and off, and runs
// a missed turn now; editing and deleting stay on the computer.
import { t } from "@lophn/i18n";
import {
  Button,
  Divider,
  Icon,
  Label,
  Row,
  Screen,
  STATUS_ICONS,
  Switch,
  Text,
  TopBar,
} from "@lophn/ui-native";
import { Play } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { type PlaceOf, useNav } from "../../app/nav.ts";
import {
  actionText,
  agentName,
  type JobNames,
  type JobView,
  MISSED_OPTIONS,
  nextText,
  runText,
  sourceGoneText,
  STATE,
  useJobRuns,
  useJobs,
  useMachineNameOf,
  whenOf,
  whenText,
} from "../../data/mod.ts";
import { ago, DIM, EmptyNote, OfflineBanner } from "../../parts/mod.ts";
import { FactRow, Foot, ReadFailed } from "./parts.tsx";


// Who made the job, and where: "Budget reviewer · Orders". Home's lophn is just "lophn".
function madeBy(creator: JobView["creator"], names: JobNames): string {
  const agent = agentName(creator.agent, names);
  const { workspace } = creator;
  if (workspace === null) return agent;
  const table = workspace.kind === "project" ? names.projects : names.apps;
  return t("agents.label.settings-lophn-in", {
    agent,
    workspace: table[workspace.id] ?? "",
  });
}

// A held job's missed turn waits for the person; saying so beats saying when it runs next.
const nextOf = (job: JobView, held: boolean) =>
  held && job.enabled
    ? t("jobs.label.waiting-decision")
    : nextText(job, new Date());

function JobItem({
  job,
  names,
  held,
  locked,
  onOpen,
  onSwitch,
}: {
  job: JobView;
  names: JobNames;
  held: boolean;
  locked: boolean;
  onOpen: () => void;
  onSwitch: (enabled: boolean) => void;
}) {
  const now = new Date();
  const machineNameOf = useMachineNameOf();
  const action = actionText(job.action, names);
  const last = job.last_run;
  const tone = last === null ? "neutral" : STATE[last.state].tone;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={{
        flexDirection: "row",
        gap: 12,
        paddingTop: 12,
        paddingBottom: 14,
        paddingHorizontal: 20,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text weight="semibold" style={{ lineHeight: 22 }}>
          {job.title}
        </Text>
        <Text variant="detail" tone="secondary" style={{ marginTop: 2 }}>
          {t("mobile.ops.job.when-next", {
            when: whenOf(job, machineNameOf),
            next: nextOf(job, held),
          })}
        </Text>
        <View style={{ marginTop: 4 }}>
          <Text variant="detail">
            {job.action.kind === "agent_run"
              ? action.summary
              : t("mobile.ops.job.does", {
                  action: action.summary,
                  detail: action.detail,
                })}
          </Text>
        </View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            marginTop: 4,
          }}
        >
          {last !== null && (
            <Icon icon={STATUS_ICONS[tone]} size={15} tone={tone} />
          )}
          <Text variant="note" tone="muted" numberOfLines={1} grow>
            {last === null
              ? t("jobs.label.not-yet")
              : t("mobile.ops.job.last", {
                  state: t(STATE[last.state].label),
                  time: whenText(last.started_at ?? last.due_at, now),
                })}
          </Text>
        </View>
      </View>
      <View pointerEvents={locked ? "none" : "auto"} style={{ paddingTop: 2 }}>
        <Switch
          on={job.enabled}
          onChange={onSwitch}
          label={t(
            job.enabled
              ? "settings.label.value-on"
              : "settings.label.value-off",
          )}
        />
      </View>
    </Pressable>
  );
}

export function JobsScreen(_: { place: PlaceOf<"jobs"> }) {
  const nav = useNav();
  const jobs = useJobs();
  const [failed, setFailed] = useState(false);
  const { loaded, locked } = jobs;
  return (
    <Screen
      top={<TopBar {...nav.menuButton} title={t("left-sidebar.button.jobs")} />}
      scroll
    >
      <OfflineBanner note={t("mobile.offline.note")} />
      <View style={{ opacity: locked ? DIM : 1 }}>
        {loaded.state === "failed" && (
          <ReadFailed target={t("jobs.label.target")} onRetry={jobs.reload} />
        )}
        {loaded.state === "ready" && (
          <>
            <Text
              variant="note"
              tone="muted"
              style={{ marginTop: 2, marginBottom: 6, marginHorizontal: 20 }}
            >
              {t("jobs.note.intro")}
            </Text>
            {failed && (
              <Text
                variant="note"
                tone="critical"
                style={{ marginHorizontal: 20 }}
              >
                {t("jobs.error.save")}
              </Text>
            )}
            {loaded.value.jobs.length === 0 && (
              <EmptyNote>
                {`${t("jobs.empty.all")} ${t("jobs.empty.sidebar-ask")}`}
              </EmptyNote>
            )}
            {loaded.value.jobs.map((job, at) => (
              <View key={job.id}>
                {at > 0 && <Divider />}
                <JobItem
                  job={job}
                  names={loaded.value.names}
                  held={jobs.held(job.id)}
                  locked={locked}
                  onOpen={() => nav.open({ name: "job", id: job.id })}
                  onSwitch={(enabled) =>
                    void jobs
                      .setEnabled(job.id, enabled)
                      .then((ok) => setFailed(!ok))
                  }
                />
              </View>
            ))}
          </>
        )}
      </View>
    </Screen>
  );
}

export function JobScreen({ place }: { place: PlaceOf<"job"> }) {
  const machineNameOf = useMachineNameOf();
  const nav = useNav();
  const jobs = useJobs();
  const runs = useJobRuns(place.id);
  const [failed, setFailed] = useState(false);
  const { loaded, locked } = jobs;
  const found =
    loaded.state === "ready"
      ? loaded.value.jobs.find((one) => one.id === place.id)
      : undefined;
  const names = loaded.state === "ready" ? loaded.value.names : undefined;
  const held = found !== undefined && jobs.held(found.id);
  const now = new Date();

  const sessionOf = (session: string | null) =>
    session !== null && found?.action.kind === "agent_run"
      ? {
          name: "session" as const,
          session,
          agent: found.action.agent,
          workspace: found.action.agent_workspace,
        }
      : null;

  return (
    <Screen
      top={
        <TopBar
          left="back"
          onLeft={nav.back}
          title={found?.title ?? t("left-sidebar.button.jobs")}
          right={
            found !== undefined && (
              <View
                pointerEvents={locked ? "none" : "auto"}
                style={{ marginRight: 12, opacity: locked ? DIM : 1 }}
              >
                <Switch
                  on={found.enabled}
                  onChange={(enabled) =>
                    void jobs
                      .setEnabled(found.id, enabled)
                      .then((ok) => setFailed(!ok))
                  }
                  label={t(
                    found.enabled
                      ? "settings.label.value-on"
                      : "settings.label.value-off",
                  )}
                />
              </View>
            )
          }
        />
      }
      scroll
      footer={
        found !== undefined && (
          <View
            style={{
              gap: 8,
              paddingTop: 12,
              paddingHorizontal: 20,
              paddingBottom: 10,
            }}
          >
            {held && (
              <Button
                variant="primary"
                size="lg"
                icon={Play}
                disabled={locked}
                onPress={() =>
                  void jobs.startNow(found.id).then((ok) => setFailed(!ok))
                }
              >
                {t("waiting.button.start-now")}
              </Button>
            )}
            <Foot>{t("mobile.ops.job.on-computer")}</Foot>
          </View>
        )
      }
    >
      <OfflineBanner note={t("mobile.offline.note")} />
      <View style={{ opacity: locked ? DIM : 1 }}>
        {loaded.state === "failed" && (
          <ReadFailed target={t("jobs.label.target")} onRetry={jobs.reload} />
        )}
        {failed && (
          <Text
            variant="note"
            tone="critical"
            style={{ marginHorizontal: 20, marginTop: 8 }}
          >
            {t("jobs.error.save")}
          </Text>
        )}
        {found !== undefined && names !== undefined && (
          <>
            <FactRow label={t("jobs.label.trigger-field")}>
              {whenOf(found, machineNameOf)}
            </FactRow>
            <FactRow
              label={t(
                found.trigger === null
                  ? "mobile.ops.job.label-next"
                  : "mobile.ops.job.label-activity",
              )}
            >
              {/* A value on its own, not inside a sentence: "In 3 hours". */}
              {(found.next_due_at !== null
                ? whenText(found.next_due_at, now)
                : nextText(found, now)
              ).replace(/^./, (first) => first.toUpperCase())}
            </FactRow>
            <FactRow label={t("mobile.ops.job.label-does")}>
              {found.action.kind === "agent_run"
                ? t("mobile.ops.job.does-prompt", {
                    action: actionText(found.action, names).summary,
                    prompt: found.action.prompt,
                  })
                : t("mobile.ops.job.does", {
                    action: actionText(found.action, names).summary,
                    detail: actionText(found.action, names).detail,
                  })}
            </FactRow>
            {found.trigger === null && (
              <FactRow label={t("jobs.label.if-missed")}>
                {t(
                  MISSED_OPTIONS.find(
                    (one) => one.value === found.missed_policy,
                  )!.label,
                )}
              </FactRow>
            )}
            <FactRow label={t("mobile.ops.job.label-made-by")}>
              {madeBy(found.creator, names)}
            </FactRow>
            {sourceGoneText(found) !== null && (
              <Text
                variant="note"
                tone="muted"
                style={{ marginHorizontal: 20, marginTop: 6 }}
              >
                {sourceGoneText(found)}
              </Text>
            )}
          </>
        )}
        <Label>{t("mobile.ops.job.label-runs")}</Label>
        {runs.state === "failed" && (
          <Text variant="note" tone="muted" style={{ marginHorizontal: 20 }}>
            {t("jobs.error.history")}
          </Text>
        )}
        {runs.state === "ready" && runs.value.length === 0 && (
          <EmptyNote>{t("jobs.note.no-history")}</EmptyNote>
        )}
        {runs.state === "ready" &&
          runs.value.map((run) => {
            const tone = STATE[run.state].tone;
            const target = sessionOf(run.session);
            return (
              <Row
                key={run.id}
                lead={<Icon icon={STATUS_ICONS[tone]} tone={tone} />}
                title={t(STATE[run.state].label)}
                sub={runText(run)}
                end={ago(run.started_at ?? run.due_at)}
                onPress={target === null ? undefined : () => nav.open(target)}
              />
            );
          })}
      </View>
    </Screen>
  );
}

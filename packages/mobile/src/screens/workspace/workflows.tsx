// The Workflows tab of a project and the screen of one run (tools/wireframes/drafts/phone/workspace.tsx Workflows, Instance).
// The people-and-agents step workflow is read and stopped here; writing a definition is the agent's job.
import { t } from "@lophn/i18n";
import {
  AskCard,
  Button,
  Divider,
  Icon,
  Input,
  Label,
  Markdown,
  Row,
  Screen,
  Sheet,
  Text,
  TopBar,
} from "@lophn/ui-native";
import {
  Check,
  ChevronRight,
  Circle,
  CircleDot,
  FileText,
  type LucideIcon,
  MessageCircle,
  Play,
  Square,
  TriangleAlert,
  Workflow,
} from "lucide-react-native";
import { Fragment, useState } from "react";
import { View } from "react-native";
import { type PlaceOf, useNav } from "../../app/nav.ts";
import { useNames } from "../../data/mod.ts";
import {
  useSessionTarget,
  useWorkflowRun,
  useWorkflows,
  type WorkflowDefinition,
  type WorkflowDetail,
  type WorkflowRunSummary,
} from "../../data/places.ts";
import {
  notHandedKey,
  participantText,
  type Shown,
  shownOf,
  STATE_KEY,
  STEP_KEY,
  type StepShown,
  stepRows,
  turnOf,
} from "./workflow-model.ts";
import { Empty, Failed, when } from "./common.tsx";

const firstLine = (text: string) => text.trim().split("\n")[0] ?? "";

// ---- the tab

function StartSheet({
  entry,
  onClose,
  onStart,
}: {
  entry: WorkflowDefinition | null;
  onClose: () => void;
  onStart: (entry: WorkflowDefinition, text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [failed, setFailed] = useState(false);
  return (
    <Sheet
      open={entry !== null}
      onClose={onClose}
      title={
        entry === null
          ? undefined
          : t("workflow.heading.start", { workflow: entry.name })
      }
    >
      <View style={{ gap: 12, paddingHorizontal: 20, paddingBottom: 8 }}>
        <Text variant="note" tone="muted">
          {t(
            entry?.kind === "flow"
              ? "workflow.note.input-help-flow"
              : "workflow.note.input-help",
          )}
        </Text>
        <Input
          autoFocus
          value={text}
          onChangeText={setText}
          placeholder={t("mobile.places.workflow.input")}
        />
        {failed && (
          <Text variant="small" tone="critical">
            {t("workflow.error.start-failed")}
          </Text>
        )}
        <Button
          variant="primary"
          icon={Play}
          disabled={text.trim() === ""}
          onPress={async () => {
            if (entry === null) return;
            setFailed(false);
            if (await onStart(entry, text.trim())) setText("");
            else setFailed(true);
          }}
        >
          {t("workflow.button.start")}
        </Button>
      </View>
    </Sheet>
  );
}

const SHOWN_ICON = {
  running: { icon: Play, tone: "good" },
  human: { icon: MessageCircle, tone: "warning" },
  ended: { icon: Check, tone: "muted" },
  stopped: { icon: Square, tone: "muted" },
} as const;

function InstanceRow({
  instance,
  onPress,
}: {
  instance: WorkflowRunSummary;
  onPress: () => void;
}) {
  const shown = shownOf(instance.state, instance.current);
  const mark = SHOWN_ICON[shown];
  const live = instance.state === "running";
  return (
    <Row
      title={firstLine(instance.input)}
      sub={
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Icon icon={mark.icon} size={13} tone={mark.tone} />
            <Text variant="small" weight="medium" tone={mark.tone}>
              {t(STATE_KEY[shown])}
            </Text>
          </View>
          <Text variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>
            {[
              live && instance.current !== null
                ? t("workflow.label.at-step", { step: instance.current.step })
                : null,
              when(instance.finished_at ?? instance.created_at),
            ]
              .filter((part) => part !== null)
              .join(" · ")}
          </Text>
        </>
      }
      end={<Icon icon={ChevronRight} size={16} />}
      onPress={onPress}
    />
  );
}

export function WorkflowsTab({ project }: { project: string }) {
  const nav = useNav();
  const flows = useWorkflows(project);
  const [starting, setStarting] = useState<WorkflowDefinition | null>(null);
  if (flows.loaded.state === "loading") return null;
  if (flows.loaded.state === "failed") return <Failed onRetry={flows.reload} />;
  const { definitions, instances } = flows.loaded.value;
  if (definitions.length === 0) {
    return <Empty>{t("workflow.empty.sidebar")}</Empty>;
  }
  const open = (instance: WorkflowRunSummary) =>
    nav.open({ name: "workflow-run", project, run: instance.id });
  const known = new Set(definitions.map((entry) => entry.name));
  const orphans = instances.filter((one) => !known.has(one.workflow));
  return (
    <>
      {definitions.map((entry, at) => {
        const mine = instances.filter((one) => one.workflow === entry.name);
        const running = mine.filter((one) => one.state === "running").length;
        return (
          <Fragment key={entry.name}>
            {at > 0 && <Divider spacing={8} />}
            <Row
              strong
              lead={
                <View style={{ width: 24, alignItems: "center" }}>
                  <Icon icon={Workflow} />
                </View>
              }
              title={entry.name}
              sub={
                entry.state === "invalid"
                  ? t("workflow.label.invalid")
                  : t(
                      entry.kind === "flow"
                        ? "workflow.label.sub-flow"
                        : "workflow.label.sub-agent",
                      { count: running },
                    )
              }
              end={
                <Button
                  size="sm"
                  variant={at === 0 ? "primary" : "secondary"}
                  icon={Play}
                  disabled={!entry.startable}
                  onPress={() => setStarting(entry)}
                >
                  {t("workflow.button.start")}
                </Button>
              }
            />
            {mine.length > 0 && (
              <>
                <Label end={String(mine.length)}>
                  {t("workflow.heading.instances")}
                </Label>
                {mine.map((one) => (
                  <InstanceRow
                    key={one.id}
                    instance={one}
                    onPress={() => open(one)}
                  />
                ))}
              </>
            )}
          </Fragment>
        );
      })}
      {orphans.length > 0 && (
        <>
          <Label end={String(orphans.length)}>
            {t("workflow.heading.instances")}
          </Label>
          {orphans.map((one) => (
            <InstanceRow
              key={one.id}
              instance={one}
              onPress={() => open(one)}
            />
          ))}
        </>
      )}
      <StartSheet
        entry={starting}
        onClose={() => setStarting(null)}
        onStart={async (entry, text) => {
          const run = await flows.start(entry, text);
          if (run === null) return false;
          setStarting(null);
          nav.open({ name: "workflow-run", project, run });
          return true;
        }}
      />
    </>
  );
}

// ---- one run

const STEP_ICON: Record<
  StepShown,
  { icon: LucideIcon; tone: "good" | "warning" | "muted" }
> = {
  reported: { icon: Check, tone: "good" },
  human: { icon: CircleDot, tone: "warning" },
  current: { icon: Play, tone: "good" },
  stopped: { icon: Square, tone: "muted" },
  waiting: { icon: Circle, tone: "muted" },
};

// "Your turn on <step>. <agent> is waiting…" with the step in bold: the sentence is one catalog message, so it is formatted
// with a stand-in for the step and cut there.
const MARK = "\u0000";
function YourTurn({ step, agent }: { step: string; agent: string }) {
  const [before = "", after = ""] = t("mobile.places.workflow.your-turn", {
    step: MARK,
    agent,
  }).split(MARK);
  return (
    <Text variant="body" style={{ lineHeight: 22 }}>
      {before}
      <Text weight="semibold">{step}</Text>
      {after}
    </Text>
  );
}

function assignee(
  instance: WorkflowDetail["instance"],
  step: WorkflowDetail["instance"]["steps"][number],
): string | null {
  const name = (key: string) => {
    const participant = instance.participants[key];
    return participant === undefined ? key : participantText(participant);
  };
  // A flow's steps belong to its program, which is no participant.
  if (instance.participants[step.by] === undefined && step.by === "program") {
    return null;
  }
  return step.with === null
    ? name(step.by)
    : t("workflow.label.assignee-with", {
        by: name(step.by),
        with: name(step.with),
      });
}

function Steps({ detail }: { detail: WorkflowDetail }) {
  return (
    <>
      {stepRows(detail).map((row) => {
        const mark = STEP_ICON[row.shown];
        const who = assignee(detail.instance, row.step);
        const text = row.report?.kind === "report" ? row.report.text : null;
        return (
          <View
            key={row.step.name}
            style={{
              flexDirection: "row",
              gap: 10,
              paddingVertical: 10,
              paddingHorizontal: 20,
            }}
          >
            <View style={{ marginTop: 2 }}>
              <Icon icon={mark.icon} size={18} tone={mark.tone} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <Text numberOfLines={1} grow>
                  <Text weight="semibold">{row.step.name}</Text>
                  {who !== null && <Text tone="muted">{`  ${who}`}</Text>}
                </Text>
                <Text variant="small" tone="muted">
                  {t(STEP_KEY[row.shown])}
                </Text>
              </View>
              {(text ?? (row.current ? row.step.prompt : "")) !== "" && (
                <Text
                  variant="detail"
                  tone="secondary"
                  numberOfLines={6}
                  style={{ marginTop: 2, lineHeight: 20 }}
                >
                  {text ?? row.step.prompt}
                </Text>
              )}
              {row.notice !== null && (
                <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
                  <Icon icon={TriangleAlert} size={14} tone="warning" />
                  <Text variant="small" tone="warning" grow>
                    {row.notice.kind === "not_handed"
                      ? t(notHandedKey(row.notice.reason))
                      : t("workflow.note.restarted")}
                  </Text>
                </View>
              )}
            </View>
          </View>
        );
      })}
    </>
  );
}

function Run({
  detail,
  project,
  onStop,
}: {
  detail: WorkflowDetail;
  project: string;
  onStop: () => Promise<boolean>;
}) {
  const nav = useNav();
  const projectName = useProjectName(project);
  const [report, setReport] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const { instance } = detail;
  const turn = turnOf(detail);
  const target = useSessionTarget(turn?.receiver ?? null);
  const shown: Shown = shownOf(instance.state, instance.current);
  const mark = SHOWN_ICON[shown];
  const reports = stepRows(detail).filter(
    (row) => row.report?.kind === "report",
  );
  return (
    <>
      <Screen
        top={
          <TopBar
            left="back"
            onLeft={nav.back}
            title={instance.workflow}
            under={t("mobile.places.workflow.under", {
              project: projectName,
            })}
          />
        }
        scroll
        footer={
          <View
            style={{
              flexDirection: "row",
              gap: 8,
              paddingTop: 12,
              paddingHorizontal: 20,
              paddingBottom: 10,
            }}
          >
            <Button block icon={FileText} onPress={() => setReport(true)}>
              {t("mobile.places.workflow.open-report")}
            </Button>
            {instance.state === "running" && (
              <Button block icon={Square} onPress={() => setConfirm(true)}>
                {t("mobile.places.workflow.stop")}
              </Button>
            )}
          </View>
        }
      >
        <View style={{ paddingHorizontal: 20, paddingTop: 6 }}>
          <Text variant="heading" weight="semibold">
            {instance.input}
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              marginTop: 6,
            }}
          >
            <Icon icon={mark.icon} size={15} tone={mark.tone} />
            <Text variant="detail" weight="medium" tone={mark.tone}>
              {t(STATE_KEY[shown])}
            </Text>
            <Text variant="detail" tone="muted">
              {`· ${t("workflow.label.started-at", {
                when: when(instance.created_at),
              })}`}
            </Text>
          </View>
        </View>
        {turn !== null && (
          <View style={{ marginTop: 14, marginBottom: 6, marginHorizontal: 4 }}>
            <AskCard>
              <YourTurn
                step={turn.step}
                agent={
                  instance.participants[turn.participant] === undefined
                    ? turn.participant
                    : participantText(instance.participants[turn.participant]!)
                }
              />
              <View style={{ marginTop: 12 }}>
                <Button
                  block
                  variant="primary"
                  icon={MessageCircle}
                  disabled={target === null}
                  onPress={() =>
                    target !== null && nav.open({ name: "session", ...target })
                  }
                >
                  {t("mobile.places.workflow.open-conversation")}
                </Button>
              </View>
            </AskCard>
          </View>
        )}
        <Steps detail={detail} />
      </Screen>
      <Sheet
        open={report}
        onClose={() => setReport(false)}
        title={t("mobile.places.workflow.report-title")}
      >
        <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
          {reports.length === 0 && (
            <Text tone="muted">{t("mobile.places.workflow.report-empty")}</Text>
          )}
          {reports.map((row) => (
            <View key={row.step.name} style={{ marginBottom: 14 }}>
              <Text weight="semibold">{row.step.name}</Text>
              <Markdown
                variant="chat"
                source={row.report?.kind === "report" ? row.report.text : ""}
              />
            </View>
          ))}
        </View>
      </Sheet>
      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t("mobile.places.workflow.stop-title")}
      >
        <View style={{ gap: 14, paddingHorizontal: 20, paddingBottom: 8 }}>
          <Text tone="secondary">{t("mobile.places.workflow.stop-body")}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button block onPress={() => setConfirm(false)}>
              {t("common.button.cancel")}
            </Button>
            <Button
              block
              variant="danger"
              icon={Square}
              onPress={() => {
                setConfirm(false);
                void onStop();
              }}
            >
              {t("workflow.button.stop")}
            </Button>
          </View>
        </View>
      </Sheet>
    </>
  );
}

function useProjectName(project: string): string {
  return useNames().projects.get(project) ?? project;
}

export function WorkflowRunScreen({
  place,
}: {
  place: PlaceOf<"workflow-run">;
}) {
  const nav = useNav();
  const run = useWorkflowRun(place.run);
  if (run.loaded.state !== "ready") {
    return (
      <Screen top={<TopBar left="back" onLeft={nav.back} title="" />}>
        {run.loaded.state === "failed" && <Failed onRetry={run.reload} />}
      </Screen>
    );
  }
  return (
    <Run detail={run.loaded.value} project={place.project} onStop={run.stop} />
  );
}

import { readFileSync } from "node:fs";
import { err, ok, parseSeq } from "../../base/mod.ts";
import {
  createProductRedactor,
  type TextRedactor,
} from "../../base/redaction/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import { MESSAGE_CONTENT_MAX_BYTES } from "../../protocol/lophn-agent/mod.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
  Sql,
} from "../../protocol/server/mod.ts";
import {
  type DerivedStatus,
  type RemoteStep,
  type WorkflowCheckpoint,
  type WorkflowChildSummary,
  type WorkflowInstance,
  type WorkflowSessionNode,
  type WorkflowState,
  workflowInstanceActivity,
  workflowInstanceList,
  workflowInstanceRead,
} from "../../protocol/workflows/mod.ts";
import { dataRootOf } from "../lophn-agent/agents/mod.ts";
import { bodyContentOf } from "../lophn-agent/session/mod.ts";
import { sessionStateOf } from "../lophn-agent/session/state.ts";
import { objectPathFor } from "../storage/blobs/mod.ts";
import { KNOWN_SECRETS, type KnownSecretMatch } from "../storage/ledger/mod.ts";
import { loadCheckpoints } from "./checkpoints.ts";
import { remoteStepsOf } from "./remote.ts";
import {
  hasActivity,
  hasTable,
  type InstanceSessionRow,
  lastAssistantMessageBlobs,
  lastFailedTurnReason,
  lastLine,
  lastReports,
  lastStatusLineKind,
  listInstances,
  loadChildInstances,
  loadInstance,
  loadInstanceSessions,
  loadLines,
  loadReportRefs,
  type StatusLineKind,
} from "./store.ts";

const LINES = 200;
const PAGE = 50;
const PREVIEW_MAX_CHARS = 160;
const PREVIEW_SOURCE = {
  concern: "workflows",
  revision: "1",
  scope: "session-preview",
};

export type WorkflowReadDeps = {
  /** test에서 blob root를 명시할 때 쓴다. 생략하면 ledger 파일 위치로 푼다. */
  dataRoot?: string;
  /** test에서 파일 읽기를 바꿀 때 쓴다. */
  readBlobFile?: (path: string) => Uint8Array | null;
};

type Query = Pick<Sql, "get" | "all">;

function defaultReadBlobFile(path: string): Uint8Array | null {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

function knownSecretsOf(snapshot: ReadSnapshot): KnownSecretMatch | undefined {
  if (typeof snapshot.port !== "function") return undefined;
  try {
    return snapshot.port(KNOWN_SECRETS);
  } catch {
    return undefined;
  }
}

// 공백과 줄바꿈을 한 칸으로 접고 최대 max자로 자른다(UTF-16 서로게이트 쌍 중간에서 자르지 않는다).
export function truncatePreview(text: string, max = PREVIEW_MAX_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  let end = max - 1;
  const code = flat.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${flat.slice(0, end)}…`;
}

// 저장 상태(running|ended|stopped)와 줄·checkpoint·연결 세션·원격 step 상태에서 계산 상태(derived_status)를 구한다.
export function deriveWorkflowStatus(input: {
  state: WorkflowState;
  current: WorkflowInstance["current"];
  latestStatusLine: StatusLineKind | null;
  sessions: readonly Pick<WorkflowSessionNode, "waiting_for">[];
  remoteSteps: readonly Pick<RemoteStep, "delivery">[];
  checkpoints?: readonly Pick<WorkflowCheckpoint, "kind" | "state">[];
}): DerivedStatus {
  if (input.state === "ended") return "ended";
  if (input.state === "stopped") return "stopped";
  if (input.sessions.some((s) => s.waiting_for !== null)) return "needs_you";
  if (
    input.latestStatusLine === "step_stalled" ||
    input.latestStatusLine === "not_handed" ||
    input.latestStatusLine === "lophn_restarted" ||
    input.latestStatusLine === "program_exited"
  ) {
    return "blocked";
  }
  const checkpoints = input.checkpoints ?? [];
  let lastInterruptedIdx = -1;
  for (let i = checkpoints.length - 1; i >= 0; i--) {
    if (checkpoints[i]!.state === "interrupted") {
      lastInterruptedIdx = i;
      break;
    }
  }
  if (lastInterruptedIdx >= 0) {
    // 이후 새 checkpoint가 시작·완료됐거나 사용자가 retried/escalated/report로 진행시켰으면 미처리 중단이 아니다.
    const progressedAfter =
      checkpoints.length - 1 > lastInterruptedIdx ||
      input.latestStatusLine === "retried" ||
      input.latestStatusLine === "report" ||
      input.latestStatusLine === "escalated";
    if (!progressedAfter) return "blocked";
  }
  if (
    input.latestStatusLine === "escalated" ||
    input.current?.human_turn === true ||
    checkpoints.some((cp) => cp.kind === "human" && cp.state === "started") ||
    input.remoteSteps.some((step) => step.delivery === "held")
  ) {
    return "needs_you";
  }
  return "working";
}

function sessionLiveState(
  sql: Pick<Sql, "get">,
  row: InstanceSessionRow,
  tables: { turns: boolean; toolCalls: boolean },
): Pick<WorkflowSessionNode, "state" | "waiting_for"> {
  if (row.runs_on !== null || !tables.turns) {
    return { state: "unknown", waiting_for: null };
  }
  if (tables.toolCalls) {
    const derived = sessionStateOf(sql, row.id);
    // GUI 터미널 팀원은 ledger turn 루프를 타지 않아 도는 turn이 없으면 실제 상태를 알 수 없다.
    if (
      row.harness_gui &&
      row.lifecycle === "open" &&
      derived.state === "idle"
    ) {
      return { state: "unknown", waiting_for: null };
    }
    return derived;
  }
  const running =
    sql.get(
      "SELECT 1 AS found FROM turns WHERE session = ? AND state = 'running' LIMIT 1",
      [row.id],
    ) !== undefined;
  if (running) return { state: "running", waiting_for: null };
  return row.harness_gui && row.lifecycle === "open"
    ? { state: "unknown", waiting_for: null }
    : { state: "idle", waiting_for: null };
}

function assistantPreviewOf(
  sql: Query,
  session: string,
  dataRoot: string | null,
  readBlobFile: (path: string) => Uint8Array | null,
  redact: TextRedactor,
): string | null {
  if (dataRoot === null) return null;
  for (const blob of lastAssistantMessageBlobs(sql, session)) {
    if (blob.size < 1 || blob.size > MESSAGE_CONTENT_MAX_BYTES) continue;
    const bytes = readBlobFile(objectPathFor(dataRoot, blob.hash));
    if (bytes === null) continue;
    const content = bodyContentOf(bytes);
    if (!content.ok) continue;
    const raw = content.value.parts
      .flatMap((part) => (part.kind === "text" ? [part.text] : []))
      .join("\n");
    if (raw.trim() === "") continue;
    // 자르기 전에 먼저 redaction해야 잘린 secret 앞부분이 새지 않는다.
    const safe = redact(PREVIEW_SOURCE, "text/plain", raw);
    if (safe === null) return null;
    const preview = truncatePreview(safe, PREVIEW_MAX_CHARS);
    if (preview !== "") return preview;
  }
  return null;
}

function buildSessionNodes(
  snapshot: ReadSnapshot,
  instance: string,
  deps: WorkflowReadDeps,
): WorkflowSessionNode[] {
  const rows = loadInstanceSessions(snapshot.sql, instance);
  if (rows.length === 0) return [];
  const tables = {
    turns: hasTable(snapshot.sql, "turns"),
    toolCalls: hasTable(snapshot.sql, "tool_calls"),
    messages: hasTable(snapshot.sql, "messages"),
    blobRefs: hasTable(snapshot.sql, "blob_refs"),
  };
  const redact = createProductRedactor(knownSecretsOf(snapshot));
  const root =
    tables.messages && tables.blobRefs
      ? dataRootOf(snapshot.sql, deps.dataRoot)
      : err({ code: "unavailable", message: "no messages" });
  const dataRoot = root.ok ? root.value : null;
  const readBlobFile = deps.readBlobFile ?? defaultReadBlobFile;
  return rows.map((row) => {
    const live = sessionLiveState(snapshot.sql, row, tables);
    const rawError =
      tables.turns && row.runs_on === null
        ? lastFailedTurnReason(snapshot.sql, row.id)
        : null;
    const lastError =
      rawError === null ? null : redact(PREVIEW_SOURCE, "text/plain", rawError);
    const lastPreview =
      tables.messages && tables.blobRefs && row.runs_on === null
        ? assistantPreviewOf(
            snapshot.sql,
            row.id,
            dataRoot,
            readBlobFile,
            redact,
          )
        : null;
    return {
      session: row.id as Id<"ses">,
      parent: row.parent as Id<"ses"> | null,
      agent: row.agent,
      workspace: row.workspace,
      ...(row.step === null ? {} : { step: row.step }),
      state: live.state,
      waiting_for: live.waiting_for,
      last_assistant_preview: lastPreview,
      last_error: lastError,
      ...(row.harness_gui ? { harness_gui: true } : {}),
      ...(row.harness !== null ? { harness: row.harness } : {}),
      ...(row.cli_session !== null ? { cli_session: row.cli_session } : {}),
    };
  });
}

function hasWaitingSession(sql: Query, instance: string): boolean {
  const rows = loadInstanceSessions(sql, instance);
  if (rows.length === 0) return false;
  const tables = {
    turns: hasTable(sql, "turns"),
    toolCalls: hasTable(sql, "tool_calls"),
  };
  if (!tables.turns || !tables.toolCalls) return false;
  for (const row of rows) {
    if (row.lifecycle !== "open" || row.runs_on !== null) continue;
    if (sessionStateOf(sql, row.id).waiting_for !== null) return true;
  }
  return false;
}

function deriveSummaryStatus(
  sql: Query,
  instance: WorkflowInstance,
): DerivedStatus {
  if (instance.state === "ended" || instance.state === "stopped") {
    return instance.state;
  }
  const waiting = hasWaitingSession(sql, instance.id);
  const latestStatusLine = waiting
    ? null
    : lastStatusLineKind(sql, instance.id);
  const checkpointsLoaded = loadCheckpoints(sql, instance.id);
  const checkpoints = checkpointsLoaded.ok ? checkpointsLoaded.value : [];
  const remoteSteps =
    waiting ||
    latestStatusLine === "step_stalled" ||
    latestStatusLine === "not_handed" ||
    latestStatusLine === "lophn_restarted" ||
    latestStatusLine === "program_exited" ||
    latestStatusLine === "escalated" ||
    instance.current?.human_turn === true
      ? []
      : remoteStepsOf(sql, instance.id);
  return deriveWorkflowStatus({
    state: instance.state,
    current: instance.current,
    latestStatusLine,
    sessions: waiting ? [{ waiting_for: "approval" }] : [],
    remoteSteps,
    checkpoints,
  });
}

export function createWorkflowReads(deps: WorkflowReadDeps = {}): {
  read: ReadDefinition<typeof workflowInstanceRead>;
  list: ReadDefinition<typeof workflowInstanceList>;
  activity: ReadDefinition<typeof workflowInstanceActivity>;
} {
  return {
    read: {
      route: workflowInstanceRead,
      handle(snapshot, _ctx, input) {
        let after = 0;
        if (input.cursor !== undefined) {
          const seq = parseSeq(input.cursor);
          if (!seq.ok) {
            return err({ code: "invalid_input", message: "invalid cursor" });
          }
          after = Number(seq.value);
        }
        const found = loadInstance(snapshot.sql, input.instance);
        if (!found.ok) return found;
        if (found.value === null) {
          return err({
            code: "not_found",
            message: "workflow instance not found",
          });
        }
        const reports = lastReports(snapshot.sql, input.instance);
        if (!reports.ok) return reports;
        const loaded = loadLines(snapshot.sql, input.instance, {
          after,
          limit: LINES + 1,
        });
        if (!loaded.ok) return loaded;
        const checkpointsLoaded = loadCheckpoints(snapshot.sql, input.instance);
        if (!checkpointsLoaded.ok) return checkpointsLoaded;
        const childInstancesLoaded = loadChildInstances(
          snapshot.sql,
          input.instance,
        );
        if (!childInstancesLoaded.ok) return childInstancesLoaded;
        const children: WorkflowChildSummary[] = childInstancesLoaded.value.map(
          (child) => ({
            instance: child.id,
            workflow: child.workflow,
            title: child.title ?? null,
            state: child.state,
            derived_status: deriveSummaryStatus(snapshot.sql, child),
            started_at: child.created_at,
            ended_at: child.finished_at,
          }),
        );
        const lines = loaded.value.slice(0, LINES);
        const remoteSteps = remoteStepsOf(snapshot.sql, input.instance);
        const sessions = buildSessionNodes(snapshot, input.instance, deps);
        const refs = loadReportRefs(snapshot.sql, input.instance);
        const derivedStatus = deriveWorkflowStatus({
          state: found.value.state,
          current: found.value.current,
          latestStatusLine:
            found.value.state === "running"
              ? lastStatusLineKind(snapshot.sql, input.instance)
              : null,
          sessions,
          remoteSteps,
          checkpoints: checkpointsLoaded.value,
        });
        return ok({
          instance: found.value,
          last_reports: reports.value,
          lines,
          remote_steps: remoteSteps,
          derived_status: derivedStatus,
          sessions,
          refs,
          checkpoints: checkpointsLoaded.value,
          children,
          as_of_seq: snapshot.as_of_seq,
          next_cursor:
            loaded.value.length > LINES ? lines[lines.length - 1]!.seq : null,
        });
      },
    },
    list: {
      route: workflowInstanceList,
      handle(snapshot, _ctx, input) {
        const loaded = listInstances(snapshot.sql, {
          project: input.project,
          ...(input.workflow === undefined ? {} : { workflow: input.workflow }),
          ...(input.state === undefined ? {} : { state: input.state }),
          ...(input.cursor === undefined ? {} : { after: input.cursor }),
          limit: PAGE + 1,
        });
        if (!loaded.ok) return loaded;
        const page = loaded.value.slice(0, PAGE);
        const instances = [];
        for (const instance of page) {
          const last = lastLine(snapshot.sql, instance.id);
          if (!last.ok) return last;
          const derivedStatus = deriveSummaryStatus(snapshot.sql, instance);
          instances.push({
            id: instance.id,
            project: instance.project,
            workflow: instance.workflow,
            title: instance.title ?? null,
            state: instance.state,
            current: instance.current,
            input: instance.input,
            ...(instance.inputs !== undefined
              ? { inputs: instance.inputs }
              : {}),
            started_by: instance.started_by,
            created_at: instance.created_at,
            finished_at: instance.finished_at,
            last_line: last.value,
            derived_status: derivedStatus,
          });
        }
        return ok({
          instances,
          as_of_seq: snapshot.as_of_seq,
          next_cursor:
            loaded.value.length > PAGE ? page[page.length - 1]!.id : null,
        });
      },
    },
    activity: {
      route: workflowInstanceActivity,
      handle(snapshot) {
        const busy = hasActivity(snapshot.sql);
        return busy.ok
          ? ok({
              busy: busy.value,
              as_of_seq: snapshot.as_of_seq,
              next_cursor: null,
            })
          : busy;
      },
    },
  };
}

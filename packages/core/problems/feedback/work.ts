// feedback 접수 조립(problems/feedback#R1–R4, R6–R10, R14; problems/grouping#R6;
// problems/snapshots#R15; plan problems T15). collector가 shell이 고정한 자료를
// 검증하고 redaction·blob 준비를 거쳐 RecordReport 입력으로 만든다. 사람의 글은
// 첨부 때문에 잃지 않는다: 선택하지 않았거나 얻지 못했거나 제외한 항목은 각각
// 이유로 남고 글은 접수된다. 한도를 넘거나 PNG가 아닌 선택 자료는 조용히 줄이지
// 않고 명시적으로 거절한다.
import { err, fingerprint, ok, type Result } from "../../../base/mod.ts";
import {
  type MissingReason,
  type RecordReportInput,
  recordReportInputSchema,
  type SnapshotInput,
  type SubmitFeedbackInput,
} from "../../../protocol/problems/mod.ts";
import { contentHashOf } from "../reporting/mod.ts";
import {
  type AppLogSource,
  bytesStream,
  collectLogEvidence,
  collectScreenEvidence,
  type PreparedSnapshotBlob,
  type SnapshotBlobPrepare,
} from "../snapshots/mod.ts";
import {
  checkFeedbackText,
  checkStateBytes,
  checkTransfer,
  type FeedbackCaller,
  feedbackGroup,
  inspectPng,
  requireShellUser,
  resolveTargets,
  safeScreenState,
  type SelectedProblem,
  transferBytes,
} from "./model.ts";

export type FeedbackView = NonNullable<SubmitFeedbackInput["view"]>;

// 계약의 입력에서 PNG 선언 크기를 request channel로 받은 실제 바이트로 바꾼 것이다.
type Intake = Omit<SubmitFeedbackInput, "screenshot"> & {
  screenshot: Uint8Array | null;
};

export type FeedbackDeps = {
  caller: FeedbackCaller;
  blobPrepare: SnapshotBlobPrepare;
  // blob 준비 principal이자 Report의 원주체다(registerBlobs의 원주체 검사).
  principal: string;
  nowAt: string;
  // 통과하지 못하면 null이다. 원문은 통과시키지 않는다(fail-closed).
  redact: (
    body: string,
    mediaType: "text/plain" | "application/json",
  ) => Promise<string | null>;
  // 진단 상세 수집 설정. null은 읽지 못한 것이다.
  detailCollection: boolean | null;
  // 선택한 기존 문제. 없는 문제와 범위 밖 문제는 같은 null이다.
  lookupProblem: (id: string) => Promise<Result<SelectedProblem | null>>;
  invocationArrived: (id: string) => Promise<boolean>;
  logSource?: AppLogSource | null;
  monotonicNow?: () => number;
};

export type AssembledFeedback = {
  input: RecordReportInput;
  // RecordReport 요청에 함께 보내는 준비 참조.
  prepared: string[];
};

const ASSEMBLY_MS = 2_000;
const REDACTED_NAME = "[redacted]";
const NO_ERROR: MissingReason = {
  reason: "사람이 보낸 제보라 오류 관측이 없다",
};
const NO_RELEASE = "화면 없이 접수해 당시 release를 모른다";

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

// 같은 모양의 view가 아니면 거절한다: 다른 앱·시점의 자료를 이 제보에 묶지 않는다.
function checkView(intake: Intake): Result<void> {
  const view = intake.view;
  if (view === null) return ok(undefined);
  if (
    view.app !== intake.app || view.observed_at !== intake.observed_at ||
    !/\S/.test(view.binding) || !/\S/.test(view.name) ||
    (view.mode === "live") !== (view.diagnostic_scope === null) ||
    !/\S/.test(view.diagnostic_scope ?? "x")
  ) {
    return invalid("view binding이 이 제보와 맞지 않는다");
  }
  return ok(undefined);
}

// `screenshot`은 worker 요청의 byte channel로 받은 PNG 바이트다. 선언 크기와 다르면
// 거절한다: 다른 이미지를 끼워 넣지 못한다.
export async function assembleFeedback(
  submitted: SubmitFeedbackInput,
  screenshot: Uint8Array | null,
  deps: FeedbackDeps,
): Promise<Result<AssembledFeedback>> {
  if (
    (submitted.screenshot === null) !== (screenshot === null) ||
    submitted.screenshot !== null &&
      submitted.screenshot.size_bytes !== screenshot!.length
  ) {
    return invalid("이미지가 선언한 크기와 맞지 않는다");
  }
  const intake: Intake = { ...submitted, screenshot };
  const startedMs = (deps.monotonicNow ?? Date.now)();
  const caller = requireShellUser(deps.caller);
  if (!caller.ok) return caller;
  const shown = checkView(intake);
  if (!shown.ok) return shown;
  const view = intake.view;

  // 전송 한도는 redaction 전에 본다: 큰 자료를 메모리에서 처리하지 않는다.
  const selectedShot = intake.selection.screenshot ? intake.screenshot : null;
  const transfer = checkTransfer(transferBytes({
    text: intake.text,
    facts: view !== null && intake.selection.screen ? intake.facts : null,
    screenshot: intake.screenshot,
  }));
  if (!transfer.ok) return transfer;

  let redactedText: string | null;
  try {
    redactedText = await deps.redact(intake.text, "text/plain");
  } catch {
    redactedText = null;
  }
  if (redactedText === null) {
    return invalid("글이 redaction을 통과하지 못했다");
  }
  const text = checkFeedbackText(redactedText);
  if (!text.ok) return text;

  // 선택한 이미지는 PNG 머리·크기를 본다. 가리지 않고 그대로 둔다(D32).
  if (selectedShot !== null) {
    const png = inspectPng(selectedShot);
    if (!png.ok) return png;
  }

  const targets = resolveTargets(intake.targets);
  if (!targets.ok) return targets;

  let state: { text: string } | { excluded: true } | { unavailable: true } = {
    unavailable: true,
  };
  if (view !== null && intake.selection.screen && intake.facts !== null) {
    let redactedState: string | null;
    try {
      redactedState = await deps.redact(
        JSON.stringify(safeScreenState(view.name, intake.facts, targets.value)),
        "application/json",
      );
    } catch {
      redactedState = null;
    }
    if (redactedState === null || !isJson(redactedState)) {
      state = { excluded: true };
    } else {
      const bounded = checkStateBytes(redactedState);
      if (!bounded.ok) return bounded;
      state = { text: redactedState };
    }
  }

  const mode = view?.mode ?? "live";
  let selected: SelectedProblem | null = null;
  if (intake.existing_problem !== null) {
    const found = await deps.lookupProblem(intake.existing_problem);
    if (!found.ok) return found;
    selected = found.value;
  }
  const group = feedbackGroup(intake.report_id, intake.app, mode, selected);

  const textPrepared = await prepareText(deps, text.value);
  if (textPrepared === null) {
    return err({ code: "unavailable", message: "글을 저장하지 못했다" });
  }

  let shot: { bytes: Uint8Array } | { mismatch: true } | null = null;
  if (selectedShot !== null) {
    shot = view !== null &&
        await sha256Bytes(selectedShot) === view.final_screenshot_hash
      ? { bytes: selectedShot }
      : { mismatch: true };
  }
  const screen = await collectScreenEvidence({
    view: view === null ? null : {
      name: await redactedName(deps, view.name),
      observed_at: view.observed_at,
    },
    block: view?.capture ?? null,
    selection: intake.selection,
    state,
    screenshot: shot,
  }, deps);

  const invocation = targets.value.invocation;
  const arrived = invocation === null ? true : await arrival(deps, invocation);
  const logs = await collectLogEvidence(
    { app: intake.app, invocation },
    {
      detailCollection: deps.detailCollection,
      source: deps.logSource ?? null,
      redact: (body) => deps.redact(body, "text/plain"),
      blobPrepare: deps.blobPrepare,
      principal: deps.principal,
      nowAt: deps.nowAt,
      remainingMs: ASSEMBLY_MS -
        ((deps.monotonicNow ?? Date.now)() - startedMs),
      remainingLargeBytes: 2_359_296 -
        (screen.screenshot_prepared?.size_bytes ?? 0) -
        (screen.state_prepared?.size_bytes ?? 0),
    },
  );

  const snapshotId = `snp_${intake.report_id.slice("rpt_".length)}`;
  const snapshot: SnapshotInput = {
    id: snapshotId,
    captured_at: deps.nowAt,
    invocation: invocation === null ? null : {
      id: invocation,
      binding: "view_context",
      record_missing_reason: arrived
        ? null
        : { reason: "기록이 아직 도착하지 않았다" },
    },
    invocation_missing_reason: invocation === null
      ? { reason: targets.value.invocation_missing! }
      : null,
    error: null,
    error_missing_reason: NO_ERROR,
    logs: logs.logs,
    logs_missing_reason: logs.logs_missing_reason,
    screen: screen.screen,
    screen_missing_reason: screen.screen_missing_reason,
  };

  const prepared = [
    textPrepared,
    screen.state_prepared,
    screen.screenshot_prepared,
    logs.prepared,
  ].filter((entry) => entry !== null);
  const blobs: RecordReportInput["blobs"] = prepared.map((entry) => ({
    hash: entry.hash,
    size_bytes: entry.size_bytes,
    purpose: entry.purpose as RecordReportInput["blobs"][number]["purpose"],
    source: { kind: "prepared", blob: { ...entry } },
  }));
  const scope = {
    app: intake.app,
    mode,
    diagnostic_scope: view?.diagnostic_scope ?? null,
    release: view?.release ?? null,
    release_missing_reason: view === null
      ? NO_RELEASE
      : view.release === null
      ? "view가 release 없이 열려 있었다"
      : null,
    bundle_hash: view?.bundle_hash ?? null,
  };
  const report: RecordReportInput["report"] = {
    id: intake.report_id,
    ...scope,
    source: "feedback",
    code: "_feedback",
    text: textPrepared.hash,
    details: null,
    snapshot: snapshotId,
    observed_at: intake.observed_at,
    principal: deps.principal,
    content_hash: "",
  } as RecordReportInput["report"];
  const hashInput = contentHashOf({
    report,
    snapshot,
    group_key: group.group_key,
    existing_problem: group.existing_problem,
    blobs,
  } as Pick<
    RecordReportInput,
    "report" | "snapshot" | "group_key" | "existing_problem" | "blobs"
  >);
  if (hashInput === undefined) return invalid("접수 내용이 형식에 맞지 않는다");
  const contentHash = await fingerprint(hashInput);
  const input = {
    report: { ...report, content_hash: contentHash },
    snapshot,
    group_key: group.group_key,
    existing_problem: group.existing_problem,
    blobs,
    origin: {
      report_id: intake.report_id,
      content_hash: contentHash,
      context: {
        ...scope,
        binding: view?.binding ?? "feedback-no-view",
        origin: "shell_user",
        authentication: {
          principal: deps.principal,
          actor: "user",
          scope: { operations: ["SubmitFeedback"], targets: {} },
          conditions: {},
          credential_ref: "collector-position",
        },
      },
    },
  };
  const checked = recordReportInputSchema.safeParse(input);
  if (!checked.success) return invalid("접수 내용이 형식에 맞지 않는다");
  return ok({
    input: checked.data as RecordReportInput,
    prepared: prepared.map((entry) => entry.preparation),
  });
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

async function redactedName(deps: FeedbackDeps, name: string): Promise<string> {
  try {
    const safe = await deps.redact(name, "text/plain");
    return safe !== null && /\S/.test(safe) ? safe : REDACTED_NAME;
  } catch {
    return REDACTED_NAME;
  }
}

async function arrival(deps: FeedbackDeps, id: string): Promise<boolean> {
  try {
    return await deps.invocationArrived(id);
  } catch {
    return false;
  }
}

async function prepareText(
  deps: FeedbackDeps,
  text: string,
): Promise<PreparedSnapshotBlob | null> {
  try {
    const prepared = await deps.blobPrepare.prepare(
      {
        principal: deps.principal,
        purpose: "report_text",
        expectedHash: undefined,
      },
      bytesStream(new TextEncoder().encode(text)),
    );
    return prepared.ok ? prepared.value : null;
  } catch {
    return null;
  }
}

// feedback 접수 조립. collector가 shell이 고정한 글과 view를 검증하고 redaction·blob 준비를
// 거쳐 `problem.record_report` 입력으로 만든다. 제보는 글만 받는다. 화면 증거는 없다.
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  FEEDBACK_PROBLEM_NAME,
  type ProblemFeedbackInput,
  type ProblemSnapshotInput,
  problemSubmitFeedback,
  type RecordProblemReportInput,
  recordProblemReportInputSchema,
} from "../../../protocol/problems/mod.ts";
import { contentHashOf } from "../reporting/mod.ts";
import {
  type AppLogSource,
  bytesStream,
  collectLogEvidence,
  type PreparedSnapshotBlob,
  type SnapshotBlobPrepare,
} from "../snapshots/mod.ts";
import {
  checkFeedbackText,
  type FeedbackCaller,
  feedbackGroup,
  requireShellUser,
  type SelectedProblem,
} from "./model.ts";

type FeedbackDeps = {
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
  logSource?: AppLogSource | null;
  monotonicNow?: () => number;
};

type AssembledFeedback = {
  input: RecordProblemReportInput;
  // problem.record_report 요청에 함께 보내는 준비 참조.
  prepared: string[];
};

const ASSEMBLY_MS = 2_000;
const LARGE_BYTES = 2_359_296;
const NO_RELEASE = "화면 없이 접수해 당시 release를 모른다";

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

// 같은 앱·시점의 view가 아니면 거절한다: 다른 앱·시점의 자료를 이 제보에 묶지 않는다.
function checkView(submitted: ProblemFeedbackInput): Result<void> {
  const view = submitted.view;
  if (view === null) return ok(undefined);
  if (
    view.app !== submitted.app || view.observed_at !== submitted.observed_at ||
    !/\S/.test(view.binding) || !/\S/.test(view.name) ||
    (view.mode === "live") !== (view.diagnostic_scope === null) ||
    !/\S/.test(view.diagnostic_scope ?? "x")
  ) {
    return invalid("view binding이 이 제보와 맞지 않는다");
  }
  return ok(undefined);
}

export async function assembleFeedback(
  submitted: ProblemFeedbackInput,
  deps: FeedbackDeps,
): Promise<Result<AssembledFeedback>> {
  const startedMs = (deps.monotonicNow ?? Date.now)();
  const caller = requireShellUser(deps.caller);
  if (!caller.ok) return caller;
  const shown = checkView(submitted);
  if (!shown.ok) return shown;
  const view = submitted.view;
  const mode = view?.mode ?? "live";

  let redactedText: string | null;
  try {
    redactedText = await deps.redact(submitted.text, "text/plain");
  } catch {
    redactedText = null;
  }
  if (redactedText === null) {
    return invalid("글이 redaction을 통과하지 못했다");
  }
  const text = checkFeedbackText(redactedText);
  if (!text.ok) return text;

  // 고른 문제는 같은 앱의 live 문제여야 한다. 없는 문제와 범위 밖 문제는 구별하지 않는다.
  let selected: SelectedProblem | null = null;
  if (submitted.existing_problem !== null) {
    const found = await deps.lookupProblem(submitted.existing_problem);
    if (!found.ok) return found;
    if (
      found.value === null || found.value.app !== submitted.app ||
      mode !== "live"
    ) {
      return invalid("고른 문제에 덧붙일 수 없다");
    }
    selected = found.value;
  }
  const group = feedbackGroup(
    submitted.report_id,
    submitted.app,
    mode,
    selected,
  );

  const textPrepared = await prepareText(deps, text.value);
  if (textPrepared === null) {
    return err({ code: "unavailable", message: "글을 저장하지 못했다" });
  }

  const logs = await collectLogEvidence(
    { app: submitted.app, invocation: null },
    {
      detailCollection: deps.detailCollection,
      source: deps.logSource ?? null,
      redact: (body) => deps.redact(body, "text/plain"),
      blobPrepare: deps.blobPrepare,
      principal: deps.principal,
      nowAt: deps.nowAt,
      remainingMs: ASSEMBLY_MS -
        ((deps.monotonicNow ?? Date.now)() - startedMs),
      remainingLargeBytes: LARGE_BYTES - textPrepared.size_bytes,
    },
  );

  const snapshotId = `snp_${submitted.report_id.slice("rpt_".length)}`;
  const snapshot: ProblemSnapshotInput = {
    id: snapshotId,
    captured_at: deps.nowAt,
    invocation: null,
    error: null,
    logs: logs.logs,
  };

  const prepared = [textPrepared, logs.prepared].filter((entry) =>
    entry !== null
  );
  const blobs: RecordProblemReportInput["blobs"] = prepared.map((entry) => ({
    hash: entry.hash,
    size_bytes: entry.size_bytes,
    purpose: entry.purpose as RecordProblemReportInput["blobs"][number][
      "purpose"
    ],
    source: { kind: "prepared", blob: { ...entry } },
  }));
  const scope = {
    app: submitted.app,
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
  const report: RecordProblemReportInput["report"] = {
    id: submitted.report_id,
    ...scope,
    source: "feedback",
    name: FEEDBACK_PROBLEM_NAME,
    message: textPrepared.hash,
    details: null,
    snapshot: snapshotId,
    observed_at: submitted.observed_at,
    principal: deps.principal,
    content_hash: "",
  };
  const contentHash = await contentHashOf({
    report,
    snapshot,
    group_key: group.group_key,
    existing_problem: group.existing_problem,
    blobs,
  });
  const input = {
    report: { ...report, content_hash: contentHash },
    snapshot,
    group_key: group.group_key,
    existing_problem: group.existing_problem,
    blobs,
    origin: {
      report_id: submitted.report_id,
      content_hash: contentHash,
      context: {
        ...scope,
        binding: view?.binding ?? "feedback-no-view",
        origin: "shell_user",
        authentication: {
          principal: deps.principal,
          actor: "user",
          scope: { operations: [problemSubmitFeedback.name], targets: {} },
          conditions: {},
          credential_ref: "collector-position",
        },
      },
    },
  };
  const checked = recordProblemReportInputSchema.safeParse(input);
  if (!checked.success) return invalid("접수 내용이 형식에 맞지 않는다");
  return ok({
    input: checked.data,
    prepared: prepared.map((entry) => entry.preparation),
  });
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

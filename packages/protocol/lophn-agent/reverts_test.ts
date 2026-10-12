import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../base/route.ts";
import {
  amendRevertInstall,
  amendRevertInstallInputSchema,
  appStepResultSchema,
  checkpointEntrySchema,
  checkpointRevertInputSchema,
  checkpointSchema,
  fileStateSchema,
  finishRevertInputSchema,
  finishRewindSummary,
  readRewindSummary,
  recordRewindFile,
  recordRewindFileInputSchema,
  recordRewindFileOutputSchema,
  redo,
  requestRewindSummary,
  REVERT_EVENTS,
  REVERT_REASON_CODES,
  REVERT_ROUTES,
  revertAmended,
  revertApplied,
  revertBlocked,
  revertClosed,
  revertFinished,
  revertItemSchema,
  revertRecordSchema,
  revertRedone,
  revertStarted,
  rewind,
  REWIND_DECISION,
  rewindFileSchema,
  rewindInputSchema,
  rewindPreview,
  rewindPreviewInputSchema,
  rewindPreviewOutputSchema,
  rewindSummaryStateSchema,
  runAppRevert,
  takeRewindSummaryRequest,
  undoEdit,
  undoEditInputSchema,
} from "./reverts.ts";

const suffix = "01arz3ndektsv4rrffq69g5fav";
const hash = "d".repeat(64);
const other = "e".repeat(64);
const rvt = `rvt_${suffix}`;
const ses = `ses_${suffix}`;
const msg = `msg_${suffix}`;
const tcl = `tcl_${suffix}`;
const mcl = `mcl_${suffix}`;

const counts = {
  restored: 1,
  skipped: 2,
  remained: 0,
  failure: 0,
  uncertain: 0,
  unchanged: 0,
};

const binding = {
  app: `app_${suffix}`,
  release: `rel_${suffix}`,
  command: "ticket.update",
  tool_call: tcl,
  invocation: `inv_${suffix}`,
  receipt: "opaque",
  expected_revision: "7",
  revert_command: "ticket.revert",
  step_key: `${rvt}:inv_${suffix}`,
  revert_invocation: null,
};

const fileRestore = {
  ordinal: 0,
  class: "file",
  target: "notes/a.md",
  source: [tcl],
  plan: "restore",
  reason: null,
  app_revert: null,
};

Deno.test("lophn-agent/revert#R1 [agent-RW2]: rewind routes and the seven named events", () => {
  assertEquals(REVERT_ROUTES.map(routePath), [
    "/v1/rewind/run-apps",
    "/v1/rewind/apply",
    "/v1/rewind/undo",
    "/v1/rewind/redo",
    "/v1/rewind/record-file",
    "/v1/rewind/checkpoint",
    "/v1/rewind/finish",
    "/v1/rewind/amend-install",
    "/v1/rewind/summary-request",
    "/v1/rewind/summary-state",
    "/v1/rewind/summary-take",
    "/v1/rewind/summary-done",
    "/v1/rewind/preview",
    "/v1/rewind/checkpoints",
    "/v1/rewind/list",
  ]);
  assertEquals(REVERT_EVENTS.map((event) => event.type), [
    "RevertStarted",
    "RevertApplied",
    "RevertFinished",
    "RevertBlocked",
    "RevertRedone",
    "RevertClosed",
    "RevertAmended",
  ]);
  assert(
    REVERT_ROUTES.every((route) =>
      route.errors.every((code) => ERROR_CODES.includes(code))
    ),
  );
});

Deno.test("lophn-agent/revert#R2 [agent-RW2]: only a person asks; the agent only records pre-images and nothing reads them for the agent", () => {
  assertEquals(rewind.actors, ["user"]);
  assertEquals(undoEdit.actors, ["user"]);
  assertEquals(redo.actors, ["user"]);
  assertEquals(runAppRevert.actors, ["user"]);
  assertEquals(recordRewindFile.actors, ["agent"]);
  for (const route of REVERT_ROUTES) {
    if (route.kind === "read") {
      assertEquals(route.actors, ["user", "machine"]);
    }
  }
});

Deno.test("lophn-agent/revert#R3 [agent-RW2]: Rewind is a confirmed decision bound to the previewed list, with a fixed decision name", () => {
  assertEquals(REWIND_DECISION, rewind.name);
  assertEquals(rewind.confirmation, "required");
  assertEquals(rewind.display_read, "/v1/rewind/preview");
  assertEquals(rewind.binding, [
    "id",
    "session",
    "checkpoint",
    "choice",
    "accept_remaining",
    "preview_hash",
  ]);
  // Undo is a card button, so it carries no confirmation window.
  assertEquals(undoEdit.confirmation, undefined);
});

const rewindInput = {
  id: rvt,
  session: ses,
  checkpoint: msg,
  choice: "restore_all",
  accept_remaining: true,
  preview_hash: hash,
  summary_call: null,
  files: [{
    path: "notes/a.md",
    observed_sha256: hash,
    link: false,
    staged: true,
    redo_ref: other,
  }],
};

Deno.test("lophn-agent/revert#R15 [agent-RW2]: the three choices carry only the inputs of their scope", () => {
  assert(rewindInputSchema.safeParse(rewindInput).success);
  assert(
    rewindInputSchema.safeParse({
      ...rewindInput,
      choice: "messages_only",
      files: [],
    }).success,
  );
  // messages_only never restores a file.
  assert(
    !rewindInputSchema.safeParse({ ...rewindInput, choice: "messages_only" })
      .success,
  );
  // summarize needs the one successful summary call, and only summarize has one.
  assert(
    rewindInputSchema.safeParse({
      ...rewindInput,
      choice: "summarize",
      files: [],
      summary_call: mcl,
    }).success,
  );
  assert(
    !rewindInputSchema.safeParse({
      ...rewindInput,
      choice: "summarize",
      files: [],
    }).success,
  );
  assert(
    !rewindInputSchema.safeParse({ ...rewindInput, summary_call: mcl }).success,
  );
  assert(
    !rewindInputSchema.safeParse({ ...rewindInput, choice: "documents" })
      .success,
  );
  assert(
    !rewindInputSchema.safeParse({ ...rewindInput, run: `run_${suffix}` })
      .success,
  );
  // The same path cannot be prepared twice.
  assert(
    !rewindInputSchema.safeParse({
      ...rewindInput,
      files: [rewindInput.files[0], rewindInput.files[0]],
    }).success,
  );
});

Deno.test("lophn-agent/revert#R12 [agent-RW2]: a checkpoint is a message and files_reason is set exactly when files are not restorable", () => {
  assert(
    checkpointSchema.safeParse({
      message: msg,
      session: ses,
      files_restorable: true,
      files_reason: null,
    }).success,
  );
  assert(
    checkpointSchema.safeParse({
      message: msg,
      session: ses,
      files_restorable: false,
      files_reason: "limit_file",
    }).success,
  );
  for (
    const bad of [
      { files_restorable: false, files_reason: null },
      { files_restorable: true, files_reason: "limit_count" },
      { files_restorable: false, files_reason: "limit_none" },
      { files_restorable: true, files_reason: "record_failed" },
    ]
  ) {
    assert(
      !checkpointSchema.safeParse({ message: msg, session: ses, ...bad })
        .success,
    );
  }
  assert(
    checkpointEntrySchema.safeParse({
      message: msg,
      session: ses,
      files_restorable: true,
      files_reason: null,
      created_seq: "4",
      hidden: false,
    }).success,
  );
});

Deno.test("lophn-agent/revert#R13 [agent-RW2]: a RewindFile keeps before and after state per tool call, and a rename keeps both paths", () => {
  const file = {
    tool_call: tcl,
    path: "notes/b.md",
    checkpoint: msg,
    seq: "9",
    before: { exists: true, sha256: hash, blob: hash },
    after: { exists: true, sha256: other },
    moved_from: "notes/a.md",
    reverted_by: null,
  };
  assert(rewindFileSchema.safeParse(file).success);
  // Created file: nothing existed before, so no hash and no stored pre-image.
  assert(
    rewindFileSchema.safeParse({
      ...file,
      moved_from: null,
      before: { exists: false, sha256: null, blob: null },
    }).success,
  );
  // An unrecorded pre-image (over the limit) has no blob but keeps the hash.
  assert(
    fileStateSchema.safeParse({ exists: true, sha256: hash, blob: null })
      .success,
  );
  assert(
    !fileStateSchema.safeParse({ exists: false, sha256: hash, blob: null })
      .success,
  );
  assert(
    !fileStateSchema.safeParse({ exists: true, sha256: null, blob: null })
      .success,
  );
  // The store is addressed by content, so the blob key is the hash.
  assert(
    !fileStateSchema.safeParse({ exists: true, sha256: hash, blob: other })
      .success,
  );
  assert(
    !rewindFileSchema.safeParse({
      ...file,
      path: "../outside.md",
    }).success,
  );
  assert(
    !rewindFileSchema.safeParse({
      ...file,
      after: { exists: true, sha256: null },
    }).success,
  );
});

Deno.test("lophn-agent/revert#R13 [agent-RW2]: RecordRewindFile takes the file state before the write and the size to judge the limit", () => {
  const input = {
    tool_call: tcl,
    path: "notes/a.md",
    before: { exists: true, sha256: hash, blob: hash },
    before_size_bytes: 12,
    after: { exists: true, sha256: other },
    moved_from: null,
  };
  assert(recordRewindFileInputSchema.safeParse(input).success);
  assert(
    recordRewindFileInputSchema.safeParse({
      ...input,
      before: { exists: false, sha256: null, blob: null },
      before_size_bytes: null,
    }).success,
  );
  assert(
    !recordRewindFileInputSchema.safeParse({
      ...input,
      before_size_bytes: null,
    }).success,
  );
  assert(
    !recordRewindFileInputSchema.safeParse({ ...input, extra: 1 }).success,
  );
});

Deno.test("lophn-agent/revert#R14 [agent-RW2]: an over-limit write still succeeds but lowers its checkpoint", () => {
  const output = {
    tool_call: tcl,
    path: "notes/a.md",
    checkpoint: msg,
    recorded: false,
    files_restorable: false,
    files_reason: "limit_file",
    replayed: false,
  };
  assert(recordRewindFileOutputSchema.safeParse(output).success);
  assert(
    recordRewindFileOutputSchema.safeParse({
      ...output,
      recorded: true,
      files_restorable: true,
      files_reason: null,
    }).success,
  );
  // An unrecorded pre-image cannot leave the checkpoint restorable.
  assert(
    !recordRewindFileOutputSchema.safeParse({
      ...output,
      files_restorable: true,
      files_reason: null,
    }).success,
  );
});

Deno.test("lophn-agent/revert#R3 [agent-RW2]: reasons are the seventeen fixed codes and each fits its item class", () => {
  assertEquals(REVERT_REASON_CODES.length, 17);
  assertEquals(new Set(REVERT_REASON_CODES).size, 17);
  const skipped = (reason: string | null, cls = "file", extra = {}) =>
    revertItemSchema.safeParse({
      ...fileRestore,
      class: cls,
      plan: "skip",
      result: "skipped",
      reason,
      ...extra,
    }).success;
  assert(skipped("edited_outside"));
  assert(!skipped("not a code"));
  assert(!skipped(null));
  // An app reason on a file item does not fit.
  assert(!skipped("no_receipt"));
  assert(
    skipped("app_revision_changed", "app", {
      target: tcl,
      app_revert: binding,
    }),
  );
});

Deno.test("lophn-agent/revert#R4 [agent-RW2]: plan and result combine only as the domain table allows", () => {
  const item = (fields: Record<string, unknown>) =>
    revertItemSchema.safeParse({ ...fileRestore, ...fields }).success;
  assert(item({ result: "restored" }));
  assert(!item({ result: "restored", reason: "edited_outside" }));
  assert(!item({ result: "skipped" }));
  assert(!item({ result: "remained" }));
  assert(item({ plan: "skip", reason: "chain_broken", result: "skipped" }));
  assert(!item({ plan: "skip", reason: "chain_broken", result: "restored" }));
  // An already-undone record is the one skip that stays unchanged.
  assert(
    item({ plan: "skip", reason: "already_reverted", result: "unchanged" }),
  );
  assert(!item({ plan: "skip", reason: "link_path", result: "unchanged" }));
  // A file is restored or skipped; only app writes and facts remain.
  assert(
    !item({ plan: "remain", reason: "external_effect", result: "remained" }),
  );
  assert(
    item({
      class: "fact",
      target: "answered_question",
      source: [],
      plan: "remain",
      reason: "answered_fact",
      result: "remained",
    }),
  );
  assert(
    !item({
      class: "fact",
      target: "answered_question",
      source: [],
      plan: "restore",
      result: "restored",
    }),
  );
  // An app item to restore carries its binding; a file item never does.
  assert(
    item({
      class: "app",
      target: tcl,
      plan: "restore",
      app_revert: binding,
      result: "restored",
    }),
  );
  assert(
    !item({ class: "app", target: tcl, plan: "restore", result: "restored" }),
  );
  assert(!item({ app_revert: binding, result: "restored" }));
});

Deno.test("lophn-agent/revert#R11 [agent-RW2]: a failed or uncertain app step keeps its own result, never a whole-revert verdict", () => {
  const app = {
    ...fileRestore,
    class: "app",
    target: tcl,
    app_revert: binding,
  };
  // result가 restored가 아니면 이유가 있고 앱 단계의 이유는 결과와 짝이다.
  const reasons = {
    failure: "app_failed",
    uncertain: "app_uncertain",
    unchanged: "app_not_started",
  } as const;
  for (const [result, reason] of Object.entries(reasons)) {
    assert(revertItemSchema.safeParse({ ...app, result, reason }).success);
    // 시작 전(unchanged)은 applying 중에만 이유가 없을 수 있다(record 시험).
    if (result !== "unchanged") {
      assert(
        !revertItemSchema.safeParse({ ...app, result, reason: null }).success,
      );
    }
    assert(
      !revertItemSchema.safeParse({ ...app, result, reason: "app_not_settled" })
        .success,
    );
  }
  // 문서 파일은 앱 단계가 시작하지 않아 못 한 일이 app_not_settled다.
  const file = { ...fileRestore, result: "unchanged" };
  assert(
    revertItemSchema.safeParse({ ...file, reason: "app_not_settled" }).success,
  );
  assert(
    !revertItemSchema.safeParse({ ...file, reason: "app_not_started" }).success,
  );
  assert(
    !revertItemSchema.safeParse({
      ...file,
      result: "failure",
      reason: "app_failed",
    }).success,
  );
  assertEquals(appStepResultSchema.options, [
    "restored",
    "failure",
    "uncertain",
    "unchanged",
  ]);
  assert(
    checkpointRevertInputSchema.safeParse({
      revert: rvt,
      step_key: binding.step_key,
      invocation: null,
      result: "uncertain",
    }).success,
  );
  assert(
    !checkpointRevertInputSchema.safeParse({
      revert: rvt,
      step_key: binding.step_key,
      invocation: null,
      result: "skipped",
    }).success,
  );
  assert(
    finishRevertInputSchema.safeParse({
      revert: rvt,
      step_keys: [binding.step_key],
      files: [],
    }).success,
  );
  assert(
    !finishRevertInputSchema.safeParse({
      revert: rvt,
      step_keys: [],
      files: [],
    })
      .success,
  );
});

const record = {
  id: rvt,
  session: ses,
  kind: "rewind",
  choice: "restore_all",
  checkpoint: msg,
  tool_call: null,
  boundary_seq: "3",
  summary_call: null,
  outcome: "applied",
  redo: "available",
  items: [{ ...fileRestore, result: "restored" }],
  preview_hash: hash,
  result_seq: "8",
};

Deno.test("lophn-agent/revert#R16 [agent-RW2]: redo exists only for an applied rewind without app steps", () => {
  assert(revertRecordSchema.safeParse(record).success);
  for (const redoState of ["done", "closed", "none"]) {
    assert(
      revertRecordSchema.safeParse({ ...record, redo: redoState }).success,
    );
  }
  // summarize, undo, blocked and partial results have no redo.
  assert(
    !revertRecordSchema.safeParse({
      ...record,
      choice: "summarize",
      summary_call: mcl,
    }).success,
  );
  assert(
    revertRecordSchema.safeParse({
      ...record,
      choice: "summarize",
      summary_call: mcl,
      redo: "none",
    }).success,
  );
  assert(
    !revertRecordSchema.safeParse({ ...record, outcome: "blocked" }).success,
  );
  assert(
    !revertRecordSchema.safeParse({ ...record, outcome: "partial" }).success,
  );
  // A rewind that restored an app write cannot be redone.
  assert(
    !revertRecordSchema.safeParse({
      ...record,
      items: [{
        ...fileRestore,
        class: "app",
        target: tcl,
        app_revert: binding,
        result: "restored",
      }],
    }).success,
  );
});

Deno.test("lophn-agent/revert#R19 [agent-RW2]: an undo names one tool call, hides nothing and has no redo", () => {
  const undo = {
    ...record,
    kind: "undo",
    choice: null,
    checkpoint: null,
    tool_call: tcl,
    boundary_seq: null,
    redo: "none",
  };
  assert(revertRecordSchema.safeParse(undo).success);
  assert(!revertRecordSchema.safeParse({ ...undo, boundary_seq: "3" }).success);
  assert(!revertRecordSchema.safeParse({ ...undo, tool_call: null }).success);
  assert(!revertRecordSchema.safeParse({ ...undo, redo: "available" }).success);
  assert(
    undoEditInputSchema.safeParse({
      id: rvt,
      session: ses,
      tool_call: tcl,
      preview_hash: hash,
      files: [{
        path: "notes/a.md",
        observed_sha256: other,
        link: false,
        staged: true,
        redo_ref: null,
      }],
    }).success,
  );
  assert(
    !undoEditInputSchema.safeParse({
      id: rvt,
      session: ses,
      tool_call: tcl,
      preview_hash: hash,
      files: ["a", "b", "c"].map((path) => ({
        path,
        observed_sha256: null,
        link: false,
        staged: true,
        redo_ref: null,
      })),
    }).success,
  );
});

Deno.test("lophn-agent/revert#R3 [agent-RW2]: a preview lists restore, skip and remain apart and previews redo", () => {
  assert(
    rewindPreviewInputSchema.safeParse({
      kind: "rewind",
      session: ses,
      checkpoint: msg,
      choice: "messages_only",
    }).success,
  );
  assert(
    rewindPreviewInputSchema.safeParse({
      kind: "undo",
      session: ses,
      tool_call: tcl,
    }).success,
  );
  assert(
    !rewindPreviewInputSchema.safeParse({
      kind: "rewind",
      session: ses,
      tool_call: tcl,
    }).success,
  );
  const preview = {
    as_of_seq: "9",
    next_cursor: null,
    kind: "rewind",
    choice: "restore_all",
    checkpoint: msg,
    tool_call: null,
    restore: [fileRestore],
    skip: [{
      ...fileRestore,
      ordinal: 1,
      target: "notes/b.md",
      plan: "skip",
      reason: "edited_outside",
    }],
    remain: [{
      ordinal: 2,
      class: "app",
      target: tcl,
      source: [tcl],
      plan: "remain",
      reason: "no_revert_command",
      app_revert: null,
    }],
    redo: true,
    preview_hash: hash,
  };
  assert(rewindPreviewOutputSchema.safeParse(preview).success);
  // An item in the wrong list is rejected.
  assert(
    !rewindPreviewOutputSchema.safeParse({
      ...preview,
      skip: [preview.restore[0]],
    }).success,
  );
  assert(
    !rewindPreviewOutputSchema.safeParse({
      ...preview,
      remain: [{ ...preview.remain[0], ordinal: 0 }],
    }).success,
  );
  // Summarize cannot be redone, and neither can a rewind that restores an app write.
  assert(
    !rewindPreviewOutputSchema.safeParse({ ...preview, choice: "summarize" })
      .success,
  );
  assert(
    !rewindPreviewOutputSchema.safeParse({
      ...preview,
      restore: [{
        ...fileRestore,
        class: "app",
        target: tcl,
        app_revert: binding,
      }],
    }).success,
  );
  assertEquals(rewindPreview.input, rewindPreviewInputSchema);
});

Deno.test("lophn-agent/revert#R8 [agent-RW2]: result events carry result counts, not item lists", () => {
  assert(
    revertBlocked.payload.safeParse({ session: ses, results: counts }).success,
  );
  assert(
    revertFinished.payload.safeParse({
      session: ses,
      outcome: "partial",
      results: counts,
    }).success,
  );
  assert(
    !revertFinished.payload.safeParse({
      session: ses,
      outcome: "applied",
      results: counts,
    }).success,
  );
  assert(
    revertApplied.payload.safeParse({
      session: ses,
      kind: "rewind",
      choice: "restore_all",
      partial: true,
      results: counts,
      boundary_seq: "3",
      redo: "available",
    }).success,
  );
  assert(
    revertApplied.payload.safeParse({
      session: ses,
      kind: "undo",
      choice: null,
      partial: false,
      results: counts,
      boundary_seq: null,
      redo: "none",
    }).success,
  );
  assert(
    !revertApplied.payload.safeParse({
      session: ses,
      kind: "undo",
      choice: null,
      partial: false,
      results: { ...counts, restored: -1 },
      boundary_seq: null,
      redo: "none",
    }).success,
  );
  assert(
    !revertBlocked.payload.safeParse({
      session: ses,
      results: { ...counts, retained: 1 },
    }).success,
  );
});

Deno.test("lophn-agent/revert#R16 [agent-RW2]: started, redone and closed events", () => {
  assert(
    revertStarted.payload.safeParse({
      session: ses,
      kind: "rewind",
      choice: "restore_all",
      preview_hash: hash,
      steps: [binding.step_key],
    }).success,
  );
  assert(
    !revertStarted.payload.safeParse({
      session: ses,
      kind: "rewind",
      choice: "restore_all",
      preview_hash: hash,
      steps: [],
    }).success,
  );
  assert(
    revertRedone.payload.safeParse({ session: ses, messages: 3, files: 1 })
      .success,
  );
  assert(
    revertClosed.payload.safeParse({
      session: ses,
      closed_at: "2026-10-12T00:00:00.000Z",
    }).success,
  );
  assert(
    !revertClosed.payload.safeParse({ session: ses, closed_at: "soon" })
      .success,
  );
  for (const event of REVERT_EVENTS) {
    assert(event.subject.safeParse(rvt).success);
    assert(!event.subject.safeParse(ses).success);
  }
});

Deno.test("lophn-agent/revert#R17 [agent-RW2]: a restore step is skipped only after install, only for a file, and only as edited_outside", () => {
  const skippedInstall = (over: Record<string, unknown>) =>
    revertItemSchema.safeParse({
      ...fileRestore,
      result: "skipped",
      reason: "edited_outside",
      ...over,
    }).success;
  assert(skippedInstall({}));
  assert(!skippedInstall({ reason: "chain_broken" }));
  assert(!skippedInstall({ reason: null }));
  assert(
    !skippedInstall({
      class: "app",
      target: tcl,
      app_revert: binding,
    }),
  );
});

Deno.test("lophn-agent/revert#R19 [agent-RW2]: a later agent edit has its own reason apart from a person's edit", () => {
  const skip = (reason: string) =>
    revertItemSchema.safeParse({
      ...fileRestore,
      plan: "skip",
      result: "skipped",
      reason,
    }).success;
  assert(skip("later_edit"));
  assert(skip("edited_outside"));
  assert(
    !revertItemSchema.safeParse({
      ...fileRestore,
      class: "app",
      target: tcl,
      app_revert: binding,
      plan: "skip",
      result: "skipped",
      reason: "later_edit",
    }).success,
  );
});

Deno.test("lophn-agent/revert#R14 [agent-RW2]: a failed record lowers the checkpoint with its own reason, not a limit", () => {
  assert(
    checkpointSchema.safeParse({
      message: msg,
      session: ses,
      files_restorable: false,
      files_reason: "record_failed",
    }).success,
  );
  assert(
    recordRewindFileOutputSchema.safeParse({
      tool_call: tcl,
      path: "notes/a.md",
      checkpoint: msg,
      recorded: false,
      files_restorable: false,
      files_reason: "record_failed",
      replayed: false,
    }).success,
  );
});

Deno.test("lophn-agent/revert#R3 [agent-RW2]: a blocked revert has no items, and an unfinished restore item has a reason once the revert is final", () => {
  const blocked = { ...record, outcome: "blocked", redo: "none" };
  assert(!revertRecordSchema.safeParse(blocked).success);
  assert(revertRecordSchema.safeParse({ ...blocked, items: [] }).success);
  const pending = { ...fileRestore, result: "unchanged" };
  // applying: 아직 시작 전이라 이유가 없다. 끝난 뒤에는 이유가 있다.
  assert(
    revertRecordSchema.safeParse({
      ...record,
      outcome: "applying",
      redo: "none",
      result_seq: null,
      items: [pending],
    }).success,
  );
  assert(
    !revertRecordSchema.safeParse({
      ...record,
      outcome: "partial",
      redo: "none",
      items: [pending],
    }).success,
  );
  assert(
    revertRecordSchema.safeParse({
      ...record,
      outcome: "partial",
      redo: "none",
      items: [{ ...pending, reason: "app_not_settled" }],
    }).success,
  );
});

Deno.test("lophn-agent/revert#R17 [agent-RW2]: AmendRevertInstall is a machine command naming the paths install skipped, and RevertAmended carries the counts", () => {
  assertEquals(amendRevertInstall.actors, ["machine"]);
  assert(
    amendRevertInstallInputSchema.safeParse({
      revert: rvt,
      paths: ["notes/a.md"],
    }).success,
  );
  for (const paths of [[], ["a.md", "a.md"], ["../x.md"]]) {
    assert(
      !amendRevertInstallInputSchema.safeParse({ revert: rvt, paths }).success,
    );
  }
  assert(
    revertAmended.payload.safeParse({
      session: ses,
      amended: 1,
      results: counts,
    }).success,
  );
  assert(
    !revertAmended.payload.safeParse({
      session: ses,
      amended: 0,
      results: counts,
    }).success,
  );
});

Deno.test("lophn-agent/revert#R15 [agent-RW3e]: Summarize from here is asked by a person, summarized by the runtime, and the finished call is what the person then confirms", () => {
  // Compact와 같은 모양이다: 사람이 요청하고 runtime(machine)이 요약 call을 하며 끝낸 call을 돌려준다.
  assertEquals(requestRewindSummary.kind, "memory");
  assertEquals(requestRewindSummary.actors, ["user"]);
  assertEquals(readRewindSummary.actors, ["user"]);
  assertEquals(takeRewindSummaryRequest.actors, ["machine"]);
  assertEquals(finishRewindSummary.actors, ["machine"]);
  assert(
    requestRewindSummary.input.safeParse({ session: ses, checkpoint: msg })
      .success,
  );
  assert(!requestRewindSummary.input.safeParse({ session: ses }).success);
  assert(
    !requestRewindSummary.input.safeParse({
      session: ses,
      checkpoint: msg,
      choice: "summarize",
    }).success,
  );
  const states = [
    { state: "waiting" },
    { state: "summarized", summary_call: mcl },
    { state: "failed", reason: "nothing_to_summarize" },
  ];
  for (const state of states) {
    assert(rewindSummaryStateSchema.safeParse(state).success);
  }
  // 끝난 요약은 call을 싣고 실패는 이유를 싣는다. 둘을 섞지 않는다.
  assert(
    !rewindSummaryStateSchema.safeParse({ state: "summarized" }).success,
  );
  assert(
    !rewindSummaryStateSchema.safeParse({ state: "failed", reason: "nope" })
      .success,
  );
  const request = {
    id: "sum-1",
    session: ses,
    assignment: `asg_${suffix}`,
    from_seq: "21",
  };
  assert(takeRewindSummaryRequest.output.safeParse({ request }).success);
  assert(takeRewindSummaryRequest.output.safeParse({ request: null }).success);
  assert(
    finishRewindSummary.input.safeParse({
      id: "sum-1",
      result: { kind: "summarized", summary_call: mcl },
    }).success,
  );
  assert(
    finishRewindSummary.input.safeParse({
      id: "sum-1",
      result: { kind: "failed", reason: "model_unavailable" },
    }).success,
  );
  assert(
    !finishRewindSummary.input.safeParse({
      id: "sum-1",
      result: { kind: "summarized" },
    }).success,
  );
});

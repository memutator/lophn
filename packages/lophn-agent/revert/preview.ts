import { createHash } from "node:crypto";
import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import type {
  PreviewItem,
  RewindChoice,
} from "../../contracts/lophn-agent/mod.ts";
import type { Sql } from "../../contracts/platform/mod.ts";
import {
  type FileStat,
  type JudgedFile,
  judgeFiles,
  type JudgeRecord,
} from "./judge.ts";
import type { RevertDeps } from "./commands.ts";

// 되돌리기 preview(RevertPreview)와 그 지문(preview_hash)이다(lophn-agent/revert R3). 앱 항목(`apps`)은
// agent-RW3c가 app-revert.ts에서 만든다.

// 되돌릴 수 없는 사실 한 줄(외부 요청, 질문 답·승인 결정 같은 남는 영향).
export type PreviewFact = {
  target: string;
  reason: "external_effect" | "answered_fact";
  source: string[];
};

export type PreviewInput = {
  kind: "rewind" | "undo";
  choice: RewindChoice | null;
  checkpoint: string | null;
  tool_call: string | null;
  judged: readonly JudgedFile[];
  // 실행 순서(원래 호출 역순)로 놓은 앱 항목. ordinal은 여기서 다시 매긴다.
  apps: readonly PreviewItem[];
  facts: readonly PreviewFact[];
  // 판정에 든 경로의 지금 상태. preview_hash가 이 hash를 지문에 넣는다.
  current: ReadonlyMap<string, FileStat>;
};

export type PreviewResult = {
  restore: PreviewItem[];
  skip: PreviewItem[];
  remain: PreviewItem[];
  // 앱 복원 항목이 있으면 false, 또 summarize와 undo도 false다.
  redo: boolean;
  preview_hash: string;
};

// ordinal은 실행 순서다: 앱 항목, 문서 파일(판정 순서), 남는 사실 순으로 0부터 이어서 매긴다.
//   restore_all   : apps + files + facts
//   messages_only : facts만(파일·앱은 바뀌지 않으므로 restore·skip이 없다)
//   summarize     : 모두 비어 있다(아무것도 바뀌지 않는다)
//   undo(choice=null): files만
// preview_hash는 위 목록과 kind·choice·checkpoint·tool_call과 판정에 든 경로의 지금 hash로 정한 sha256이다.
// 같은 입력은 같은 hash, 하나라도 다르면 다른 hash다. 앱 항목의 step_key와 revert_invocation은 지문에
// 넣지 않는다(step_key는 아직 없는 revert id를 앞에 두므로 preview와 적용이 달라진다).
export function assemblePreview(input: PreviewInput): PreviewResult {
  const undo = input.kind === "undo";
  const restoreAll = input.choice === "restore_all";
  const items: PreviewItem[] = [
    ...(restoreAll ? input.apps : []),
    ...(undo || restoreAll ? input.judged.map(fileItem) : []),
    ...(!undo && input.choice !== "summarize" ? input.facts.map(factItem) : []),
  ].map((item, ordinal) => ({ ...item, ordinal }));
  const listed = (plan: PreviewItem["plan"]) =>
    items.filter((item) => item.plan === plan);
  const restore = listed("restore");
  const redo = !undo && input.choice !== "summarize" &&
    !restore.some((item) => item.class === "app");
  const watched = undo || restoreAll ? pathsOf(input.judged) : [];
  const preview_hash = createHash("sha256").update(canonicalize({
    kind: input.kind,
    choice: input.choice,
    checkpoint: input.checkpoint,
    tool_call: input.tool_call,
    items: items.map(fingerprintOf),
    current: watched.map((path) => {
      const stat = input.current.get(path);
      return {
        path,
        exists: stat?.exists ?? false,
        sha256: stat?.sha256 ?? null,
        link: stat?.link ?? false,
      };
    }),
  })).digest("hex");
  return {
    restore,
    skip: listed("skip"),
    remain: listed("remain"),
    redo,
    preview_hash,
  };
}

function fileItem(file: JudgedFile): PreviewItem {
  return {
    ordinal: 0,
    class: "file",
    target: file.path,
    source: file.source,
    plan: file.plan,
    reason: file.reason,
    app_revert: null,
  };
}

function factItem(fact: PreviewFact): PreviewItem {
  return {
    ordinal: 0,
    class: "fact",
    target: fact.target,
    source: fact.source,
    plan: "remain",
    reason: fact.reason,
    app_revert: null,
  };
}

function fingerprintOf(item: PreviewItem): unknown {
  if (item.app_revert === null) return item;
  const { step_key: _step, revert_invocation: _invocation, ...binding } =
    item.app_revert;
  return { ...item, app_revert: binding };
}

// 판정에 든 경로와 복원 동작이 건드리는 경로(이름 변경의 옛 경로)다.
export function pathsOf(judged: readonly JudgedFile[]): string[] {
  return [
    ...new Set(
      judged.flatMap((file) => [
        file.path,
        ...file.actions.map((action) => action.path),
      ]),
    ),
  ].sort();
}

export type RewindTarget =
  | {
    kind: "rewind";
    session: string;
    checkpoint: string;
    choice: RewindChoice;
  }
  | { kind: "undo"; session: string; tool_call: string };

export type RewindPlan = {
  target: RewindTarget;
  judged: JudgedFile[];
  current: Map<string, FileStat>;
  preview: PreviewResult;
};

export type PlanDeps = Pick<RevertDeps, "observe" | "rootOf" | "appRevision">;

type Lookup = { sql: Pick<Sql, "get" | "all"> };

// 판정에 쓸 기록과 남는 사실이다. planRewind의 앞 반이고, core가 파일을 비동기로 읽으러 갈 때도 같은
// 기록에서 경로를 얻는다.
type Gathered = {
  records: JudgeRecord[];
  facts: PreviewFact[];
  // undo에서 같은 경로에 되돌려지지 않은 더 최근 agent 기록이 있는 판정 경로.
  later: Set<string>;
};

function reject(
  code: "invalid_input" | "not_found" | "unavailable",
  message: string,
): Result<never> {
  return err({ code, message });
}

function recordOf(row: Record<string, unknown>): JudgeRecord {
  const text = (value: unknown) => value === null ? null : String(value);
  return {
    tool_call: String(row["tool_call"]),
    path: String(row["path"]),
    seq: String(row["seq"]),
    before: Number(row["before_exists"]) === 1
      ? {
        exists: true,
        sha256: text(row["before_sha256"]),
        blob: text(row["before_blob"]),
      }
      : { exists: false, sha256: null, blob: null },
    after: Number(row["after_exists"]) === 1
      ? { exists: true, sha256: text(row["after_sha256"]) }
      : { exists: false, sha256: null },
    moved_from: text(row["moved_from"]),
    reverted_by: text(row["reverted_by"]),
  };
}

const RECORD_COLUMNS =
  `f.tool_call as tool_call, f.path as path, f.seq as seq, f.before_exists as before_exists,
   f.before_sha256 as before_sha256, f.before_blob as before_blob, f.after_exists as after_exists,
   f.after_sha256 as after_sha256, f.moved_from as moved_from, f.reverted_by as reverted_by`;

// 앱 write가 낀 구간의 rewind는 앱 단계(agent-RW3c)가 올라오기 전에는 시작하지 못한다. 앱 write를
// 남는 영향으로 두거나 건너뛰면 되돌렸다고 읽히는 거짓 성공이 되므로 막는다.
function hasAppWrite(
  lookup: Lookup,
  session: string,
  afterSeq: string,
): boolean {
  return lookup.sql.get(
    `select 1 as found from tool_calls t join runs r on r.id = t.run
      where r.session = ? and t.app_command is not null
        and t.effect in ('write', 'external') and t.state_seq > ?
        and json_extract(t.outcome, '$.kind') = 'success' limit 1`,
    [session, Number(afterSeq)],
  ) !== undefined;
}

function externalFacts(
  lookup: Lookup,
  session: string,
  afterSeq: string,
): PreviewFact[] {
  const calls = lookup.sql.all(
    `select t.id as id from tool_calls t join runs r on r.id = t.run
      where r.session = ? and t.effect = 'external' and t.app_command is null
        and t.state_seq > ? and json_extract(t.outcome, '$.kind') = 'success'
      order by t.state_seq`,
    [session, Number(afterSeq)],
  ).map((row) => String(row["id"]));
  return calls.length === 0 ? [] : [{
    target: "external_request",
    reason: "external_effect",
    source: calls,
  }];
}

function gatherRewind(
  lookup: Lookup,
  target: Extract<RewindTarget, { kind: "rewind" }>,
): Result<Gathered> {
  const message = lookup.sql.get(
    `select actor, mode, created_seq from messages where id = ? and session = ?`,
    [target.checkpoint, target.session],
  );
  if (
    message === undefined || message["actor"] !== "user" ||
    message["mode"] === null
  ) return reject("not_found", "checkpoint message not found");
  const boundary = String(message["created_seq"]);
  const restoreAll = target.choice === "restore_all";
  if (restoreAll) {
    const checkpoint = lookup.sql.get(
      "select files_restorable from checkpoints where message = ?",
      [target.checkpoint],
    );
    if (checkpoint === undefined) {
      return reject(
        "invalid_input",
        "a correction message restores messages only",
      );
    }
    if (Number(checkpoint["files_restorable"]) !== 1) {
      return reject(
        "invalid_input",
        "the documents of this checkpoint cannot be restored",
      );
    }
    if (hasAppWrite(lookup, target.session, boundary)) {
      return reject(
        "unavailable",
        "app writes after this checkpoint cannot be rewound yet",
      );
    }
  }
  const records = restoreAll
    ? lookup.sql.all(
      `select ${RECORD_COLUMNS}
         from rewind_files f
         join checkpoints c on c.message = f.checkpoint
         join messages m on m.id = c.message
        where c.session = ? and m.created_seq >= ?
        order by f.seq`,
      [target.session, Number(boundary)],
    ).map(recordOf)
    : [];
  const facts = target.choice === "summarize"
    ? []
    : externalFacts(lookup, target.session, boundary);
  return ok({ records, facts, later: new Set() });
}

function gatherUndo(
  lookup: Lookup,
  target: Extract<RewindTarget, { kind: "undo" }>,
): Result<Gathered> {
  const own = lookup.sql.all(
    `select ${RECORD_COLUMNS}
       from rewind_files f join checkpoints c on c.message = f.checkpoint
      where c.session = ? and f.tool_call = ? order by f.seq`,
    [target.session, target.tool_call],
  ).map(recordOf);
  if (own.length === 0) return reject("not_found", "edit not found");
  const later = new Set<string>();
  for (const record of own) {
    for (const path of [record.path, record.moved_from]) {
      if (path === null) continue;
      const newer = lookup.sql.get(
        `select 1 as found
           from rewind_files f join checkpoints c on c.message = f.checkpoint
          where c.session = ? and f.tool_call != ? and f.seq > ?
            and f.reverted_by is null and (f.path = ? or f.moved_from = ?)
          limit 1`,
        [target.session, target.tool_call, Number(record.seq), path, path],
      );
      if (newer !== undefined) later.add(record.path);
    }
  }
  return ok({ records: own, facts: [], later });
}

function gather(lookup: Lookup, target: RewindTarget): Result<Gathered> {
  return target.kind === "rewind"
    ? gatherRewind(lookup, target)
    : gatherUndo(lookup, target);
}

function observedPaths(records: readonly JudgeRecord[]): string[] {
  return [
    ...new Set(
      records.flatMap((record) =>
        record.moved_from === null
          ? [record.path]
          : [record.path, record.moved_from]
      ),
    ),
  ].sort();
}

// 파일을 읽어야 하는 경로와 그 project 폴더다. core가 파일을 비동기로 읽을 때 쓴다. 읽을 파일이 없으면
// root는 빈 문자열이다.
export function observationOf(
  lookup: Lookup,
  deps: Pick<PlanDeps, "rootOf">,
  target: RewindTarget,
): Result<{ root: string; paths: string[] }> {
  const gathered = gather(lookup, target);
  if (!gathered.ok) return gathered;
  const paths = observedPaths(gathered.value.records);
  if (paths.length === 0) return ok({ root: "", paths });
  try {
    return ok({ root: deps.rootOf(lookup, target.session), paths });
  } catch {
    return reject("unavailable", "the project folder is not available");
  }
}

// ledger 기록(rewind_files·tool_calls)을 읽어 판정하고 preview를 만든다. preview 읽기, 파일 준비,
// Rewind·UndoEdit command가 같은 함수를 쓴다.
//   options.observed: 주면 파일을 다시 읽지 않고 그 관측을 쓴다(command는 준비 때 본 관측으로 다시 판정한다).
// 파일 판정은 choice=restore_all(과 undo)일 때만 한다. messages_only·summarize는 파일을 건드리지
// 않으므로 judged가 비어 있다. 거절 규칙:
//   checkpoint가 session에 없거나 사람 메시지가 아니면 `not_found`.
//   correction 메시지(checkpoints 행 없음)에 restore_all이면, files_restorable=false인 checkpoint에
//   restore_all이면 `invalid_input`. 이미 숨긴 구간 안의 checkpoint 검사는 hidden.ts(agent-RW3d)다.
//   undo는 tool_call의 기록이 없으면 `not_found`. 같은 경로에 되돌려지지 않은 더 최근 기록이 있으면 skip
//   `later_edit`, 그렇지 않고 지금 hash가 그 call의 after와 다르면 skip `edited_outside`로 읽는다(거절하지
//   않고 preview에서 막는다).
// 앱 write가 낀 구간의 restore_all은 앱 단계(agent-RW3c)가 올라오기 전까지 `unavailable`이다.
export function planRewind(
  lookup: Lookup,
  deps: PlanDeps,
  target: RewindTarget,
  options: { observed?: ReadonlyMap<string, FileStat> } = {},
): Result<RewindPlan> {
  const gathered = gather(lookup, target);
  if (!gathered.ok) return gathered;
  const { records, facts, later } = gathered.value;
  const paths = observedPaths(records);
  let current: Map<string, FileStat>;
  if (options.observed !== undefined) {
    current = new Map(options.observed);
  } else if (paths.length === 0) {
    current = new Map();
  } else {
    if (deps.observe === undefined) {
      return reject("unavailable", "the project files cannot be read here");
    }
    try {
      current = new Map(
        deps.observe(deps.rootOf(lookup, target.session), paths),
      );
    } catch {
      return reject("unavailable", "the project files are not available");
    }
  }
  const judged = judgeFiles({ records, current }).map((file) =>
    laterEdit(file, later)
  );
  const preview = assemblePreview({
    kind: target.kind,
    choice: target.kind === "rewind" ? target.choice : null,
    checkpoint: target.kind === "rewind" ? target.checkpoint : null,
    tool_call: target.kind === "undo" ? target.tool_call : null,
    judged,
    apps: [],
    facts,
    current,
  });
  return ok({ target, judged, current, preview });
}

// 같은 경로에 더 최근 agent 기록이 있는 편집은 Undo할 수 없다. 사람이 고친 것(edited_outside)과
// 이유가 다르므로 먼저 가른다.
function laterEdit(file: JudgedFile, later: ReadonlySet<string>): JudgedFile {
  const overridable = file.plan === "restore" ||
    file.reason === "edited_outside" || file.reason === "created_edited";
  if (!later.has(file.path) || !overridable) return file;
  return {
    ...file,
    plan: "skip",
    reason: "later_edit",
    actions: [],
    restored_sha256: null,
  };
}

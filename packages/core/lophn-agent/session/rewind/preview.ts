import { createHash } from "node:crypto";
import { canonicalize, err, ok, type Result } from "../../../../base/mod.ts";
import type {
  PreviewItem,
  RewindChoice,
} from "../../../../protocol/lophn-agent/mod.ts";
import type { Sql } from "../../../../protocol/server/mod.ts";
import {
  type FileStat,
  type JudgedFile,
  judgeFiles,
  type JudgeRecord,
} from "./judge.ts";

// session rewind preview와 그 지문(preview_hash)이다. 파일 판정은 file tool이 남긴 기록(rewind_files)과
// 파일의 지금 상태로 하고, 앱은 여기서 다루지 않는다: 고른 시점 뒤 이 session의 앱 write 목록은 읽기(reads.ts)가
// AppWrites로 붙이고, 앱 rewind의 계획은 앱 rewind의 계획 route가 보인다.

// 되돌릴 수 없는 사실 한 줄(외부 요청 같은 남는 영향).
type PreviewFact = {
  target: string;
  reason: "external_effect";
  source: string[];
};

type PreviewInput = {
  choice: RewindChoice;
  checkpoint: string;
  judged: readonly JudgedFile[];
  facts: readonly PreviewFact[];
  // 판정에 든 경로의 지금 상태. preview_hash가 이 hash를 지문에 넣는다.
  current: ReadonlyMap<string, FileStat>;
};

type PreviewResult = {
  restore: PreviewItem[];
  skip: PreviewItem[];
  remain: PreviewItem[];
  preview_hash: string;
};

// ordinal은 실행 순서다: 파일(판정 순서), 남는 사실 순으로 0부터 이어서 매긴다.
//   restore_all   : files + facts
//   messages_only : facts만(파일은 바뀌지 않으므로 restore·skip이 없다)
//   summarize     : 모두 비어 있다(아무것도 바뀌지 않는다)
// preview_hash는 위 목록과 choice·checkpoint와 판정에 든 경로의 지금 hash로 정한 sha256이다. 같은 입력은
// 같은 hash, 하나라도 다르면 다른 hash다.
function assemblePreview(input: PreviewInput): PreviewResult {
  const restoreAll = input.choice === "restore_all";
  const items: PreviewItem[] = [
    ...(restoreAll ? input.judged.map(fileItem) : []),
    ...(input.choice !== "summarize" ? input.facts.map(factItem) : []),
  ].map((item, ordinal) => ({ ...item, ordinal }));
  const listed = (plan: PreviewItem["plan"]) =>
    items.filter((item) => item.plan === plan);
  const watched = restoreAll ? pathsOf(input.judged) : [];
  const preview_hash = createHash("sha256").update(canonicalize({
    choice: input.choice,
    checkpoint: input.checkpoint,
    items,
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
    restore: listed("restore"),
    skip: listed("skip"),
    remain: listed("remain"),
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
  };
}

// 판정에 든 경로와 복원 동작이 건드리는 경로(이름 변경의 옛 경로)다.
function pathsOf(judged: readonly JudgedFile[]): string[] {
  return [
    ...new Set(
      judged.flatMap((file) => [
        file.path,
        ...file.actions.map((action) => action.path),
      ]),
    ),
  ].sort();
}

export type RewindTarget = {
  session: string;
  checkpoint: string;
  choice: RewindChoice;
};

export type RewindPlan = {
  target: RewindTarget;
  judged: JudgedFile[];
  current: Map<string, FileStat>;
  preview: PreviewResult;
};

// 파일 하나: 허용 폴더(절대 경로)와 그 안의 상대 경로.
export type FileRef = { root: string; path: string };

export type PlanDeps = {
  // 파일마다 지금 파일 상태를 동기로 읽는다(preview 읽기가 쓴다). command는 읽지 않고 준비한 관측으로
  // 판정하므로 command만 올리는 쪽은 주지 않는다. 없으면 preview 읽기는 unavailable이다. 결과의 key는 path다.
  observe?(files: readonly FileRef[]): Map<string, FileStat>;
};

type Lookup = { sql: Pick<Sql, "get" | "all"> };

// 판정에 쓸 기록과 남는 사실이다. planRewind의 앞 반이고, core가 파일을 비동기로 읽으러 갈 때도 같은
// 기록에서 경로를 얻는다.
type Gathered = {
  records: JudgeRecord[];
  facts: PreviewFact[];
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
    root: String(row["root"]),
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
  `f.tool_call as tool_call, f.root as root, f.path as path, f.seq as seq, f.before_exists as before_exists,
   f.before_sha256 as before_sha256, f.before_blob as before_blob, f.after_exists as after_exists,
   f.after_sha256 as after_sha256, f.moved_from as moved_from, f.reverted_by as reverted_by`;

// 고른 시점 뒤에 이 session의 turn이 외부에 낸 효과다. 앱 tool의 효과는 앱 rewind의 계획이 보이므로
// 여기서 세지 않는다.
function externalFacts(
  lookup: Lookup,
  session: string,
  boundary: string,
): PreviewFact[] {
  const calls = lookup.sql.all(
    `select t.id as id
       from tool_calls t
       join turns r on r.id = t.turn
       join messages m on m.id = r.input_message
      where r.session = ? and m.created_seq >= ?
        and t.effect = 'external' and t.tool not like 'app\\_\\_%' escape '\\'
        and json_extract(t.outcome, '$.kind') = 'success'
      order by t.id`,
    [session, Number(boundary)],
  ).map((row) => String(row["id"]));
  return calls.length === 0 ? [] : [{
    target: "external_request",
    reason: "external_effect",
    source: calls,
  }];
}

function gather(lookup: Lookup, target: RewindTarget): Result<Gathered> {
  const message = lookup.sql.get(
    `select m.created_seq as created_seq, c.files_restorable as files_restorable
       from messages m join checkpoints c on c.message = m.id
      where m.id = ? and m.session = ?`,
    [target.checkpoint, target.session],
  );
  if (message === undefined) {
    return reject("not_found", "checkpoint message not found");
  }
  const boundary = String(message["created_seq"]);
  const restoreAll = target.choice === "restore_all";
  if (restoreAll && Number(message["files_restorable"]) !== 1) {
    return reject(
      "invalid_input",
      "the files of this checkpoint cannot be restored",
    );
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
  return ok({ records, facts });
}

function observedFiles(records: readonly JudgeRecord[]): FileRef[] {
  const found = new Map<string, FileRef>();
  for (const record of records) {
    for (const path of [record.path, record.moved_from]) {
      if (path === null) continue;
      found.set(`${record.root}\n${path}`, { root: record.root, path });
    }
  }
  return [...found.values()].sort((left, right) =>
    left.root === right.root
      ? left.path.localeCompare(right.path)
      : left.root.localeCompare(right.root)
  );
}

// 파일을 읽어야 하는 경로와 그 허용 폴더다. core가 파일을 비동기로 읽을 때 쓴다.
export function observationOf(
  lookup: Lookup,
  target: RewindTarget,
): Result<FileRef[]> {
  const gathered = gather(lookup, target);
  return gathered.ok ? ok(observedFiles(gathered.value.records)) : gathered;
}

// ledger 기록(rewind_files·tool_calls)을 읽어 판정하고 preview를 만든다. preview 읽기, 파일 준비,
// Rewind command가 같은 함수를 쓴다.
//   options.observed: 주면 파일을 다시 읽지 않고 그 관측을 쓴다(command는 준비 때 본 관측으로 다시 판정한다).
// 파일 판정은 choice=restore_all일 때만 한다. messages_only·summarize는 파일을 건드리지 않으므로 judged가
// 비어 있다. 거절 규칙:
//   checkpoint가 session에 없거나 checkpoint 행이 없는 메시지(steer로 들어간 메시지 등)면 `not_found`.
//   files_restorable=false인 checkpoint에 restore_all이면 `invalid_input`.
//   이미 숨긴 구간 안의 checkpoint 검사는 hidden.ts다(Rewind command와 preview 읽기가 따로 부른다).
export function planRewind(
  lookup: Lookup,
  deps: PlanDeps,
  target: RewindTarget,
  options: { observed?: ReadonlyMap<string, FileStat> } = {},
): Result<RewindPlan> {
  const gathered = gather(lookup, target);
  if (!gathered.ok) return gathered;
  const { records, facts } = gathered.value;
  const files = observedFiles(records);
  let current: Map<string, FileStat>;
  if (options.observed !== undefined) {
    current = new Map(options.observed);
  } else if (files.length === 0) {
    current = new Map();
  } else {
    if (deps.observe === undefined) {
      return reject("unavailable", "the files cannot be read here");
    }
    try {
      current = new Map(deps.observe(files));
    } catch {
      return reject("unavailable", "the files are not available");
    }
  }
  const judged = judgeFiles({ records, current });
  const preview = assemblePreview({
    choice: target.choice,
    checkpoint: target.checkpoint,
    judged,
    facts,
    current,
  });
  return ok({ target, judged, current, preview });
}

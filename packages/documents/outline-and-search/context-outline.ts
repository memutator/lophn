// context 목차. 목적, 기준→참고→watch 순서의 항목, 선택 이유, 선택 고정 판, 읽기
// 가능 여부, 빈 관점 구별(outline-and-search#R4)과 root의 context 요약(#R2)이다.
// 항목은 최신 판을 따라 읽되 이 응답이 가리키는 판은 읽은 시점에 고른 고정 판이고
// 항목별 옛 판 고정 옵션은 없다(contexts#R4). 본문과 앱 데이터는 싣지 않는다.
// 권한 밖 문서·앱 항목은 없는 항목과 같이 빠지고 count·page도 허용 집합에서 센다.
import { err, ok, type Result } from "../../base/mod.ts";
import {
  CONTEXT_ESTIMATED_TOKEN_BUDGET,
  GLOSSARY_FIRST_PAGE_LIMIT,
} from "../../contracts/documents/mod.ts";
import {
  type AuthorizationTarget,
  REDACTION_REPLACEMENT,
  type RequestContext,
} from "../../contracts/platform/mod.ts";
import {
  decodeOutlineCursor,
  encodeOutlineCursor,
  estimatedTokens,
} from "./model.ts";
import {
  authorize,
  authorizeTarget,
  coverageOfLike,
  formatRef,
} from "./outline-support.ts";
import type { OutlineHandlerDeps } from "./reads.ts";
import type {
  ContextOutlineItem,
  ContextOutlineRecord,
  TermGlossaryItem,
} from "./types.ts";
import type { SearchCoverage } from "./work.ts";

export type ContextOutlineInput = {
  context: string;
  estimated_token_budget?: number;
  cursor?: string;
};

type Deps = Pick<
  OutlineHandlerDeps,
  | "read"
  | "snapshot"
  | "ports"
  | "contextOutline"
  | "termGlossary"
  | "extract"
  | "redactor"
>;

type SectionStatus =
  | "whole"
  | "found"
  | "missing"
  | "unverified"
  | "unsupported";

export type ContextOutlineEntryValue =
  | {
    kind: "document";
    perspective: ContextOutlineItem["perspective"];
    reason: string;
    title: string;
    readable: boolean;
    target: { kind: "document"; document: string; section: string | null };
    version: string | null;
    latest_version: string | null;
    format: { name: string; module_hash: string; explicit: boolean } | null;
    module_hash: string | null;
    section_status: SectionStatus;
  }
  | {
    kind: "app_command";
    perspective: ContextOutlineItem["perspective"];
    reason: string;
    title: string;
    readable: boolean;
    target: { kind: "app_command"; app: string; command: string };
  };

export type ContextOutlinePage = {
  kind: "context";
  basis_seq: string;
  context: string;
  title: string;
  purpose: string;
  entries: ContextOutlineEntryValue[];
  coverage: SearchCoverage;
  perspectives: {
    basis: ContextOutlineEntryValue[];
    reference: ContextOutlineEntryValue[];
    watch: ContextOutlineEntryValue[];
  };
  // 용어(documents/terms). 첫 page에서만 활성 정의와 후보를 나눠 싣는다.
  glossary: GlossaryTermValue[];
  candidates: GlossaryTermValue[];
  as_of_seq: string;
  next_cursor: string | null;
  complete: boolean;
};

export type GlossaryTermValue = {
  id: string;
  context: string;
  name: string;
  definition: string | null;
  evidence: {
    document: string;
    version: string;
    section: string | null;
    range: { start_line: number; end_line: number } | null;
  }[];
  revision: string;
  status: "active" | "archived";
};

// root의 context 항목이 쓰는 값. 기준 항목 수와 참조 앱 수는 허용 집합에서 센다.
export type ContextRootSummary = {
  id: string;
  title: string;
  purpose: string;
  activity_seq: string;
  basis_count: number;
  reference_app_count: number;
};

const PERSPECTIVE_ORDER = { basis: 0, reference: 1, watch: 2 } as const;

function deny(): Result<never> {
  return err({ code: "not_found", message: "outline does not resolve" });
}

// 기준→참고→watch 순서. 같은 관점 안은 position 순이다(근원이 position 순으로 준다).
function perspectiveOrdered(
  items: readonly ContextOutlineItem[],
): ContextOutlineItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) =>
      PERSPECTIVE_ORDER[a.item.perspective] -
        PERSPECTIVE_ORDER[b.item.perspective] || a.index - b.index
    )
    .map((entry) => entry.item);
}

type AppRow = { name: string; active: boolean };

function appRow(deps: Deps, app: string): AppRow | null {
  const row = deps.snapshot.sql.get(
    `SELECT name, status FROM apps WHERE id = ?`,
    [app],
  );
  if (row === undefined) return null;
  return {
    name: String(row["name"] ?? ""),
    active: String(row["status"]) === "active",
  };
}

// 허용 집합에 드는 항목. 권한 밖이거나 대상 행이 없는 항목은 없는 것과 같다.
type Visible = {
  item: ContextOutlineItem;
  app: AppRow | null;
};

function visibleItems(
  deps: Deps,
  ctx: RequestContext,
  operation: string,
  record: ContextOutlineRecord,
): Visible[] {
  const visible: Visible[] = [];
  for (const item of perspectiveOrdered(record.items)) {
    if (item.target.kind === "document") {
      const document = item.document;
      if (document === undefined) continue;
      if (
        !authorizeTarget(
          deps,
          ctx,
          operation,
          item.target.document,
          document.place?.kind,
          document.place?.id,
        )
      ) continue;
      visible.push({ item, app: null });
      continue;
    }
    const app = appRow(deps, item.target.app);
    if (app === null) continue;
    if (!authorize(deps.ports, ctx, operation, { app: item.target.app })) {
      continue;
    }
    visible.push({ item, app });
  }
  return visible;
}

// context 대상 판정에 주는 target이다. 앱 하나에 묶인 agent는 그 앱의 읽기를 항목으로 가진 context만 본다.
function contextTarget(record: ContextOutlineRecord): AuthorizationTarget {
  return {
    context: record.id,
    context_apps: [
      ...new Set(
        record.items.flatMap((item) =>
          item.target.kind === "app_command" ? [item.target.app] : []
        ),
      ),
    ],
  };
}

// root의 context 요약. 문제·질문·approval 대기는 소유 concern의 읽기를 가리키므로
// 여기서 세지 않는다. 권한 밖 context는 없는 것과 같다.
export function contextRootSummaries(
  deps: Deps,
  ctx: RequestContext,
): ContextRootSummary[] {
  if (deps.contextOutline === undefined) return [];
  const active = deps.contextOutline.active();
  // 근원을 읽지 못한 root는 context를 빈 목록으로 꾸미지 않고 그 줄을 뺀다.
  if (!active.ok) return [];
  const summaries: ContextRootSummary[] = [];
  for (const record of active.value) {
    if (
      !authorize(deps.ports, ctx, "outline.root", contextTarget(record))
    ) continue;
    const visible = visibleItems(deps, ctx, "outline.root", record);
    const apps = new Set<string>();
    let basis = 0;
    for (const { item } of visible) {
      if (item.perspective === "basis") basis += 1;
      if (item.target.kind === "app_command") apps.add(item.target.app);
    }
    summaries.push({
      id: record.id,
      title: record.title,
      purpose: record.purpose,
      activity_seq: record.revision,
      basis_count: basis,
      reference_app_count: apps.size,
    });
  }
  return summaries;
}

// 출력 redaction. 목적·제목·이유는 사람이 쓴 글이라 agent 출력에서도 같은 규칙이다.
// 안전화를 끝내지 못하면 원문을 내지 않는다(fail-closed).
function safe(deps: Deps, scope: string, revision: string, text: string) {
  if (deps.redactor === undefined) return text;
  const out = deps.redactor(
    { concern: "documents", revision, scope },
    "text/plain",
    text,
  );
  return out === null || out.trim().length === 0 ? REDACTION_REPLACEMENT : out;
}

function hasSection(
  deps: Pick<Deps, "read">,
  version: string,
  key: string,
): boolean {
  return deps.read.sql.get(
    `SELECT key FROM derived_sections WHERE version = ? AND key = ?`,
    [version, key],
  ) !== undefined;
}

// 성공 추출의 key 없음은 missing, 미지원은 unsupported, 미완료·실패는 unverified다.
// 추정 section을 돌려주지 않는다(R22). 근원이 없는 판은 직접 추출을 부르되 기다리지
// 않는다(R15).
export function sectionStatusOf(
  deps: Pick<Deps, "read" | "extract">,
  document: string,
  version: string | null,
  section: string | null,
): SectionStatus {
  if (section === null) return "whole";
  if (version === null) return "unverified";
  const row = deps.read.sql.get(
    `SELECT extraction_status FROM derived_versions WHERE version = ?`,
    [version],
  );
  if (row === undefined) {
    if (deps.extract !== undefined) deps.extract({ document, version });
    return "unverified";
  }
  const status = String(row["extraction_status"]);
  if (status === "unsupported") return "unsupported";
  if (status !== "ready") return "unverified";
  return hasSection(deps, version, section) ? "found" : "missing";
}

function entryOf(
  deps: Deps,
  context: ContextOutlineRecord,
  visible: Visible,
): ContextOutlineEntryValue {
  const { item } = visible;
  const reason = safe(deps, context.id, context.revision, item.reason);
  if (item.target.kind === "app_command") {
    const name = visible.app?.name ?? "";
    return {
      kind: "app_command",
      perspective: item.perspective,
      reason,
      title: safe(
        deps,
        context.id,
        context.revision,
        `${name}/${item.target.command}`,
      ),
      readable: visible.app?.active === true,
      target: item.target,
    };
  }
  const document = item.document;
  const target = item.target;
  // 보관 문서는 선택 판을 내지 않는다. 읽기 route도 보관 문서를 열지 않는다.
  const selected = document?.status === "active" ? document.version : null;
  const format = selected === null ? null : formatRef(deps.snapshot, selected);
  const version = format === null ? null : selected;
  const section = sectionStatusOf(
    deps,
    target.document,
    version,
    target.section,
  );
  return {
    kind: "document",
    perspective: item.perspective,
    reason,
    title: safe(deps, context.id, context.revision, document?.title ?? ""),
    readable: version !== null &&
      (target.section === null || section === "found"),
    target,
    version,
    latest_version: version,
    format,
    module_hash: format === null ? null : format.module_hash,
    section_status: section,
  };
}

// 근거는 고정 판 참조다. 읽을 수 없는 문서의 근거는 없는 근거와 같이 빠진다.
function glossaryTermOf(
  deps: Deps,
  ctx: RequestContext,
  record: ContextOutlineRecord,
  term: TermGlossaryItem,
): GlossaryTermValue {
  const evidence: GlossaryTermValue["evidence"] = [];
  for (const item of term.evidence) {
    if (
      !authorizeTarget(
        deps,
        ctx,
        "outline.context",
        item.document,
        item.place?.kind,
        item.place?.id,
      )
    ) continue;
    evidence.push({
      document: item.document,
      version: item.version,
      section: item.section,
      range: item.start_line === null || item.end_line === null
        ? null
        : { start_line: item.start_line, end_line: item.end_line },
    });
  }
  return {
    id: term.id,
    context: term.context,
    name: safe(deps, record.id, term.revision, term.name),
    definition: term.definition === null
      ? null
      : safe(deps, record.id, term.revision, term.definition),
    evidence,
    revision: term.revision,
    status: term.status,
  };
}

// 정의와 후보를 나눠 첫 page만 싣는다(정의 30개). 이어 읽기는 `/v1/terms/list`다.
// 근원을 읽지 못하면 빈 glossary로 꾸미지 않고 오류로 답한다.
function glossaryOf(
  deps: Deps,
  ctx: RequestContext,
  record: ContextOutlineRecord,
): Result<{ glossary: GlossaryTermValue[]; candidates: GlossaryTermValue[] }> {
  if (deps.termGlossary === undefined) {
    return ok({ glossary: [], candidates: [] });
  }
  const loaded = deps.termGlossary.get(record.id, GLOSSARY_FIRST_PAGE_LIMIT);
  if (!loaded.ok) return loaded;
  return ok({
    glossary: loaded.value.definitions.map((term) =>
      glossaryTermOf(deps, ctx, record, term)
    ),
    candidates: loaded.value.candidates.map((term) =>
      glossaryTermOf(deps, ctx, record, term)
    ),
  });
}

function entryCost(entry: ContextOutlineEntryValue): number {
  return estimatedTokens(
    120 + [...entry.title].length + [...entry.reason].length,
  );
}

export function buildContextOutline(
  deps: Deps,
  ctx: RequestContext,
  input: ContextOutlineInput,
): Result<ContextOutlinePage> {
  if (deps.contextOutline === undefined) {
    return err({
      code: "unavailable",
      message: "context outline source is not connected",
    });
  }
  const loaded = deps.contextOutline.get(input.context);
  if (!loaded.ok) return loaded;
  const record = loaded.value;
  // 없는 context와 권한 밖 context는 같은 응답이다(존재를 새지 않는다).
  if (record === null) return deny();
  if (
    !authorize(deps.ports, ctx, "outline.context", contextTarget(record))
  ) return deny();
  const budget = input.estimated_token_budget ??
    CONTEXT_ESTIMATED_TOKEN_BUDGET;
  const basis = {
    topic: "outline.context",
    basis_seq: deps.snapshot.as_of_seq,
    sort: "perspective",
    conditions: { context: record.id, budget },
    credential: ctx.credential_ref,
  };
  const resume = input.cursor === undefined
    ? ok({ offset: 0 })
    : decodeOutlineCursor(input.cursor, basis);
  if (!resume.ok) return resume;
  const visible = visibleItems(deps, ctx, "outline.context", record);
  const all = visible.map((entry) => entryOf(deps, record, entry));
  const page: ContextOutlineEntryValue[] = [];
  let used = 0;
  let complete = true;
  for (const entry of all.slice(resume.value.offset)) {
    const cost = entryCost(entry);
    if (used + cost > budget && page.length > 0) {
      complete = false;
      break;
    }
    used += cost;
    page.push(entry);
  }
  const documents = new Set(
    visible.flatMap(({ item }) =>
      item.target.kind === "document" ? [item.target.document] : []
    ),
  );
  const next = resume.value.offset + page.length;
  // 용어는 첫 page에서만 싣는다. 이어 받는 page는 항목만 이어 준다.
  const terms = resume.value.offset === 0
    ? glossaryOf(deps, ctx, record)
    : ok({ glossary: [], candidates: [] });
  if (!terms.ok) return terms;
  return ok({
    kind: "context",
    basis_seq: deps.snapshot.as_of_seq,
    context: record.id,
    title: safe(deps, record.id, record.revision, record.title),
    purpose: safe(deps, record.id, record.revision, record.purpose),
    entries: page,
    coverage: coverageOfLike(deps.read, deps.snapshot.as_of_seq, documents),
    // 빈 관점도 사라지지 않게 세 key를 항상 낸다. 안 보인 항목이 다음 page에 있으면
    // complete=false다.
    perspectives: {
      basis: page.filter((entry) => entry.perspective === "basis"),
      reference: page.filter((entry) => entry.perspective === "reference"),
      watch: page.filter((entry) => entry.perspective === "watch"),
    },
    glossary: terms.value.glossary,
    candidates: terms.value.candidates,
    as_of_seq: deps.snapshot.as_of_seq,
    complete,
    next_cursor: complete ? null : encodeOutlineCursor({
      ...basis,
      versions: page.flatMap((entry) =>
        entry.kind === "document" && entry.version !== null
          ? [{ document: entry.target.document, version: entry.version }]
          : []
      ),
    }, next),
  });
}

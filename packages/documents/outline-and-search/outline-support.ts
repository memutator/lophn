// outline·search 읽기가 같이 쓰는 작은 읽기 도우미. 범위 검사, 선택 판의 format,
// index coverage다. 읽기 handler 모듈들이 서로 import하지 않게 여기 둔다.
import { ok, type Result } from "../../base/mod.ts";
import type { SearchResult } from "../../contracts/documents/mod.ts";
import {
  type AuthorizationTarget,
  type RequestContext,
  TargetAuthorization,
} from "../../contracts/platform/mod.ts";
import type { DerivedRead } from "./adapters/store.ts";
import {
  bodyChunk,
  decodeBodyCursor,
  encodeBodyCursor,
  estimatedTokens,
} from "./model.ts";
import type { PortLookup, SearchSnapshot } from "./types.ts";
import { allOmissions, type SearchCoverage } from "./work.ts";

// coverage는 현재 scope의 진실이다. 같은 seq에도 lagging=true를 허용한다.
// omissions도 허용 집합에서 뺀다. 권한 밖 문서의 누락은 응답에 새지 않는다(R12).
export function coverageOfLike(
  read: DerivedRead,
  ledgerBasisSeq: string,
  allowed?: ReadonlySet<string>,
): SearchCoverage {
  const row = read.sql.get(
    `SELECT processed_seq, rebuilding FROM derived_cursors WHERE consumer = 'search'`,
    [],
  );
  const processed = row === undefined ? "0" : String(row.processed_seq);
  const rebuilding = row === undefined ? false : Number(row.rebuilding) === 1;
  const basis = ledgerBasisSeq;
  const lagging = BigInt(processed) < BigInt(basis);
  return {
    processed_seq: processed,
    ledger_basis_seq: basis,
    lagging,
    rebuilding,
    omissions: allOmissions(read.sql, allowed),
  };
}

export function formatRef(
  snapshot: SearchSnapshot,
  version: string,
): SearchResult["format"] | null {
  const row = snapshot.sql.get(
    `SELECT format_name, module_hash, format_explicit FROM versions WHERE id = ?`,
    [version],
  );
  if (row === undefined) return null;
  const name = row["format_name"];
  const hash = row["module_hash"];
  if (typeof name !== "string" || typeof hash !== "string") return null;
  const explicit = row["format_explicit"];
  return {
    name,
    module_hash: hash,
    explicit: explicit === 1 || explicit === BigInt(1),
  };
}

// 범위 검사. 권한 밖은 없는 대상과 같이 답한다. port가 없거나 판정이 동기 Result가
// 아니면 fail-closed다.
export function authorize(
  ports: PortLookup,
  ctx: RequestContext,
  operation: string,
  target: AuthorizationTarget,
): boolean {
  let authorizer: unknown;
  try {
    authorizer = ports.port(TargetAuthorization);
  } catch {
    return false;
  }
  if (typeof authorizer !== "function") return false;
  try {
    const result = authorizer(ctx, operation, target);
    if (result instanceof Promise) {
      void result.catch(() => {});
      return false;
    }
    if (typeof result !== "object" || result === null || "then" in result) {
      return false;
    }
    return result.ok === true;
  } catch {
    return false;
  }
}

// 단일 문서 대상의 범위 검사.
export function authorizeTarget(
  deps: { ports: PortLookup },
  ctx: RequestContext,
  operation: string,
  document: string,
  placeKind: string | undefined,
  placeId: string | undefined,
  // 판을 주소로 연 읽기의 판이다. handoff 고정 근거의 (문서, 판) 판정이 쓴다. 최신 판 읽기·목록은 주지 않는다.
  version?: string,
): boolean {
  return authorize(deps.ports, ctx, operation, {
    document,
    place_kind: placeKind,
    place: placeId,
    ...(version === undefined ? {} : { version }),
    // 앱 하나 범위 연결의 앱은 문서의 자리가 앱일 때만 준다(project·자리 없음은 범위 밖).
    ...(placeKind === "app" && placeId !== undefined ? { app: placeId } : {}),
  } as AuthorizationTarget);
}

// 목차 자르기. outline route(문서·설치 안내)가 같이 쓴다. depth 아래 section만 남기고
// 예산 안에서 position 순으로 담는다. offset은 depth를 통과한 목록의 시작 위치다.
// atLeastOne이면 첫 항목이 예산보다 커도 하나는 담아 이어 읽기가 멈추지 않게 한다.
export type CuttableSection = {
  key: string;
  parent: string | null;
  level: number;
  characters: number;
  title: string;
  hidden_children_count: number;
};

export function cutOutline<S extends CuttableSection>(
  sections: readonly S[],
  depth: number,
  budget: number,
  options: { offset?: number; atLeastOne?: boolean } = {},
): { entries: S[]; complete: boolean } {
  const visible = sections.filter((section) => section.level <= depth);
  const entries: S[] = [];
  let used = 0;
  let complete = true;
  for (const section of visible.slice(options.offset ?? 0)) {
    const cost = estimatedTokens(section.characters + section.title.length);
    if (
      used + cost > budget &&
      (options.atLeastOne !== true || entries.length > 0)
    ) {
      complete = false;
      break;
    }
    used += cost;
    entries.push(section);
  }
  for (const section of entries) {
    section.hidden_children_count = hiddenBelow(sections, section, depth);
  }
  return { entries, complete };
}

// depth 아래로 숨은 자식 수. 직접 자식 중 depth를 넘는 것만 센다(계약: hidden_children_count는
// children_count를 넘지 않는다). 손자 이하는 그 자식 아래에 숨으므로 세지 않는다.
function hiddenBelow(
  sections: readonly CuttableSection[],
  section: CuttableSection,
  depth: number,
): number {
  let count = 0;
  for (const other of sections) {
    if (other.parent === section.key && other.level > depth) count += 1;
  }
  return count;
}

// 읽을 줄 번호. section 범위(section 선택이 없으면 null)와 줄 범위를 합치고, 아무
// 선택도 없으면 전체 본문이다. section 범위가 비어 있으면 읽을 줄이 없다. 1-based
// 줄 번호 오름차순이다.
export function selectBodyLines(
  spans: readonly { start_line: number; end_line: number }[] | null,
  ranges: readonly { start_line: number; end_line: number }[],
  totalLines: number,
): number[] {
  const selected = new Set<number>();
  const push = (start: number, end: number): void => {
    for (let line = start; line <= end; line++) selected.add(line);
  };
  for (const span of spans ?? []) push(span.start_line, span.end_line);
  for (const range of ranges) push(range.start_line, range.end_line);
  if (spans === null && ranges.length === 0) push(1, totalLines);
  return [...selected].sort((a, b) => a - b);
}

// 추출 상태가 section 읽기를 막을 때의 답. 읽을 수 있으면 null이다(R22).
export function sectionStatusOf(
  status: { status: string; failure_reason: string | null },
): { status: string; failure_reason: string | null } | null {
  if (status.status === "unsupported") {
    return { status: "unsupported", failure_reason: null };
  }
  if (status.status === "failed") {
    return {
      status: "unverified",
      failure_reason: status.failure_reason ?? "extraction failed",
    };
  }
  return null;
}

export type TextWindowInput = {
  lines: readonly string[];
  selected: readonly number[];
  // cursor가 묶는 기준. 판·module·선택·원문 hash가 바뀌면 이어 읽지 않는다(R8, R9).
  binding: {
    ver: string;
    module_hash: string;
    section: string | null;
    include_children: boolean;
    ranges: readonly { start_line: number; end_line: number }[];
    text_hash: string | null;
  };
  cursor?: string;
  budget: number;
  redactor?: (
    source: { concern: string; revision: string; scope: string },
    mediaType: string,
    text: string,
  ) => string | null;
  redactionSource: { concern: string; revision: string; scope: string };
};

export type TextWindow = {
  ranges: { start_line: number; end_line: number }[];
  text: string | null;
  redacted: boolean;
  omission_reason: string | null;
  complete: boolean;
  next_cursor: string | null;
};

// 본문 한 조각. codepoint 예산 안에서 자르고 cursor로 이어 읽는다. 출력 redaction은
// 안전화를 끝내지 못하면 본문을 싣지 않는다(fail-closed). 없는 redactor는 그대로다.
export function readTextWindow(input: TextWindowInput): Result<TextWindow> {
  const { binding } = input;
  const from = input.cursor === undefined
    ? ok({ line: 1, codepoint: 0 })
    : decodeBodyCursor(input.cursor, binding);
  if (!from.ok) return from;
  const chunk = bodyChunk(
    input.lines,
    input.selected,
    from.value,
    input.budget,
  );
  let text: string | null = chunk.text;
  let redacted = false;
  let omissionReason: string | null = null;
  if (input.redactor !== undefined) {
    const safe = input.redactor(
      input.redactionSource,
      "text/plain",
      chunk.text,
    );
    if (safe === null) {
      text = null;
      redacted = true;
      omissionReason = "redaction_failed";
    } else {
      text = safe;
      redacted = safe !== chunk.text;
    }
  }
  return ok({
    ranges: chunk.ranges,
    text,
    redacted,
    omission_reason: omissionReason,
    complete: chunk.complete,
    next_cursor: chunk.complete ? null : encodeBodyCursor({
      ver: binding.ver,
      module_hash: binding.module_hash,
      section: binding.section,
      include_children: binding.include_children,
      ranges: [...binding.ranges],
      line: chunk.position.line,
      codepoint: chunk.position.codepoint,
      text_hash: binding.text_hash,
    }),
  });
}

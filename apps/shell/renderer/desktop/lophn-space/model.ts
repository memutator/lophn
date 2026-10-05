// lophn 공간의 순수 규칙. 화면 컴포넌트와 core 통로가 같이 쓴다.
import type {
  Catalog,
  Coverage,
  PlaceRef,
  SearchConditions,
  ViewFilter,
} from "./source.ts";

/** lophn 공간의 일곱 형제. 중간 계층이 없다(desktop#R28). */
export const LOPHN_SCREENS = [
  "projects",
  "documents",
  "contexts",
  "apps",
  "things-to-confirm",
  "roles",
  "settings",
] as const;

export type LophnScreen = typeof LOPHN_SCREENS[number];

/** lophn 공간에 들어오면 문서 탐색이 먼저다(desktop#R1). */
export const DEFAULT_SCREEN: LophnScreen = "documents";

export const EMPTY_CONDITIONS: SearchConditions = {
  query: "",
  place: null,
  context: null,
  format: null,
  includeArchived: false,
};

const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * `<prefix>_<ULID>` id. 앞 10자는 시각, 뒤 16자는 무작위다. 시각과 무작위는 테스트가
 * 고정한다.
 */
export function newId(
  prefix: string,
  now: number = Date.now(),
  random: (size: number) => Uint8Array = (size) =>
    crypto.getRandomValues(new Uint8Array(size)),
): string {
  let time = "";
  let rest = Math.max(0, Math.floor(now));
  for (let index = 0; index < 10; index += 1) {
    time = CROCKFORD[rest % 32]! + time;
    rest = Math.floor(rest / 32);
  }
  const bytes = random(16);
  let tail = "";
  for (let index = 0; index < 16; index += 1) {
    tail += CROCKFORD[(bytes[index] ?? 0) % 32]!;
  }
  return `${prefix}_${time}${tail}`;
}

/** 조건에서 search.query 입력을 만든다. 빈 조건은 보내지 않는다. */
export function searchBody(
  conditions: SearchConditions,
  cursor?: string,
): Record<string, unknown> {
  return {
    query: conditions.query.trim(),
    ...(conditions.place === null ? {} : { place: conditions.place }),
    ...(conditions.context === null ? {} : { context: conditions.context }),
    ...(conditions.format === null ? {} : { formats: [conditions.format] }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

/** 지금 조건을 saved view 조건으로 옮긴다. 보관 포함이면 all이다. */
export function viewFilterOf(conditions: SearchConditions): ViewFilter {
  const query = conditions.query.trim();
  return {
    text: query === "" ? null : query,
    context: conditions.context,
    format: conditions.format,
    status: conditions.includeArchived ? "all" : "active",
  };
}

/** saved view에 저장한 조건을 검색 칸으로 되돌린다. */
export function conditionsOfView(
  place: PlaceRef | null,
  filter: ViewFilter,
): SearchConditions {
  return {
    query: filter.text ?? "",
    place,
    context: filter.context,
    format: filter.format,
    includeArchived: filter.status !== "active",
  };
}

export type CoverageNote = "lagging" | "rebuilding" | "omissions";

/**
 * 결과 판단에 필요한 지연·누락만 고른다(outline-and-search#R14). 재생성 중이면
 * 지연은 따로 말하지 않는다.
 */
export function coverageNotes(coverage: Coverage | null): CoverageNote[] {
  if (coverage === null) return [];
  const notes: CoverageNote[] = [];
  if (coverage.rebuilding) notes.push("rebuilding");
  else if (coverage.lagging) notes.push("lagging");
  if (coverage.omissions > 0) notes.push("omissions");
  return notes;
}

/**
 * 빈 검색의 안내. 지연·누락이 있으면 아직 반영되지 않았다고 하고, 보관을 빼고
 * 찾았으면 보관 포함을 권한다. 어느 쪽도 원본이 없다는 뜻으로 말하지 않는다.
 */
export function emptyHint(
  coverage: Coverage | null,
  includeArchived: boolean,
): "not-yet" | "archived" | "conditions" {
  if (coverageNotes(coverage).length > 0) return "not-yet";
  return includeArchived ? "conditions" : "archived";
}

export function samePlace(a: PlaceRef | null, b: PlaceRef | null): boolean {
  return a === b || (a !== null && b !== null && a.kind === b.kind &&
    a.id === b.id);
}

/** 자리 선택지 값. Select는 문자열만 받는다. */
export function placeValue(place: PlaceRef | null): string {
  return place === null ? "" : `${place.kind}:${place.id}`;
}

export function placeOf(value: string): PlaceRef | null {
  const match = /^(project|app):(.+)$/.exec(value);
  return match ? { kind: match[1] as PlaceRef["kind"], id: match[2]! } : null;
}

export function placeTitle(catalog: Catalog, place: PlaceRef): string | null {
  const list = place.kind === "project" ? catalog.projects : catalog.apps;
  return list.find((item) => item.id === place.id)?.title ?? null;
}

/** 판이 최신이 아니면 최신 판을 따로 보인다(outline-and-search#R8). */
export function isLatest(version: string, latestVersion: string): boolean {
  return version === latestVersion;
}

// contracts/documents/series-values.ts의 NEXT_RULE과 같다. 등록 전에 사람에게 바로 알린다.
const NEXT_RULE =
  /^[^{}]*\{(n|major|minor|patch)(?:([+-])(\d+))?(?::(0?[1-4]))?\}$/;

/** 지원하는 다음 이름 규칙인지. 5자리 이상 0 채움은 받지 않는다. */
export function validNextRule(rule: string): boolean {
  return NEXT_RULE.test(rule.trim());
}

const SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** 가족 이름은 문서 이름과 같은 slug다. */
export function validSeriesName(name: string): boolean {
  return SLUG.test(name);
}

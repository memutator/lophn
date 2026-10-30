// 최근 연 place(project·app) 목록. 창이 아니라 이 Mac의 shell 상태라 localStorage에 둔다
// (sidebar/hidden-recent.ts와 같은 자리). core에 표를 두지 않는 까닭: 최근에 연 것은 그 Mac에서만
// 뜻이 있고 다른 기기와 맞출 값이 아니다.
const KEY = "lophn.places.recent";
/** 목록에 남기는 개수. 최근 것부터 이만큼만 보인다. */
const MAX = 5;

export interface PlaceRef {
  readonly kind: "project" | "app";
  /** prj_… 또는 app_… */
  readonly id: string;
}

function isPlace(value: unknown): value is PlaceRef {
  if (typeof value !== "object" || value === null) return false;
  const { kind, id } = value as { kind?: unknown; id?: unknown };
  return (
    (kind === "project" || kind === "app") &&
    typeof id === "string" &&
    id.length > 0
  );
}

/** 최근 것부터. 저장한 값이 깨졌으면 빈 목록이다. */
export function readRecentPlaces(): readonly PlaceRef[] {
  try {
    const parsed: unknown = JSON.parse(
      globalThis.localStorage?.getItem(KEY) ?? "[]",
    );
    return Array.isArray(parsed) ? parsed.filter(isPlace).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** place를 맨 앞으로 올린다. 같은 place는 하나만 남는다. */
export function rememberPlace(place: PlaceRef): void {
  const next = [
    place,
    ...readRecentPlaces().filter(
      (item) => item.kind !== place.kind || item.id !== place.id,
    ),
  ].slice(0, MAX);
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    // 저장을 못 해도 화면은 그대로다. 다음에 열 때 최근 목록이 비어 보일 뿐이다.
  }
}

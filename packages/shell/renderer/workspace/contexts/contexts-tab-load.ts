// Contexts 탭이 열 때 읽는 값. 보관하지 않은 context마다 카드 하나(종류·판 이력)와 보관한 context 목록이다.
// 목록이나 판 이력을 읽지 못하면 null이다(화면은 다시 읽기를 보인다). 종류는 색인(context worker)이
// 따로 답하므로 안 오면 카드는 그 줄만 빼고 보인다.
import type { ContextListItem, ContextsSource } from "./source.ts";

type VersionCheck = "passed" | "checking" | "failed";

export interface CardData {
  readonly item: ContextListItem;
  /** 개체 종류 이름. 순서는 계약의 type 순서다. 색인이 답하지 않으면 비어 있다. */
  readonly kinds: readonly string[];
  /** 적용된 판의 검사 결과. 적용된 판이 없으면 null. */
  readonly version: VersionCheck | null;
}

interface ContextsRead {
  readonly cards: readonly CardData[];
  readonly archived: readonly ContextListItem[];
}

export async function loadContexts(
  source: ContextsSource,
  project: string,
): Promise<ContextsRead | null> {
  const [list, archived] = await Promise.all([
    source.list(project),
    source.archived(project),
  ]);
  if (!list.ok || !archived.ok) return null;
  const cards = await Promise.all(
    list.value.map((item) => loadCard(source, item)),
  );
  return cards.includes(null)
    ? null
    : { cards: cards as CardData[], archived: archived.value };
}

async function loadCard(
  source: ContextsSource,
  item: ContextListItem,
): Promise<CardData | null> {
  const [overview, bundles] = await Promise.all([
    source.overview(item.id),
    source.bundles(item.id),
  ]);
  if (!bundles.ok) return null;
  const applied = bundles.value.find((entry) =>
    entry.bundle.id === item.applied_bundle
  );
  const status = applied?.check?.status;
  return {
    item,
    kinds: overview.ok ? overview.value.types.map((entry) => entry.type) : [],
    version: item.applied_number === null
      ? null
      : status === "running"
      ? "checking"
      : status === "failed"
      ? "failed"
      : "passed",
  };
}

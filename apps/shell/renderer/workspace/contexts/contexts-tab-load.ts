// Contexts 탭이 카드마다 읽는 값(shell/workspace#R16). 목록 하나와 context마다 종류·판 이력·
// Operator 수를 함께 읽는다. 목록이나 판 이력을 읽지 못하면 null이다(화면은 다시 읽기를 보인다).
// 종류는 색인(context worker)이, Operator 수는 agents가 따로 답하므로 그 둘이 안 오면 카드는
// 그 줄만 빼고 보인다.
import type { ContextListItem, ContextsSource } from "./source.ts";

export type VersionCheck = "passed" | "checking" | "failed";

export interface CardData {
  readonly item: ContextListItem;
  /** 개체 종류 이름. 순서는 계약의 type 순서다. 색인이 답하지 않으면 비어 있다. */
  readonly kinds: readonly string[];
  /** 적용된 판의 검사 결과. 적용된 판이 없으면 null. */
  readonly version: VersionCheck | null;
  /** 쓰는 Operator 수. 읽지 못했으면 null이고 카드는 그 줄을 보이지 않는다. */
  readonly operators: number | null;
}

export async function loadCards(
  source: ContextsSource,
  project: string,
): Promise<readonly CardData[] | null> {
  const list = await source.list(project);
  if (!list.ok) return null;
  // Operator는 project마다 한 번만 읽고 context별 수로 센다.
  if (list.value.length === 0) return [];
  const operators = await source.operatorCounts(project);
  const cards = await Promise.all(
    list.value.map((item) => loadCard(source, item, operators)),
  );
  return cards.includes(null) ? null : cards as CardData[];
}

async function loadCard(
  source: ContextsSource,
  item: ContextListItem,
  operators: Awaited<ReturnType<ContextsSource["operatorCounts"]>>,
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
    operators: operators.ok ? operators.value.get(item.id) ?? 0 : null,
  };
}

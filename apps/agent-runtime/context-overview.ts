// context 자료(lophn-agent/harness/prompt-assemble#R4, R5, presets#R17)다. 선택한 context마다 overview(type·뜻·
// 개수, type 사이 관계)와 용어집을 core 읽기로 모아 prompt 자료 글로 만든다. 선택 중 `assignment_scope`·
// `work_place`는 호출하는 쪽이 풀어서 `all`·`project`로 넘긴다(ctx-I58b).
import {
  contextContractRoute,
  contextGetRoute,
  contextListRoute,
  contextOverviewRoute,
  type Contract,
  glossaryListRoute,
} from "../../packages/contracts/documents/mod.ts";
import type { CoreCall } from "./core-call.ts";
import { readOf } from "./core-call.ts";

export type ContextMaterialInput = {
  context: { id: string; title: string };
  // 적용된 판의 hash. 자료의 cache key이며 본문에는 쓰지 않는다.
  bundle_hash: string;
  // 적용된 판의 계약(`context.contract`의 content.contract).
  contract: Contract;
  // run을 시작할 때 센 type별 개체 수(`context.overview`의 types). 빠진 type은 0이다.
  counts: readonly { type: string; count: number }[];
  // `glossary.list`가 준 순서 그대로.
  glossary: readonly { term: string; meaning: string }[];
};

const CARDINALITY_WORD = {
  one: "하나",
  optional: "없거나 하나",
  many: "여럿",
} as const;

export type ContextMaterialParts = {
  head: string;
  // `type:`과 `관계:` 줄. 용어집은 없다.
  overview: string;
  // `용어집:` 줄. 없으면 `용어집: 없음`이다.
  glossary: string;
  // overview를 다 줄여도 남기는 type 이름(계약 순서).
  type_names: readonly string[];
  // 용어집 항목이 하나도 없다.
  glossary_empty: boolean;
};

export function renderContextParts(
  input: ContextMaterialInput,
): ContextMaterialParts {
  const counted = new Map(input.counts.map((item) => [item.type, item.count]));
  const types = input.contract.types;
  const lines = ["type:"];
  for (const type of types) {
    lines.push(
      `- ${type.name}: ${type.summary} (${counted.get(type.name) ?? 0}개)`,
    );
  }
  const relations = types.flatMap((type) =>
    type.relations.map((relation) =>
      `- ${type.name} → ${relation.to}, ${
        CARDINALITY_WORD[relation.cardinality]
      }: ${relation.label}`
    )
  );
  if (relations.length === 0) lines.push("관계: 없음");
  else lines.push("관계:", ...relations);
  const glossary = input.glossary.length === 0
    ? "용어집: 없음"
    : ["용어집:", ...input.glossary.map((e) => `- ${e.term}: ${e.meaning}`)]
      .join("\n");
  return {
    head: `[context] ${input.context.title} | ${input.context.id}`,
    overview: lines.join("\n"),
    glossary,
    type_names: types.map((type) => type.name),
    glossary_empty: input.glossary.length === 0,
  };
}

// 머리 한 줄 `[context] <이름> | <id>` 다음에 overview(type·뜻·개수, 관계)와 용어집. 순수 함수이고 같은
// 입력은 같은 byte다. 검색 결과·개체 field·문서 본문·관점·변경됨 표시는 없다.
export function renderContextMaterial(input: ContextMaterialInput): string {
  const parts = renderContextParts(input);
  return [parts.head, parts.overview, parts.glossary].join("\n");
}

export type ContextMaterial = {
  context: string;
  title: string;
  bundle_hash: string;
  text: string;
  // prompt 축소(prompt-assemble R18)가 단계별로 쓰는 조각이다. `text`는 머리와 이 조각의 합이다.
  overview: string;
  glossary: string;
  type_names: readonly string[];
  glossary_empty: boolean;
};

export type ContextMaterialSelection = { kind: string; target: string | null };

export type ContextMaterialSet = {
  // 중복 없이, 선택 순서 다음 `context.list` 순서(제목, id)로.
  materials: readonly ContextMaterial[];
  // 자료가 0개인 이유(project가 정해지지 않음). 자료가 있으면 null이다.
  reason: string | null;
};

const NO_PROJECT_REASON =
  "project가 정해지지 않아 context 자료를 싣지 않았다. project를 정하면 다음 run부터 싣는다.";

// 한 context의 자료를 읽는다. 적용된 판이 없거나 읽을 수 없거나 active가 아니면 null이다(조용히 뺀다).
async function loadOne(
  agent: CoreCall,
  context: string,
): Promise<ContextMaterial | null> {
  const got = await readOf(agent, contextGetRoute, { context });
  if (!got.ok || got.value.context.status !== "active") return null;
  const [contract, overview, glossary] = await Promise.all([
    readOf(agent, contextContractRoute, { context }),
    readOf(agent, contextOverviewRoute, { context }),
    readOf(agent, glossaryListRoute, { context }),
  ]);
  if (!contract.ok || !overview.ok || !glossary.ok) return null;
  const hash = contract.value.bundle_hash;
  const content = contract.value.content;
  if (hash === null || content === null) return null;
  // 개수는 판과 같은 시점에 읽은 것만 쓴다. 두 읽기가 다른 판을 가리키면 섞지 않고 뺀다.
  if (overview.value.bundle_hash !== hash) return null;
  const input: ContextMaterialInput = {
    context: { id: context, title: got.value.context.title },
    bundle_hash: hash,
    contract: content.contract,
    counts: overview.value.types,
    glossary: glossary.value.entries,
  };
  const parts = renderContextParts(input);
  return {
    context,
    title: input.context.title,
    bundle_hash: hash,
    text: [parts.head, parts.overview, parts.glossary].join("\n"),
    overview: parts.overview,
    glossary: parts.glossary,
    type_names: parts.type_names,
    glossary_empty: parts.glossary_empty,
  };
}

// project의 active context id들. `context.list` 순서(제목, id)다.
async function activeContexts(
  agent: CoreCall,
  project: string,
): Promise<string[]> {
  const found: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await readOf(agent, contextListRoute, {
      project,
      status: "active",
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!page.ok) return found;
    for (const item of page.value.contexts) {
      if (item.status === "active") found.push(item.id);
    }
    if (page.value.next_cursor === null) return found;
    cursor = page.value.next_cursor;
  }
}

// run을 시작할 때 한 번 읽는다. `all`·`project` 선택은 그 project의 active context들로 풀리고
// (`context` 선택은 그 context 하나) 보관·초안 context, 읽을 수 없는 context, 적용된 판이 없는 context는
// 조용히 뺀다. 읽기만 한다(`context.list|get|contract|overview`, `glossary.list`).
export async function loadContextMaterials(
  agent: CoreCall,
  input: {
    // 세션 작업 자리 또는 담당 범위의 project. 정해지지 않았으면 null이다.
    project: string | null;
    selections: readonly ContextMaterialSelection[];
  },
): Promise<ContextMaterialSet> {
  const wanted: string[] = [];
  let missingProject = false;
  for (const selection of input.selections) {
    if (selection.kind === "context" && selection.target !== null) {
      wanted.push(selection.target);
    } else if (selection.kind === "project" && selection.target !== null) {
      wanted.push(...await activeContexts(agent, selection.target));
    } else if (selection.kind === "all") {
      if (input.project === null) missingProject = true;
      else wanted.push(...await activeContexts(agent, input.project));
    }
  }
  const materials: ContextMaterial[] = [];
  for (const context of new Set(wanted)) {
    const material = await loadOne(agent, context);
    if (material !== null) materials.push(material);
  }
  return {
    materials,
    reason: materials.length === 0 && missingProject ? NO_PROJECT_REASON : null,
  };
}

// context 자료(lophn-agent/harness/prompt-assemble#R4, R5, presets#R17)다. 선택한 context마다 overview(type·뜻·
// 개수, type 사이 관계)와 용어집을 core 읽기로 모아 prompt 자료 글로 만든다. 선택 중 `assignment_scope`·
// `work_place`는 `resolveContextSelections`가 풀어서 `all`·`project`로 넘긴다(ctx-I58b).
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
import type { ContextToolPin } from "./context-search.ts";

export type ContextMaterialInput = {
  context: { id: string; title: string };
  // 적용된 판의 hash. 자료의 cache key이며 본문에는 쓰지 않는다.
  bundle_hash: string;
  // 적용된 판의 계약(`context.contract`의 content.contract).
  contract: Contract;
  // run을 시작할 때 센 type별 개체 수(`context.overview`의 types). 빠진 type은 0이다. null이면 센 값이
  // 이 판의 것이 아니라서(고정한 판이 더는 적용되어 있지 않다) 개수를 싣지 않는다.
  counts: readonly { type: string; count: number }[] | null;
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
  const counted = new Map(
    (input.counts ?? []).map((item) => [item.type, item.count]),
  );
  const types = input.contract.types;
  const lines = ["type:"];
  for (const type of types) {
    lines.push(
      input.counts === null
        ? `- ${type.name}: ${type.summary}`
        : `- ${type.name}: ${type.summary} (${counted.get(type.name) ?? 0}개)`,
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

// preset의 context 선택 중 `work_place`·`assignment_scope`를 loadContextMaterials가 읽는 선택으로 푼다
// (presets: `work_place`는 세션 작업 자리, `assignment_scope`는 담당 범위에서 resolve한다).
// - `work_place`: 작업 자리가 project면 그 project, 아니면 자료가 없다.
// - `assignment_scope`: 담당 범위가 project면 그 project다. 담당 범위가 앱(App Engineer)이면 작업 자리와
//   상관없이 그 앱을 app-data source로 읽는 active context들(`app_readers`)이다(`context.list`의 app
//   거르기, roles/app-engineer#R2). preset 자신의 `app` 선택은 context가 아니다. 그 밖의 담당 범위는 작업 자리의 project 안에서 `all`로 읽는다.
// 다른 선택은 그대로 둔다.
export function resolveContextSelections(
  selections: readonly ContextMaterialSelection[],
  input: {
    place: { kind: string; id: string | null };
    scope: { kind: string; id: string | null };
  },
): ContextMaterialSelection[] {
  const resolved: ContextMaterialSelection[] = [];
  for (const selection of selections) {
    if (selection.kind === "work_place") {
      if (input.place.kind === "project" && input.place.id !== null) {
        resolved.push({ kind: "project", target: input.place.id });
      }
    } else if (selection.kind === "assignment_scope") {
      resolved.push(
        input.scope.kind === "project" && input.scope.id !== null
          ? { kind: "project", target: input.scope.id }
          : input.scope.kind === "app" && input.scope.id !== null
          ? { kind: "app_readers", target: input.scope.id }
          : { kind: "all", target: null },
      );
    } else {
      resolved.push(selection);
    }
  }
  return resolved;
}

export type ContextMaterialSet = {
  // 중복 없이, 선택 순서 다음 `context.list` 순서(제목, id)로.
  materials: readonly ContextMaterial[];
  // 자료가 0개인 이유(project가 정해지지 않음). 자료가 있으면 null이다.
  reason: string | null;
  // 고른 context인데 읽지 못해 자료에 싣지 못한 것과 그 이유. 보관·초안 context와 적용된 판이 없는 context는
  // 읽지 못한 것이 아니라서 들지 않는다.
  omitted: readonly ContextMaterialOmission[];
};

// 읽지 못한 context 하나. `title`은 이름을 읽었으면 그 이름, 아니면 id다.
export type ContextMaterialOmission = {
  context: string;
  title: string;
  reason: string;
};

const NO_PROJECT_REASON =
  "project가 정해지지 않아 context 자료를 싣지 않았다. project를 정하면 다음 run부터 싣는다.";

// 한 context의 자료를 읽는다. active가 아니거나 적용된 판이 없으면 null이다(조용히 뺀다). 읽지 못한 것은
// `omission`으로 이유를 돌려준다.
// `pin`이 있으면(resume) 지금 적용된 판이 아니라 run이 시작할 때 고정한 판의 계약으로 만든다. 읽은 판의
// hash가 pin과 다르면 뺀다(fail closed). 개수는 적용된 판의 index에서 읽으므로 고정한 판이 더는 적용되어
// 있지 않으면 싣지 않는다.
type Loaded =
  | { kind: "material"; material: ContextMaterial }
  | { kind: "omitted"; omission: ContextMaterialOmission }
  | { kind: "none" };

async function loadOne(
  agent: CoreCall,
  context: string,
  pin?: ContextToolPin,
): Promise<Loaded> {
  const none: Loaded = { kind: "none" };
  const failed = (title: string, reason: string): Loaded => ({
    kind: "omitted",
    omission: { context, title, reason },
  });
  const got = await readOf(agent, contextGetRoute, { context });
  if (!got.ok) return failed(context, `읽지 못했다(${got.error.code})`);
  if (got.value.context.status !== "active") return none;
  const title = pin?.title ?? got.value.context.title;
  const [contract, overview, glossary] = await Promise.all([
    readOf(agent, contextContractRoute, {
      context,
      ...(pin === undefined ? {} : { bundle: pin.bundle }),
    }),
    readOf(agent, contextOverviewRoute, { context }),
    readOf(agent, glossaryListRoute, { context }),
  ]);
  if (!contract.ok) {
    return failed(title, `계약을 읽지 못했다(${contract.error.code})`);
  }
  if (!glossary.ok) {
    return failed(title, `용어집을 읽지 못했다(${glossary.error.code})`);
  }
  const hash = contract.value.bundle_hash;
  const content = contract.value.content;
  if (hash === null || content === null) return none;
  if (pin !== undefined && hash !== pin.bundle_hash) {
    return failed(title, "run이 시작할 때 고정한 판과 읽은 판이 다르다");
  }
  // 개수는 판과 같은 시점에 읽은 것만 쓴다. 두 읽기가 다른 판을 가리키면 섞지 않고 뺀다(고정한 판은 개수만 뺀다).
  let counts: ContextMaterialInput["counts"] = null;
  if (overview.ok && overview.value.bundle_hash === hash) {
    counts = overview.value.types;
  } else if (pin === undefined) {
    return failed(title, "계약과 개수가 서로 다른 판을 가리켜 싣지 못했다");
  }
  const input: ContextMaterialInput = {
    context: { id: context, title },
    bundle_hash: hash,
    contract: content.contract,
    counts,
    glossary: glossary.value.entries,
  };
  const parts = renderContextParts(input);
  return {
    kind: "material",
    material: {
      context,
      title: input.context.title,
      bundle_hash: hash,
      text: [parts.head, parts.overview, parts.glossary].join("\n"),
      overview: parts.overview,
      glossary: parts.glossary,
      type_names: parts.type_names,
      glossary_empty: parts.glossary_empty,
    },
  };
}

// project 또는 app의 active context id들. `context.list` 순서(제목, id)다.
async function activeContexts(
  agent: CoreCall,
  filter: { project: string } | { app: string },
): Promise<string[]> {
  const found: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await readOf(agent, contextListRoute, {
      ...filter,
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
// (`context` 선택은 그 context 하나, `app_readers` 선택은 그 앱을 읽는 active context들) 보관·초안 context, 읽을 수
// 없는 context, 적용된 판이 없는 context는 조용히 뺀다. 읽기만 한다(`context.list|get|contract|overview`,
// `glossary.list`). `pins`가 있으면(resume) 그 context는 고정한 판의 계약으로 만든다.
export async function loadContextMaterials(
  agent: CoreCall,
  input: {
    // 세션 작업 자리 또는 담당 범위의 project. 정해지지 않았으면 null이다.
    project: string | null;
    selections: readonly ContextMaterialSelection[];
    pins?: readonly ContextToolPin[];
  },
): Promise<ContextMaterialSet> {
  const wanted: string[] = [];
  let missingProject = false;
  for (const selection of input.selections) {
    if (selection.kind === "context" && selection.target !== null) {
      wanted.push(selection.target);
    } else if (selection.kind === "project" && selection.target !== null) {
      wanted.push(
        ...await activeContexts(agent, { project: selection.target }),
      );
    } else if (selection.kind === "app_readers" && selection.target !== null) {
      wanted.push(...await activeContexts(agent, { app: selection.target }));
    } else if (selection.kind === "all") {
      if (input.project === null) missingProject = true;
      else {
        wanted.push(...await activeContexts(agent, { project: input.project }));
      }
    }
  }
  const pinned = new Map(input.pins?.map((pin) => [pin.context, pin]));
  const materials: ContextMaterial[] = [];
  const omitted: ContextMaterialOmission[] = [];
  for (const context of new Set(wanted)) {
    const loaded = await loadOne(agent, context, pinned.get(context));
    if (loaded.kind === "material") materials.push(loaded.material);
    else if (loaded.kind === "omitted") omitted.push(loaded.omission);
  }
  return {
    materials,
    omitted,
    reason: materials.length === 0 && missingProject ? NO_PROJECT_REASON : null,
  };
}

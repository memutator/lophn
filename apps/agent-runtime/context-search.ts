import type { Result } from "../../packages/base/mod.ts";
import type { BundleContent } from "../../packages/contracts/documents/mod.ts";
import type { WorkPlace } from "../../packages/contracts/lophn-agent/mod.ts";
import {
  contextContractRoute,
  contextGetRoute,
  contextListRoute,
} from "../../packages/contracts/documents/mod.ts";
import {
  buildContextReadTools,
  type ContextReadTools,
  type ContextToolContext,
  createContextReadToolHandlers,
  type ToolHandler,
} from "../../packages/lophn-agent/harness/tools/mod.ts";
import type { ContractCall } from "../../packages/lophn-agent/harness/tools/bundles/common.ts";
import { type CoreCall, readOf } from "./core-call.ts";

// 선언 검색 tool과 개체 읽기 tool의 재료 읽기와 handler 연결이다(lophn-agent/harness/tools R21, R22).
// preset의 context 선택이 가리키는 context들의 적용된 판(`context.contract`)을 run을 시작하기 전에 한 번
// 읽어 정의를 만들고(Run.basis의 정의 hash가 이 정의를 고정한다) 호출은 run의 agent 자격으로 core의
// `context.search`·`context.entity`를 부른다.

export type ContextSelection = { kind: string; target: string | null };

// run이 정의를 만든 판의 고정이다. Run.basis의 `tools.contexts`에 실리고 resume은 이 판으로 정의를 다시 만든다
// (lophn-agent/harness/tools R21: 판이 바뀌어도 진행 중인 run은 옛 정의로 계속한다).
export type ContextToolPin = {
  context: string;
  bundle: string;
  bundle_hash: string;
  title: string;
};

// 읽은 판의 값. 정의는 이 값으로 만들고 pin은 여기서 나온다.
export type LoadedContextTool = ContextToolContext & { bundle: string };

// 특정 판의 내용을 id로 읽는 길이다. 판의 내용은 submit 뒤 바뀌지 않으므로 적용된 판이 바뀐 뒤에도 읽는다.
// 읽지 못하거나 hash가 pin과 다르면 그 context는 없는 것과 같다.
export type ContextBundleReader = (
  context: string,
  bundle: string,
) => Promise<Result<{ bundle_hash: string; content: BundleContent }>>;

export function pinOf(context: LoadedContextTool): ContextToolPin {
  return {
    context: context.id,
    bundle: context.bundle,
    bundle_hash: context.bundle_hash,
    title: context.title,
  };
}

// Run.basis에서 읽은 `tools.contexts`다. 모양이 맞지 않는 항목은 버린다(fail closed).
export function pinsOf(value: unknown): readonly ContextToolPin[] {
  if (!Array.isArray(value)) return [];
  const pins: ContextToolPin[] = [];
  for (const item of value as unknown[]) {
    const pin = item as Partial<ContextToolPin> | null;
    if (
      typeof pin?.context === "string" && typeof pin.bundle === "string" &&
      typeof pin.bundle_hash === "string" && typeof pin.title === "string"
    ) {
      pins.push({
        context: pin.context,
        bundle: pin.bundle,
        bundle_hash: pin.bundle_hash,
        title: pin.title,
      });
    }
  }
  return pins;
}

export type ContextToolInput = {
  // 세션 작업 자리 또는 담당 범위의 project. 정해지지 않았으면 null이다.
  project: string | null;
  selections: readonly ContextSelection[];
};

export type ContextToolkit = {
  // 고른 context 중 보관·초안이 아니고 읽을 수 있고 적용된 판이 있는 것만 읽는다. 읽지 못하면 그 context는
  // 없는 것과 같다(fail closed).
  load(input: ContextToolInput): Promise<readonly LoadedContextTool[]>;
  // resume: run이 시작할 때 고정한 판으로 같은 정의 재료를 다시 읽는다. 지금 적용된 판이 아니라 pin의 판이다.
  // context가 active가 아니거나 pin의 판을 읽지 못하거나 hash가 다르면 그 context는 없는 것과 같다(fail closed).
  loadPinned(
    pins: readonly ContextToolPin[],
  ): Promise<readonly LoadedContextTool[]>;
  // 이 run의 agent 자격으로 소유 contract를 부르는 handler.
  handlers(
    tools: ContextReadTools,
    agent: CoreCall,
  ): ReadonlyMap<string, ToolHandler>;
};

const LIST_PAGES = 10;
const LIST_LIMIT = 100;

// `all`·`work_place`·`assignment_scope`·`project`는 그 project의 active context들로 풀리고 `context`는 그
// context 하나다. app·document·sdk 선택은 context가 아니다.
const PROJECT_KINDS = new Set([
  "all",
  "work_place",
  "assignment_scope",
  "project",
]);

async function activeContexts(
  call: CoreCall,
  project: string,
): Promise<Result<readonly string[]>> {
  const found: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < LIST_PAGES; page++) {
    const listed = await readOf(call, contextListRoute, {
      project,
      status: "active",
      limit: LIST_LIMIT,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!listed.ok) return listed;
    for (const entry of listed.value.contexts) {
      if (entry.status === "active") found.push(entry.id);
    }
    if (listed.value.next_cursor === null) break;
    cursor = listed.value.next_cursor;
  }
  return { ok: true, value: found };
}

export function createContextToolkit(options: {
  // 정의 재료를 읽는 자격. run의 agent credential은 StartRun 뒤에야 있으므로 machine 자격이다.
  machine: CoreCall;
  // agent 자격 호출을 소유 contract 이름 하나로 부르는 통로로 바꾼다(`createContractCall`).
  contract(agent: CoreCall): ContractCall;
  // 적용된 판이 아닌 특정 판의 내용을 읽는 길. 없으면 pin의 판이 지금 적용된 판일 때만 읽는다.
  bundle?: ContextBundleReader;
}): ContextToolkit {
  const { machine } = options;

  async function contextOf(
    id: string,
    project: string | null,
  ): Promise<LoadedContextTool | null> {
    const got = await readOf(machine, contextGetRoute, { context: id });
    if (!got.ok || got.value.context.status !== "active") return null;
    // 담당 project 밖의 context는 선택이어도 읽지 않는다.
    if (project !== null && got.value.context.project !== project) return null;
    const contract = await readOf(machine, contextContractRoute, {
      context: id,
    });
    if (
      !contract.ok || contract.value.content === null ||
      contract.value.bundle_hash === null || contract.value.bundle === null
    ) return null;
    return {
      id,
      title: got.value.context.title,
      bundle: contract.value.bundle,
      bundle_hash: contract.value.bundle_hash,
      content: contract.value.content,
    };
  }

  async function pinnedOf(
    pin: ContextToolPin,
  ): Promise<LoadedContextTool | null> {
    const got = await readOf(machine, contextGetRoute, {
      context: pin.context,
    });
    if (!got.ok || got.value.context.status !== "active") return null;
    let found: { bundle_hash: string; content: BundleContent } | null = null;
    const current = await readOf(machine, contextContractRoute, {
      context: pin.context,
    });
    if (
      current.ok && current.value.bundle === pin.bundle &&
      current.value.bundle_hash !== null && current.value.content !== null
    ) {
      found = {
        bundle_hash: current.value.bundle_hash,
        content: current.value.content,
      };
    } else if (options.bundle !== undefined) {
      const read = await options.bundle(pin.context, pin.bundle);
      if (read.ok) found = read.value;
    }
    if (found === null || found.bundle_hash !== pin.bundle_hash) return null;
    return {
      id: pin.context,
      title: pin.title,
      bundle: pin.bundle,
      bundle_hash: pin.bundle_hash,
      content: found.content,
    };
  }

  return {
    async load(input) {
      const ids: string[] = [];
      const add = (id: string) => {
        if (!ids.includes(id)) ids.push(id);
      };
      let resolved = false;
      let projectIds: readonly string[] = [];
      for (const selection of input.selections) {
        if (selection.kind === "context" && selection.target !== null) {
          add(selection.target);
        } else if (PROJECT_KINDS.has(selection.kind)) {
          if (input.project === null) continue;
          if (!resolved) {
            resolved = true;
            const listed = await activeContexts(machine, input.project);
            projectIds = listed.ok ? listed.value : [];
          }
          for (const id of projectIds) add(id);
        }
      }
      const loaded: LoadedContextTool[] = [];
      for (const id of ids) {
        const context = await contextOf(id, input.project);
        if (context !== null) loaded.push(context);
      }
      return loaded;
    },
    async loadPinned(pins) {
      const loaded: LoadedContextTool[] = [];
      const seen = new Set<string>();
      for (const pin of pins) {
        if (seen.has(pin.context)) continue;
        seen.add(pin.context);
        const context = await pinnedOf(pin);
        if (context !== null) loaded.push(context);
      }
      return loaded;
    },
    handlers: (tools, agent) =>
      createContextReadToolHandlers(tools, options.contract(agent)),
  };
}

// context 자료의 project다. 세션 작업 자리가 project이면 그것이고 아니면 담당 범위가 project일 때 그것이다.
// 담당 범위가 다른 project이면 작업 자리가 담당 범위를 넓히지 못하므로 정해지지 않은 것과 같다.
export function projectOf(
  place: WorkPlace,
  scope: { kind: string; id: string | null },
): string | null {
  const assigned = scope.kind === "project" ? scope.id : null;
  if (place.kind === "project") {
    return assigned === null || assigned === place.id ? place.id : null;
  }
  return assigned;
}

// 이 run이 제공할 선언 검색 tool과 개체 읽기 tool이다. `pinned`가 있으면(resume) 선택이 아니라 run이 시작할 때
// 고정한 판으로 만든다. 정의를 만든 판은 `pins`로 돌려주고 Run.basis가 싣는다. 역할 상한은 개체 읽기 이름이 정하고(역할 상한
// 표·preset 선택) 여기서는 preset의 context 선택이 가리키는 context만 정의가 된다. 도구 묶음이 없으면
// 하나도 없다.
export async function contextReadToolsFor(
  kit: ContextToolkit | undefined,
  input: {
    place: WorkPlace;
    scope: { kind: string; id: string | null };
    selections: readonly ContextSelection[];
    pinned?: readonly ContextToolPin[];
  },
): Promise<ContextReadTools & { pins: readonly ContextToolPin[] }> {
  if (kit === undefined) {
    return { search: [], entity: null, contexts: [], pins: [] };
  }
  const selected = input.pinned !== undefined
    ? await kit.loadPinned(input.pinned)
    : await kit.load({
      project: projectOf(input.place, input.scope),
      selections: input.selections,
    });
  const tools = await buildContextReadTools({ selected, allowed: null });
  return {
    ...tools,
    pins: selected.filter((c) => tools.contexts.includes(c.id)).map(pinOf),
  };
}

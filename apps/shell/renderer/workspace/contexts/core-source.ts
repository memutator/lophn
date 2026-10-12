// Context 화면들의 ContextsSource를 제품 core로 잇는다(shell/workspace#R16~R29). token·port는
// main에 있고 이 쪽은 route 이름과 입력만 보낸다. 응답은 main의 contract client가 route output
// schema로 이미 검사했으므로 화면이 읽는 field만 골라 source 모양으로 옮긴다. 실패는 core의 오류
// code(`not_found`, `conflict`, `unavailable`…)를 message로 돌려준다. 색인(context worker)이 안 떠
// 있으면 search·overview·input_options는 `unavailable`이고 화면은 그 상태를 보인다.
import type { CoreSource } from "../../desktop/connection/connection.ts";
import type { ReadResult } from "../source.ts";
import type {
  BaseRevision,
  BundleEntry,
  CommandResult,
  ContainingContext,
  ContextContract,
  ContextDetail,
  ContextDraft,
  ContextListItem,
  ContextOverview,
  ContextsSource,
  GlossaryEntry,
  InputOptions,
  SavedViewListItem,
  SearchPage,
  ViolationsPage,
} from "./source.ts";

/** 목록을 끝까지 모을 때 page 상한. 넘으면 모은 것까지만 보인다(complete가 false). */
const PAGE_LIMIT = 20;
/** context 읽기의 page 크기 상한(CONTEXT_PAGE_MAX). */
const PAGE_SIZE = 100;

interface Page {
  readonly next_cursor: string | null;
}

/** core 오류를 화면이 보는 실패로. message는 오류 code다. */
function failure(
  reply: { readonly error?: { readonly code: string } },
): { ok: false; message: string } {
  return { ok: false, message: reply.error?.code ?? "internal" };
}

export function coreContextsSource(core: CoreSource): ContextsSource {
  const read = async <V>(
    resource: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<ReadResult<V>> => {
    let reply;
    try {
      reply = await core.call({ kind: "read", resource, method, body });
    } catch {
      return { ok: false, message: "unavailable" };
    }
    return reply.ok ? { ok: true, value: reply.value as V } : failure(reply);
  };

  const command = async <V>(
    resource: string,
    method: string,
    input: unknown,
    compare: Record<string, unknown> = {},
  ): Promise<CommandResult<V>> => {
    let reply;
    try {
      reply = await core.call({
        kind: "command",
        resource,
        method,
        body: {
          input,
          idempotency_key: `${resource}-${method}-${crypto.randomUUID()}`,
          compare,
          prepared: [],
        },
      });
    } catch {
      return { ok: false, message: "unavailable" };
    }
    return reply.ok ? { ok: true, value: reply.value as V } : failure(reply);
  };

  /** cursor를 따라 끝까지(또는 PAGE_LIMIT까지) 모은다. */
  const collect = async <V extends Page, T>(
    method: string,
    body: Record<string, unknown>,
    items: (value: V) => readonly T[],
  ): Promise<ReadResult<{ items: T[]; next: string | null }>> => {
    const all: T[] = [];
    let cursor: string | undefined;
    for (let index = 0; index < PAGE_LIMIT; index += 1) {
      const result = await read<V>(
        "contexts",
        method,
        cursor === undefined
          ? { ...body, limit: PAGE_SIZE }
          : { ...body, limit: PAGE_SIZE, cursor },
      );
      if (!result.ok) return result;
      all.push(...items(result.value));
      cursor = result.value.next_cursor ?? undefined;
      if (cursor === undefined) {
        return { ok: true, value: { items: all, next: null } };
      }
    }
    return { ok: true, value: { items: all, next: cursor ?? null } };
  };

  // 이 context를 정의 `contexts`에 고른 Operator의 수다(lophn-agent/agents). context는 project 안에만 있고
  // Operator의 정의도 그 project 자리의 파일이라, 그 project의 Operator를 읽어 센다.
  const countOperators = async (
    context: string,
  ): Promise<ReadResult<number>> => {
    const found = await read<{ context: { project: string } }>(
      "contexts",
      "get",
      { context },
    );
    if (!found.ok) return found;
    const place = { kind: "project", id: found.value.context.project };
    const listed = await read<
      { agents: readonly { assignment: string; kind: string }[] }
    >("agents", "list", { place });
    if (!listed.ok) return listed;
    let count = 0;
    for (const row of listed.value.agents) {
      if (row.kind !== "operator") continue;
      const agent = await read<
        { definition: { contexts?: readonly string[] } | null }
      >("agents", "read", { place, assignment: row.assignment });
      if (!agent.ok) return agent;
      if (agent.value.definition?.contexts?.includes(context) === true) {
        count += 1;
      }
    }
    return { ok: true, value: count };
  };

  return {
    async list(project) {
      const result = await collect<
        Page & { contexts: readonly ContextListItem[] },
        ContextListItem
      >("list", { project }, (value) => value.contexts);
      return result.ok ? { ok: true, value: result.value.items } : result;
    },

    async get(context) {
      const result = await read<ContextDetail>("contexts", "get", { context });
      return result.ok
        ? {
          ok: true,
          value: {
            context: result.value.context,
            applied: result.value.applied,
          },
        }
        : result;
    },

    async overview(context) {
      const result = await read<ContextOverview>("contexts", "overview", {
        context,
      });
      return result.ok
        ? {
          ok: true,
          value: {
            context: result.value.context,
            bundle_hash: result.value.bundle_hash,
            types: result.value.types,
            violation_count: result.value.violation_count,
          },
        }
        : result;
    },

    async contract(context) {
      const result = await read<ContextContract>("contexts", "contract", {
        context,
      });
      return result.ok
        ? {
          ok: true,
          value: {
            context: result.value.context,
            bundle: result.value.bundle,
            bundle_hash: result.value.bundle_hash,
            content: result.value.content,
          },
        }
        : result;
    },

    async draft(context) {
      const result = await read<ContextDraft>("contexts", "draft", {
        context,
      });
      return result.ok
        ? {
          ok: true,
          value: { context: result.value.context, draft: result.value.draft },
        }
        : result;
    },

    async bundles(context) {
      const result = await collect<
        Page & { bundles: readonly BundleEntry[] },
        BundleEntry
      >("bundles", { context }, (value) => value.bundles);
      return result.ok ? { ok: true, value: result.value.items } : result;
    },

    async search(request) {
      const result = await read<SearchPage>("contexts", "search", request);
      return result.ok
        ? {
          ok: true,
          value: {
            rows: result.value.rows,
            complete: result.value.complete,
            next_cursor: result.value.next_cursor,
            total: result.value.total,
          },
        }
        : result;
    },

    async inputOptions(request) {
      const result = await read<InputOptions>(
        "contexts",
        "input_options",
        request,
      );
      return result.ok
        ? {
          ok: true,
          value: {
            search: result.value.search,
            input: result.value.input,
            options: result.value.options,
            complete: result.value.complete,
          },
        }
        : result;
    },

    async violations(context): Promise<ReadResult<ViolationsPage>> {
      const result = await collect<
        Page & {
          violations: ViolationsPage["violations"];
          complete: boolean;
        },
        ViolationsPage["violations"][number]
      >("violations", { context }, (value) => value.violations);
      return result.ok
        ? {
          ok: true,
          value: {
            violations: result.value.items,
            complete: result.value.next === null,
            next_cursor: result.value.next,
          },
        }
        : result;
    },

    async glossary(context) {
      const result = await read<{ entries: readonly GlossaryEntry[] }>(
        "terms",
        "list",
        { context },
      );
      return result.ok ? { ok: true, value: result.value.entries } : result;
    },

    async savedViews(context) {
      const result = await read<{ views: readonly SavedViewListItem[] }>(
        "contexts",
        "saved_views",
        { context },
      );
      return result.ok ? { ok: true, value: result.value.views } : result;
    },

    async containing(project, path) {
      const result = await read<{ contexts: readonly ContainingContext[] }>(
        "contexts",
        "containing",
        { project, path },
      );
      return result.ok ? { ok: true, value: result.value.contexts } : result;
    },

    operatorCount: countOperators,

    saveView: (request) => command("contexts", "save_view", request),

    glossarySet: (request, compare?: BaseRevision) =>
      command("terms", "set", request, compare ? { ...compare } : {}),

    glossaryRemove: (request, compare) =>
      command("terms", "remove", request, { ...compare }),

    handOffViolations: (request) =>
      command("contexts", "hand_off_violations", request),

    // rollback의 비교 기준은 context의 revision이다: 읽은 뒤 다른 판이 적용되면 core가 거절한다.
    async rollback(request) {
      const detail = await read<ContextDetail>("contexts", "get", {
        context: request.context,
      });
      if (!detail.ok) return detail;
      return await command(
        "contexts",
        "rollback",
        request,
        { base_revision: detail.value.context.revision },
      );
    },
  };
}

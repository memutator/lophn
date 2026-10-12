// 신뢰 감독(shell main)의 coding child 등록(platform#T34 후속, platform/identity#R15). terminal host가
// lophn이 띄운 TUI 아래에서 관측한 MCP·CLI process를 core의 보호 전달 경계에 등록·해제한다. main은 자기
// 사람 credential(`CoreSession.internal`)로 core의 `register_child`·`end_child`·`end_connection` route를 부르고
// 이 route는 사람 credential에만 열려 있다(coding agent·app·agent는 403). scope는 보내지 않고 core가 ledger의
// connection 현재 상태에서 읽는다.
//
// 호출은 한 줄 대기열로 순서대로 한다(등록 → 해제가 뒤집히지 않게). 등록하지 못한 child는 해제할 것도 없다.
// TUI가 끝나면 그 TUI 아래 child를 모두 해제하고, 같은 connection의 다른 TUI child가 남아 있지 않을 때만
// connection 전체를 정리한다. host가 사라지면 이 main이 아는 모든 connection을 정리한다.

import { z } from "zod";

import { connectionIdSchema } from "../../../../protocol/coding-agent/mod.ts";

type CoreCall = (
  kind: string,
  resource: string,
  method: string,
  body: unknown,
) => Promise<{ ok: boolean }>;

const started = z.object({
  event: z.literal("child_started"),
  runtime_ref: z.string().min(1),
  connection: connectionIdSchema,
  process_generation: z.string().min(1),
  loader_identity: z.string().startsWith("/"),
});
const ended = z.object({
  event: z.literal("child_ended"),
  runtime_ref: z.string().min(1),
  connection: connectionIdSchema,
  process_generation: z.string().min(1),
});
const tuiEnded = z.object({
  event: z.literal("tui_ended"),
  runtime_ref: z.string().min(1),
  connection: connectionIdSchema,
});
const childEventSchema = z.discriminatedUnion("event", [
  started,
  ended,
  tuiEnded,
]);

export type ChildRegistrar = {
  /** supervisor가 host에서 받은 줄. child 줄이 아니면 무시한다. */
  onEvent(event: unknown): void;
  /** host가 끝났거나 멈췄다. 이 main이 등록한 모든 connection의 child를 정리한다. */
  hostLost(): void;
  /** 대기 중인 core 호출이 모두 끝나면 resolve한다. */
  idle(): Promise<void>;
};

export function createChildRegistrar(deps: {
  /** main이 사람 credential로 core를 부른다(`CoreSession.internal`). 연결이 없으면 null. */
  core(): { internal: CoreCall } | null | undefined;
}): ChildRegistrar {
  /** 등록한 child: runtime_ref → (process_generation → connection). */
  const tracked = new Map<string, Map<string, string>>();
  let chain: Promise<void> = Promise.resolve();

  function enqueue(work: () => Promise<void>): void {
    chain = chain.then(work, work).catch(() => undefined);
  }

  async function call(method: string, body: unknown): Promise<boolean> {
    const session = deps.core();
    if (session === undefined || session === null) return false;
    try {
      const result = await session.internal(
        "memory",
        "coding_agent_connections",
        method,
        body,
      );
      return result.ok;
    } catch {
      return false;
    }
  }

  function untrack(runtime: string, generation: string): void {
    const children = tracked.get(runtime);
    children?.delete(generation);
    if (children?.size === 0) tracked.delete(runtime);
  }

  function inUse(connection: string): boolean {
    for (const children of tracked.values()) {
      for (const owner of children.values()) {
        if (owner === connection) return true;
      }
    }
    return false;
  }

  return {
    onEvent(event) {
      const parsed = childEventSchema.safeParse(event);
      if (!parsed.success) return;
      const line = parsed.data;
      if (line.event === "child_started") {
        enqueue(async () => {
          const registered = await call("register_child", {
            connection: line.connection,
            process_generation: line.process_generation,
            loader_identity: line.loader_identity,
          });
          if (!registered) return;
          const children = tracked.get(line.runtime_ref) ??
            new Map<string, string>();
          children.set(line.process_generation, line.connection);
          tracked.set(line.runtime_ref, children);
        });
        return;
      }
      if (line.event === "child_ended") {
        enqueue(async () => {
          untrack(line.runtime_ref, line.process_generation);
          await call("end_child", {
            process_generation: line.process_generation,
          });
        });
        return;
      }
      enqueue(async () => {
        const children = tracked.get(line.runtime_ref);
        tracked.delete(line.runtime_ref);
        for (const generation of children?.keys() ?? []) {
          await call("end_child", { process_generation: generation });
        }
        // 같은 connection의 다른 TUI child가 남아 있으면 그것은 그 TUI의 관측이 정리한다.
        if (!inUse(line.connection)) {
          await call("end_connection", { connection: line.connection });
        }
      });
    },
    hostLost() {
      enqueue(async () => {
        const connections = new Set<string>();
        for (const children of tracked.values()) {
          for (const connection of children.values()) {
            connections.add(connection);
          }
        }
        tracked.clear();
        for (const connection of connections) {
          await call("end_connection", { connection });
        }
      });
    },
    idle() {
      return chain;
    },
  };
}

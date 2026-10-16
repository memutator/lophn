// documents/contexts의 새 context API를 core에 올리는 등록(command·read·ledger 표·blob field).
// 순수 handler와 SQL adapter는 packages/core/projects/contexts가 하고, 여기는 그것을 platform ledger
// 등록 모양으로 묶는 자리다.
//
// 이 모듈은 core module graph에 들어간다(documents.ts가 import한다). 그래서 node:sqlite와 동기
// file API를 쓰는 실제 의존(blob 읽기, index 저장소)은 여기에 두지 않는다. 그 구현은
// contexts-ledger-deps.ts에 있고, command를 실행하는 writer Worker와 read를 실행하는 reader Worker
// 안에서만 동적으로 올린다(loadContextsRuntime). core 본체가 부르는 등록은 route를 registry에 올리는
// 데만 쓰이고 handler는 실행되지 않는다.
import { err, type Result } from "../../../base/mod.ts";
import { defineBlobField } from "../../../protocol/storage/mod.ts";
import type {
  CommandDefinition,
  ReadDefinition,
  SchemaStep,
  Sql,
} from "../../../protocol/server/mod.ts";
import {
  CONTEXT_CONTENT_FIELD,
  CONTEXT_CONTENT_OWNER_KIND,
} from "../../../protocol/projects/mod.ts";
import {
  CONTEXT_WORKER_OPERATIONS,
  contextAuthorityPort,
  contextLedgerCommands,
  type ContextLedgerDeps,
  contextLedgerReads,
  contextsLedgerSchemaSteps,
  contextWorkInputRead,
  contextWorkListRead,
} from "./mod.ts";

// context를 쓸 수 있는 actor를 판정하는 tx port. wiring이 구현을 끼운다(ContextAuthority).
export { contextAuthorityPort };

// content blob(BundleContent JSON)의 영구 참조. owner_key는 blob의 hash다:
// 내용으로 주소를 정한 값이라 같은 내용은 한 참조다. 일반 blob 읽기로는 열지 않는다(context 읽기가 연다).
// 바이트는 core가 command 앞에서 호출자 자격으로 준비한다(contexts-blob.ts).
export const contextContentField = defineBlobField({
  owner_kind: CONTEXT_CONTENT_OWNER_KIND,
  field: CONTEXT_CONTENT_FIELD,
  retention: { kind: "permanent" },
  general_read: false,
});

// command·read를 실행하는 쪽이 의존을 쓰기 전에 알리는 ledger 연결. blob 파일의 위치(data root)는
// adapter가 sql을 넘기지 않는 port라 이 연결로 푼다.
export type ContextsRuntime = {
  deps: ContextLedgerDeps;
  enter(sql: Pick<Sql, "get" | "all">): void;
};

const UNATTACHED = "context 의존은 writer·reader Worker에서만 열린다";

// 실행하지 않는 쪽(core 본체, route 등록만 필요한 harness)의 의존이다. 빈 결과로 꾸미지 않고
// 쓰려 하면 unavailable이다.
function unattached(): ContextsRuntime {
  return {
    enter: () => undefined,
    deps: {
      blobs: {
        read: () => err({ code: "unavailable", message: UNATTACHED }),
      },
      index: {
        violations: () => [],
        entities: () => [],
        entity: () => [],
        ofType: () => [],
        failing: () => true,
      },
      execute: () => [],
      hash() {
        throw new ContextDepUnavailable(UNATTACHED);
      },
      appIds: () => [],
    },
  };
}

function inWorker(): boolean {
  const scope = (globalThis as { WorkerGlobalScope?: new () => unknown })
    .WorkerGlobalScope;
  return typeof scope === "function" && globalThis instanceof scope;
}

type DepsModule = { createContextsRuntime(): ContextsRuntime };

// writer·reader Worker 안이면 실제 의존을 올린다. 정적 import가 아니라 core graph에 들어오지 않는다.
export async function loadContextsRuntime(): Promise<ContextsRuntime> {
  if (!inWorker()) return unattached();
  const url = new URL("./ledger/deps.ts", import.meta.url).href;
  const loaded = await import(url) as DepsModule;
  return loaded.createContextsRuntime();
}

// 의존이 동기 port라 Result를 돌려주지 못하는 곳은 이 오류를 던진다. 등록이 감싸서
// transaction을 되돌리고 unavailable로 답한다.
export class ContextDepUnavailable extends Error {}

function unavailable(error: unknown): Result<never> | undefined {
  return error instanceof ContextDepUnavailable
    ? err({ code: "unavailable", message: error.message })
    : undefined;
}

export type ContextsRegistration = {
  schemaSteps: readonly SchemaStep[];
  commands: readonly CommandDefinition[];
  reads: readonly ReadDefinition[];
  blobFields: readonly (typeof contextContentField)[];
};

export function createContextsRegistration(
  runtime: ContextsRuntime,
): ContextsRegistration {
  return {
    schemaSteps: contextsLedgerSchemaSteps,
    commands: contextLedgerCommands(runtime.deps).map((command) => ({
      ...command,
      handle(tx, ctx, input, compare) {
        runtime.enter(tx.sql);
        try {
          return command.handle(tx, ctx, input, compare);
        } catch (thrown) {
          const result = unavailable(thrown);
          if (result === undefined) throw thrown;
          return result;
        }
      },
    })),
    reads: [
      ...contextLedgerReads(runtime.deps),
      contextWorkInputRead(runtime.deps),
      contextWorkListRead(),
    ].map((read) => ({
      ...read,
      handle(snapshot, ctx, input) {
        runtime.enter(snapshot.sql);
        try {
          return read.handle(snapshot, ctx, input);
        } catch (thrown) {
          const result = unavailable(thrown);
          if (result === undefined) throw thrown;
          return result;
        }
      },
    })),
    blobFields: [contextContentField],
  };
}

export { CONTEXT_WORKER_OPERATIONS };

export const CONTEXT_WORKER_PRINCIPAL = "machine:context-worker";

// context worker가 쓰는 좁은 machine 자격의 발급 요청이다. operation은 CONTEXT_WORKER_OPERATIONS
// 둘뿐이라 mapActor가 이 자격을 context_worker로 본다. worker를 띄우는 쪽이 registry.issue에 넘긴다.
export function contextWorkerCredential() {
  return {
    actor: "machine" as const,
    principal: CONTEXT_WORKER_PRINCIPAL,
    scope: {
      operations: [...CONTEXT_WORKER_OPERATIONS],
      targets: { task: "contexts" },
    },
    conditions: { task: "contexts", process: "documents/contexts" },
  };
}

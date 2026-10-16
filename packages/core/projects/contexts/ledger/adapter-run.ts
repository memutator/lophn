// command와 읽기 하나를 ledger 위에서 돌리는 흐름이다(adapter.ts 머리말의 1, 3~6).
import type { Result } from "../../../../base/mod.ts";
import { CONTEXT_API_EVENTS } from "../../../../protocol/projects/mod.ts";
import { contextViolationFound } from "../../../../protocol/events/mod.ts";
import type {
  Compare,
  Input,
  Output,
  ReadSnapshot,
  RequestContext,
  Sql,
  Tx,
} from "../../../../protocol/server/mod.ts";
import type { CommandRoute, ReadRoute } from "../../../../protocol/base/mod.ts";
import type { EventDefinition } from "../../../../protocol/base/mod.ts";
import {
  type ContextApiCommands,
  createContextApiCommands,
  type Handler,
} from "../api/commands.ts";
import {
  type ContextApiReads,
  createContextApiReads,
  type ReadHandler,
} from "../api/reads.ts";
import type { ContextApiActor } from "../api/state.ts";
import { createContextDrafts } from "../folders.ts";
import { contextAuthorityPort, type ContextLedgerDeps } from "./adapter.ts";
import { type LoadPlan, loadState } from "./adapter-load.ts";
import { baselineOf, blobUploads, writeChanges } from "./adapter-save.ts";
import { registerContextContent } from "./content-blobs.ts";
import { loadViolationKeys, saveViolationKeys } from "./rows-violations.ts";

export type CommandSpec<R extends CommandRoute> = {
  handler(commands: ContextApiCommands): Handler<R>;
  plan(sql: Pick<Sql, "get" | "all">, input: Input<R>): LoadPlan;
};

export type ReadSpec<R extends ReadRoute> = {
  handler(reads: ContextApiReads): ReadHandler<R>;
  plan(sql: Pick<Sql, "get" | "all">, input: Input<R>): LoadPlan;
};

const EVENTS: ReadonlyMap<string, EventDefinition> = new Map(
  [...CONTEXT_API_EVENTS, contextViolationFound].map((
    event,
  ) => [event.type, event]),
);

export function runCommand<R extends CommandRoute>(
  spec: CommandSpec<R>,
  deps: ContextLedgerDeps,
  tx: Tx,
  ctx: RequestContext,
  actor: ContextApiActor,
  input: Input<R>,
  compare: Compare<R>,
): Result<Output<R>> {
  // 시각은 transaction 하나에 하나다. tx.now()는 부를 때마다 달라질 수 있으므로 한 번만 부른다.
  const at = tx.now();
  const loaded = loadState(tx.sql, deps, spec.plan(tx.sql, input), 0);
  if (!loaded.ok) return loaded;
  const { state, contentRefs } = loaded.value;
  const before = baselineOf(state);
  const uploads = blobUploads();
  const drafts = createContextDrafts(deps.folders, deps.files);
  const commands = createContextApiCommands(state, {
    now: () => at,
    newId: (prefix) => tx.newId(prefix),
    hash: deps.hash,
    putBlob: uploads.put,
    canWrite: (actor, project) =>
      tx.port(contextAuthorityPort).canWrite(actor, project),
    drafts,
    recordedViolations: (context) => loadViolationKeys(tx.sql, context),
    keepViolations: (context, keys) => saveViolationKeys(tx.sql, context, keys),
    emit(event) {
      const definition = EVENTS.get(event.type);
      if (definition === undefined) {
        throw new Error(`unknown context event ${event.type}`);
      }
      return tx.emit(definition, event.subject, event.payload);
    },
  });
  // 멱등은 platform envelope가 하므로 handler의 재실행 기억은 쓰지 않는다. state.replays는 비어 있다.
  const result = spec.handler(commands)({ actor, key: "", input, compare });
  if (!result.ok) return result;
  // handler가 가리킨 blob의 영구 참조를 소유 변경과 같은 transaction에서 등록한다. 준비되지 않았으면
  // 실패하고 platform이 event까지 되돌린다.
  for (const reference of uploads.references()) {
    const registered = registerContextContent(tx, ctx, reference);
    if (!registered.ok) return registered;
  }
  writeChanges(tx.sql, before, state, contentRefs, uploads);
  // 제출하거나 버린 초안 폴더는 쓰기가 끝난 뒤에 지운다.
  drafts.flush();
  return result;
}

export function runRead<R extends ReadRoute>(
  spec: ReadSpec<R>,
  deps: ContextLedgerDeps,
  snapshot: ReadSnapshot,
  actor: ContextApiActor,
  input: Input<R>,
): Result<Output<R>> {
  const plan = spec.plan(snapshot.sql, input);
  const loaded = loadState(
    snapshot.sql,
    deps,
    plan,
    Number(snapshot.as_of_seq),
  );
  if (!loaded.ok) return loaded;
  const reads = createContextApiReads(loaded.value.state, {
    execute: deps.execute,
    now: () => new Date().toISOString(),
    canWrite: (actor, project) =>
      snapshot.port(contextAuthorityPort).canWrite(actor, project),
    drafts: createContextDrafts(deps.folders, deps.files),
  });
  return spec.handler(reads)({ actor, input });
}

// kinds worker(documents/kinds)를 띄우고 부리는 조립. domain 그릇의 폴더와 kinds 파일의 변화를 보고, 위반을
// problem으로 올리고, `kind.get`·`kind.list`·`kind.check` core 메모리 route를 worker에 묻는 handler로 답한다.
// 띄우지 못해도 core는 계속 선다: 읽기는 unavailable이다.
import { createIdSource, ok } from "../../../../base/mod.ts";
import type { DomainOwner } from "../../../../protocol/domains/mod.ts";
import { problemSyncDomain } from "../../../../protocol/problems/mod.ts";
import type { Writer } from "../../../storage/ledger/mod.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import type { OperationPolicy } from "../../../server/identity/mod.ts";
import { kindsDispatchCredential } from "../../../projects/kinds/host/credential.ts";
import {
  createKindsDispatcher,
  type KindsDispatcher,
} from "../../../projects/kinds/host/dispatcher.ts";
import { kindHandlers } from "../../../projects/kinds/host/handlers.ts";
import { createKindsProcess } from "../../../projects/kinds/host/process.ts";
import {
  createKindsWatch,
  denoWatchFs,
  type KindsWatch,
} from "../../../projects/kinds/host/watch/service.ts";
import { appSourcePath, appStatusOf } from "../../../apps/lookups.ts";
import { activeDomainIds, domainOwnerOf } from "../../../domains/lookups.ts";
import { projectRootsOf } from "../../../projects/lookups.ts";
import { createWorkerChannel, type WiringFactory } from "./context.ts";

type Connection = Extract<
  ReturnType<typeof openConnection>,
  { ok: true }
>["value"];

// domain 그릇의 폴더들이다. project는 활성 project의 등록 폴더들, 앱은 source가 연결된 활성 앱의 source 폴더 하나다.
// 그 밖(없는 domain, 보관된 그릇, source 없는 앱)은 null이다.
function rootsOfDomain(
  sql: Connection["sql"],
  domain: string,
): string[] | null {
  const owner = domainOwnerOf(sql, domain);
  if (owner === null) return null;
  if (owner.kind === "project") return projectRootsOf(sql, owner.id);
  if (appStatusOf(sql, owner.id) !== "active") return null;
  const source = appSourcePath(sql, owner.id);
  return source === null ? null : [source];
}

export const kindsWiring: WiringFactory = () => {
  // build가 handler를 만들고, start가 worker를 띄운 뒤 dispatcher를 붙인다.
  let dispatcher: KindsDispatcher | undefined;
  let watch: KindsWatch | undefined;
  let link: Connection | undefined;
  return {
    name: "kinds",
    // kinds dispatch(machine)가 위반을 problem으로 올린다.
    operations: () => [
      {
        name: problemSyncDomain.name,
        actors: ["machine"],
        kind: "command",
      } satisfies OperationPolicy,
    ],
    build(ctx) {
      // domain·그릇 표를 읽는 짧은 ledger 연결이다.
      const opened = openConnection(ctx.ledgerPath);
      if (!opened.ok) return opened;
      const connection = opened.value;
      link = connection;
      const handlers = kindHandlers({
        dispatcher: () => dispatcher,
        ownerOf: (domain): DomainOwner | null =>
          domainOwnerOf(connection.sql, domain),
        rootsOf: (domain) => rootsOfDomain(connection.sql, domain),
      });
      return ok({
        memory: handlers,
        // 받아들여진 project·앱·domain command마다 감시를 다시 정한다.
        writer: (inner: Writer): Writer => ({
          ...inner,
          async command(context, envelope) {
            const result = await inner.command(context, envelope);
            if (result.ok) watch?.onCommand(envelope.command);
            return result;
          },
        }),
      });
    },
    async start(ctx) {
      const { runtime } = ctx;
      const issued = await ctx.registry.issue(kindsDispatchCredential());
      const current = issued.ok
        ? ctx.registry.revalidate({
          credential_ref: issued.value.credential_ref,
        })
        : issued;
      const recorded = issued.ok && current.ok
        ? await runtime.record(current.value)
        : current;
      if (!(issued.ok && recorded.ok)) return ok(undefined);
      const credentialRef = issued.value.credential_ref;
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      const process = createKindsProcess({
        supervisor: ctx.io,
        channel: createWorkerChannel(),
        dataRoot: ctx.root.path,
        epoch: ctx.epoch,
        apiPort: ctx.server.port,
        prepare: async () => {
          await Deno.mkdir(`${ctx.root.path}/derived`, { recursive: true });
        },
      });
      const attached = createKindsDispatcher({
        process,
        dataRoot: ctx.root.path,
        roots: (domain) => rootsOfDomain(link!.sql, domain),
        command: (envelope) => {
          const context = runtime.current(credentialRef);
          return context.ok
            ? ctx.writer.command(context.value as never, envelope)
            : Promise.resolve(context);
        },
        newId: (prefix) => ids.newId(prefix),
        nowMs: () => performance.now(),
        log: (message) => console.error(`kinds worker: ${message}`),
      });
      dispatcher = attached;
      watch = createKindsWatch({
        dataRoot: ctx.root.path,
        list: () =>
          activeDomainIds(link!.sql).flatMap((domain) => {
            const roots = rootsOfDomain(link!.sql, domain);
            return roots === null ? [] : [{ domain, roots }];
          }),
        kindsOf: async (domain) => {
          const got = await attached.ask("get", domain);
          return got.ok ? ok(got.value as never) : got;
        },
        catchUp: (domain) => attached.sync(domain, { force: true }),
        watchFs: denoWatchFs,
        log: (message) => console.error(message),
      });
      void watch.start();
      return ok(undefined);
    },
    closeIntake() {
      watch?.stop();
    },
    closeWork() {
      link?.close();
    },
  };
};

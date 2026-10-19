// kinds worker(documents/kinds)를 띄우고 부리는 조립. project 폴더와 kinds 파일의 변화를 보고, 위반을
// problem으로 올리고, `kind.get`·`kind.list`·`kind.check` core 메모리 route를 worker에 묻는 handler로 답한다.
// 띄우지 못해도 core는 계속 선다: 읽기는 unavailable이다.
import { createIdSource, ok } from "../../../../base/mod.ts";
import { problemSyncProject } from "../../../../protocol/problems/mod.ts";
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
import {
  activeProjectRoots,
  projectRootsOf,
} from "../../../projects/lookups.ts";
import { createWorkerChannel, type WiringFactory } from "./context.ts";

type Connection = Extract<
  ReturnType<typeof openConnection>,
  { ok: true }
>["value"];

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
        name: problemSyncProject.name,
        actors: ["machine"],
        kind: "command",
      } satisfies OperationPolicy,
    ],
    build(ctx) {
      // project 폴더를 읽는 짧은 ledger 연결이다.
      const opened = openConnection(ctx.ledgerPath);
      if (!opened.ok) return opened;
      const connection = opened.value;
      link = connection;
      const handlers = kindHandlers({
        dispatcher: () => dispatcher,
        rootsOf: (project) => projectRootsOf(connection.sql, project),
      });
      return ok({
        memory: handlers,
        // 받아들여진 project command마다 감시를 다시 정한다.
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
        roots: (project) => projectRootsOf(link!.sql, project),
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
        list: () => activeProjectRoots(link!.sql),
        kindsOf: async (project) => {
          const got = await attached.ask("get", project);
          return got.ok ? ok(got.value as never) : got;
        },
        catchUp: (project) => attached.sync(project, { force: true }),
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

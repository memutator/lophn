import { err, ok } from "../../../../base/mod.ts";
import type { RequestContext } from "../../../../protocol/server/mod.ts";
import {
  contextWorkInputReadSchema,
  contextWorkInputRoute,
  contextWorkListReadSchema,
  contextWorkListRoute,
} from "../../../../protocol/projects/mod.ts";
import type { OperationPolicy } from "../../../server/identity/mod.ts";
import {
  CONTEXT_WORKER_OPERATIONS,
  contextWorkerCredential,
} from "../../../projects/contexts/register.ts";
import {
  createContextBlobPreparer,
  withContextBlobs,
} from "../../../projects/contexts/blob.ts";
import {
  type ContextsDispatchDeps,
  contextsStagingPath,
  createContextsDispatcher,
  createContextsHost,
  createContextsProcess,
} from "../../../projects/contexts/connection.ts";
import {
  type ContextsWatch,
  createContextsWatch,
  denoWatchFs,
} from "../../../projects/contexts/watch/service.ts";
import {
  projectInfoList,
  projectInfoOf,
} from "../../../projects/registry/mod.ts";
import { createFolderResolver } from "../../../projects/registry/folder-resolver.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import type { ProjectDirectory } from "../../../apps/ports.ts";
import { createWorkerChannel, type WiringFactory } from "./context.ts";

// context worker 일의 입력(적용 판·검사할 후보 판)과 활성 context 목록을 reader에서 읽는 자격. core가
// reader에 넘기는 context라 발급 자격이 아니다. 둘 다 machine 전용 내부 read다.
const contextsInputReader: RequestContext = {
  principal: "machine:contexts-dispatch",
  actor: "machine",
  scope: {
    operations: [contextWorkInputRoute.name, contextWorkListRoute.name],
    targets: {},
  },
  conditions: {},
  credential_ref: "machine:contexts-dispatch",
};

export const projectsWiring: WiringFactory = () => {
  // context index를 읽는 읽기는 읽기 전에 index를 따라잡고, bundle.submit은 검사를 worker에 보낸다.
  // start에서 context worker를 띄운 뒤 dispatcher가 붙는다.
  const contextsHost = createContextsHost();
  // 활성 context의 계약 경로 폴더를 보고 바뀌면 index를 따라잡게 하는 감시.
  let contextsWatch: ContextsWatch | undefined;
  let directoryLink: { close(): void } | undefined;
  return {
    name: "projects",
    // context worker(machine)가 검사 결과와 위반 수를 기록한다(documents/contexts).
    operations: () =>
      CONTEXT_WORKER_OPERATIONS.map((name): OperationPolicy => ({
        name,
        actors: ["machine"],
        kind: "command",
      })),
    build(ctx) {
      // 앱이 project 목록을 읽는 길. 읽기만 하는 짧은 ledger 연결이다.
      const opened = openConnection(ctx.ledgerPath);
      if (!opened.ok) return opened;
      const connection = opened.value;
      directoryLink = connection;
      const folders = createFolderResolver();
      const summary = (info: {
        id: string;
        name: string;
        purpose: string;
        archived: boolean;
      }) => ({
        id: info.id as never,
        name: info.name,
        purpose: info.purpose,
        archived: info.archived,
      });
      const directory: ProjectDirectory = {
        list() {
          const listed = projectInfoList(connection.sql, folders);
          return listed.ok ? ok(listed.value.map(summary)) : listed;
        },
        get(id) {
          const found = projectInfoOf(connection.sql, folders, { id });
          if (!found.ok) return found;
          return ok(found.value === null ? null : summary(found.value));
        },
      };
      ctx.provide("projectDirectory", directory);
      return ok({
        reads: (reads) => contextsHost.overlayReads(reads),
        // context의 초안은 호출자 자격으로 command 앞에 준비한다.
        writer: (inner) =>
          withContextBlobs(
            contextsHost.wrapWriter(inner),
            createContextBlobPreparer({
              relay: () => ctx.bodyPrepare,
            }),
          ),
      });
    },
    // documents/contexts. index를 갱신하고 판을 검사하는 context worker(documents 2.4)다. 첫 요청에서 띄우고
    // 상주한다. 띄우지 못해도 core는 계속 선다: 읽기는 있던
    // index로 답하고(없으면 unavailable) 제출된 판은 checking으로 남는다.
    async start(ctx) {
      const { runtime } = ctx;
      const issued = await ctx.registry.issue(contextWorkerCredential());
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
      const contextsChannel = createWorkerChannel();
      const contextsProcess = createContextsProcess({
        supervisor: ctx.io,
        channel: contextsChannel,
        dataRoot: ctx.root.path,
        epoch: ctx.epoch,
        apiPort: ctx.server.port,
        prepare: async () => {
          await Deno.mkdir(`${ctx.root.path}/derived`, { recursive: true });
          await Deno.mkdir(contextsStagingPath(ctx.root.path), {
            recursive: true,
          });
        },
      });
      const readContextInput: ContextsDispatchDeps["readInput"] = async (
        input,
      ) => {
        const read = await runtime.readers.read(
          contextWorkInputRoute,
          contextsInputReader,
          input,
        );
        if (!read.ok) return read;
        const parsed = contextWorkInputReadSchema.safeParse(read.value);
        return parsed.success ? ok(parsed.data) : err({
          code: "internal" as const,
          message: "the context worker input is not valid",
        });
      };
      // 활성 context와 도는 검사의 목록. 읽을 때마다 worker가 읽을 폴더 전체를 맞춘다(빠진 폴더는 다음에
      // 다시 띄울 때 권한에서 빠진다).
      const listContextWork: NonNullable<ContextsDispatchDeps["list"]> =
        async () => {
          const read = await runtime.readers.read(
            contextWorkListRoute,
            contextsInputReader,
            {},
          );
          if (!read.ok) return read;
          const parsed = contextWorkListReadSchema.safeParse(read.value);
          if (!parsed.success) {
            return err({
              code: "internal" as const,
              message: "the context work list is not valid",
            });
          }
          contextsProcess.retain([
            ...new Set([
              ...parsed.data.contexts.flatMap((entry) => entry.roots),
              ...parsed.data.checks.flatMap((entry) => entry.roots),
            ]),
          ]).catch((error) =>
            console.error(`context worker: ${String(error)}`)
          );
          return ok(parsed.data);
        };
      const contextsWatchHandle = createContextsWatch({
        list: listContextWork,
        readInput: readContextInput,
        catchUp: (context) => dispatcher.ensureFresh(context, { force: true }),
        watchFs: denoWatchFs,
        log: (message) => console.error(message),
      });
      contextsWatch = contextsWatchHandle;
      contextsHost.onAccepted(contextsWatchHandle.onCommand);
      const dispatcher = createContextsDispatcher({
        process: contextsProcess,
        readInput: readContextInput,
        observed: (input) => contextsWatchHandle.observe(input),
        list: listContextWork,
        command: (envelope) => {
          const context = runtime.current(credentialRef);
          return context.ok
            ? runtime.writer.command(context.value as never, envelope)
            : Promise.resolve(context);
        },
        nowMs: () => performance.now(),
        log: (message) => console.error(`context worker: ${message}`),
      });
      contextsHost.attach(dispatcher);
      void contextsWatchHandle.start();
      // 이전 실행에서 결과를 받지 못한 검사는 checking으로 남아 있다. 다시 보낸다.
      void dispatcher.recover();
      return ok(undefined);
    },
    closeIntake() {
      contextsWatch?.stop();
    },
    closeWork() {
      directoryLink?.close();
    },
  };
};

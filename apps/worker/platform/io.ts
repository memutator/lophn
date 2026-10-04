import {
  type ChildSession,
  type ChildStreams,
  createIoScheduler,
  startChild,
} from "../../../packages/platform/responsiveness/mod.ts";
import {
  createDiagnosticIngress,
  createLogFiles,
  createSafeLog,
  type DiagnosticAuthority,
  type DiagnosticCatalog,
} from "../../../packages/platform/diagnostics/mod.ts";

export async function createPlatformIo(options: {
  root: string;
  streams: ChildStreams;
  catalog: DiagnosticCatalog;
  currentAuthority(): DiagnosticAuthority | undefined;
}): Promise<ChildSession> {
  const files = await createLogFiles(options.root);
  const log = createSafeLog({ catalog: options.catalog, sink: files.write });
  const scheduler = createIoScheduler();
  const ingress = createDiagnosticIngress({
    log,
    currentAuthority: () =>
      session.credentialUsable ? options.currentAuthority() : undefined,
  });
  const session = startChild(options.streams, {
    onHello(hello) {
      if (hello.kind !== "platform/io") throw new Error("invalid worker kind");
      return session.send({ type: "ready" });
    },
    onStop() {
      scheduler.close();
      log.close();
      return session.send({ type: "stopped" });
    },
    async onParent(message) {
      if (message.type !== "worker_request") return;
      const authority = options.currentAuthority();
      if (!session.credentialUsable || !authority) {
        await session.send({
          type: "worker_response",
          request_id: message.request_id,
          ok: false,
          error: {
            code: "forbidden",
            message: "diagnostics authority required",
          },
        });
        return;
      }
      const submission = scheduler.submit(
        authority.principal,
        () => Promise.resolve(ingress.accept(message)),
      );
      const result = submission.ok ? await submission.value.result : submission;
      if (!session.credentialUsable) return;
      const response = result.ok ? result.value : result;
      await session.send(
        response.ok
          ? {
            type: "worker_response",
            request_id: message.request_id,
            ok: true,
            payload: response.value,
          }
          : {
            type: "worker_response",
            request_id: message.request_id,
            ok: false,
            error: response.error,
          },
      );
    },
  });
  return session;
}

export async function runPlatformIo(root: string): Promise<void> {
  // Only the entry owns console routing. Helper modules never change global console.
  console.log = console.info = console.debug = (...args: unknown[]) =>
    console.error(...args);
  const session = await createPlatformIo({
    root,
    streams: { stdin: Deno.stdin, stdout: Deno.stdout, stderr: Deno.stderr },
    catalog: { components: ["platform/core", "platform/io"], locations: {} },
    // Product authority is supplied by core/T9 composition, not inferred from hello.
    currentAuthority: () => undefined,
  });
  await session.run();
}

import { assertEquals } from "@std/assert";
import { main } from "./main.ts";
import { ensureSchedulePort } from "./schedule.ts";
import { blueprint } from "./testing.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";

type ReporterDeps = {
  transport: (input: unknown) => Promise<unknown>;
  currentInvocation: () => unknown;
};

Deno.test("apps/sdk#R33 problems/reporting#R1: the entrypoint installs the problem reporter with the broker transport and the real invocation context", async () => {
  const dir = await Deno.makeTempDir();
  try {
    let reporterDeps: ReporterDeps | undefined;
    let installed: unknown;
    const sent: unknown[] = [];
    await main({
      readLine: () =>
        Promise.resolve(
          JSON.stringify({
            app: APP,
            release: REL,
            bundle_hash: "ab".repeat(32),
            mode: "live",
            process_nonce: "nonce-1",
            broker_socket: `${dir}/b.sock`,
            direct_socket: `${dir}/a.sock`,
            data_path: dir,
            broker_credential: "child-cred",
            verify_key: "A".repeat(43),
          }),
        ),
      importModule: () =>
        Promise.resolve({
          createExceptionObserver: () => () => undefined,
          createProblemReporter: (deps: ReporterDeps) => {
            reporterDeps = deps;
            return "reporter";
          },
          installProblemReporter: (reporter: unknown) => {
            installed = reporter;
          },
        }),
      blueprint: blueprint(),
      broker: () => Promise.resolve({ status: 503, body: null }),
      dataSchema: 0,
      reportTransport: () => Promise.resolve(undefined),
      problemTransport: (input) => {
        sent.push(input);
        return Promise.resolve({ ok: true });
      },
      exit: () => undefined,
      writeStderr: () => undefined,
    });
    assertEquals(installed, "reporter");
    await reporterDeps!.transport({ code: "store_unavailable" });
    assertEquals(sent, [{ code: "store_unavailable" }]);
    // 업무 호출 밖에서는 invocation 문맥을 만들지 않는다.
    assertEquals(reporterDeps!.currentInvocation(), null);
    const evidence = await ensureSchedulePort().run(
      {
        app: APP,
        release: REL,
        mode: "live",
        invocation: "inv_01h455vb4pex5v6nkc6gd5fdw9",
      },
      () => reporterDeps!.currentInvocation(),
    );
    assertEquals(evidence, {
      id: "inv_01h455vb4pex5v6nkc6gd5fdw9",
      binding: "sdk_context",
      record_missing_reason: null,
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

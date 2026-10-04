/**
 * 다른 팀의 *_test.ts가 쓰는 test-only public entry.
 *
 * ```ts
 * const opened = await createLedgerHarness({
 *   registrationModules: [new URL("./owner-registration_test.ts", import.meta.url)],
 *   credentials: [ctx],
 * });
 * if (!opened.ok) throw new Error(opened.error.code);
 * try {
 *   await opened.value.command(ctx, {
 *     command: "owner.create", input: { key: "one" }, compare: {},
 *     idempotency_key: "create-one", prepared: [],
 *   });
 * } finally {
 *   await opened.value.close();
 * }
 * ```
 * 실제 임시 파일 SQLite/WAL, writer Worker/serveWriter/executor, reader Worker
 * 2개, 현재 테스트 credential, Tx-local port와 blob callback을 지원한다.
 * 제품 core/API/credential 발급, event visibility/replay, Tx.call dispatch,
 * T14 blob prepare/read는 지원하지 않는다. SQL control은 테스트 wire에만 있다.
 */
import { err, ok, type Result } from "../../../packages/base/mod.ts";
import { authenticatedContextSchema } from "../../../packages/contracts/platform/mod.ts";
import { harnessUnavailable, startChannel } from "./ledger-channel.ts";
import type {
  LedgerHarness,
  LedgerHarnessOptions,
  TestBoot,
  TestRequestBody,
} from "./ledger-types.ts";
export {
  defineTxPort,
  type TxPortRegistration,
} from "../../../packages/platform/ledger/mod.ts";
export type {
  CommandEnvelope,
  CommandSuccess,
  StoredCommandResult,
} from "../../../packages/platform/ledger/mod.ts";
export type {
  LedgerHarness,
  LedgerHarnessOptions,
  LedgerTestEnvironment,
  LedgerTestRegistration,
  LedgerTestRegistrationModule,
} from "./ledger-types.ts";

export async function createLedgerHarness(
  options: LedgerHarnessOptions,
): Promise<Result<LedgerHarness>> {
  const channels: ReturnType<typeof startChannel>[] = [];
  let directory: string | undefined;
  let closed = false;
  let cleanup: Promise<void> | undefined;
  function destroy(): Promise<void> {
    closed = true;
    if (!cleanup) {
      channels.forEach((channel) => channel.stop());
      cleanup = directory === undefined
        ? Promise.resolve()
        : Deno.remove(directory, { recursive: true });
      // 실패 cleanup도 close 호출자가 관측할 수 있게 같은 promise를 보존한다.
      void cleanup.catch(() => undefined);
    }
    return cleanup;
  }
  try {
    const nowMs = options.nowMs ?? Date.UTC(2025, 0, 1);
    const seed = options.seed ?? 1;
    if (
      !Number.isFinite(nowMs) || !Number.isInteger(seed) ||
      !Number.isFinite(Date.parse(new Date(nowMs).toISOString()))
    ) {
      return err({
        code: "invalid_input",
        message: "테스트 clock/seed가 올바르지 않다",
      });
    }
    const credentials = options.credentials ?? [];
    if (
      credentials.some((ctx) =>
        !authenticatedContextSchema.safeParse(ctx).success
      )
    ) {
      return err({
        code: "invalid_input",
        message: "테스트 credential이 올바르지 않다",
      });
    }
    const modules = options.registrationModules.map((url) => {
      if (!(url instanceof URL) || url.protocol !== "file:") {
        throw new Error("registration needs a file URL");
      }
      return url.href;
    });
    directory = await Deno.makeTempDir({ prefix: "lophn-ledger-harness-" });
    const boot: Omit<TestBoot, "role"> = {
      path: `${directory}/ledger.sqlite`,
      modules,
      credentials,
      nowMs,
      seed,
    };
    const writer = startChannel({ ...boot, role: "writer" }, () => {
      void destroy();
    });
    channels.push(writer);
    const started = await writer.ready;
    if (!started.ok || closed) {
      await destroy();
      return started.ok ? harnessUnavailable() : started;
    }
    for (let index = 0; index < 2; index++) {
      channels.push(startChannel({ ...boot, role: "reader" }, () => {
        void destroy();
      }));
    }
    const readers = channels.slice(1);
    const ready = await Promise.all(readers.map((channel) => channel.ready));
    const failure = ready.find((result) => !result.ok);
    if (failure || closed) {
      await destroy();
      return failure ?? harnessUnavailable();
    }
    let gate = Promise.resolve();
    let waiting = 0;
    let controls = 0;
    let readerIndex = 0;
    let closing: Promise<void> | undefined;
    const request = <T>(
      channel: typeof writer,
      body: TestRequestBody,
    ): Promise<Result<T>> => {
      if (closed || waiting >= 64) return Promise.resolve(harnessUnavailable());
      waiting++;
      const admitted = gate;
      return admitted.then(() =>
        closed ? harnessUnavailable() : channel.request<T>(body)
      ).finally(() => {
        waiting--;
      });
    };
    const control = (body: TestRequestBody): Promise<Result<void>> => {
      if (closed || controls >= 8) return Promise.resolve(harnessUnavailable());
      controls++;
      const result = gate.then(async () => {
        if (closed) return harnessUnavailable();
        const results = await Promise.all(
          channels.map((channel) => channel.request<void>(body)),
        );
        const failure = results.find((result) => !result.ok);
        if (failure) {
          await destroy();
          return failure;
        }
        return ok(undefined);
      }).finally(() => {
        controls--;
      });
      gate = result.then(() => undefined);
      return result;
    };
    return ok({
      command: (ctx, envelope) =>
        request(writer, { op: "command", ctx, envelope }),
      read: (route, ctx, input) =>
        request(readers[readerIndex++ % 2], { op: "read", route, ctx, input }),
      readResult: (ctx, key) =>
        request(writer, { op: "read-result", ctx, key }),
      setCredential(ctx) {
        const parsed = authenticatedContextSchema.safeParse(ctx);
        if (!parsed.success) {
          return Promise.resolve(
            err({
              code: "invalid_input",
              message: "테스트 credential이 올바르지 않다",
            }),
          );
        }
        return control({ op: "set-credential", ctx: parsed.data });
      },
      revokeCredential: (credentialRef) =>
        control({ op: "revoke-credential", credentialRef }),
      inspect: (query, params = []) =>
        request(writer, { op: "inspect", query, params }),
      probeWrite: (query, params = []) =>
        request(writer, { op: "probe-write", query, params }),
      close() {
        if (!closing) {
          const admitted = gate;
          closed = true;
          closing = (async () => {
            if (!cleanup) {
              await admitted;
              await Promise.all(
                channels.map((channel) => channel.request({ op: "close" })),
              );
            }
            await destroy();
          })();
        }
        return closing;
      },
    });
  } catch {
    await destroy();
    return harnessUnavailable();
  }
}

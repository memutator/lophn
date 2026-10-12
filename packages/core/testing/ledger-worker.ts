import { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "../../base/mod.ts";
import { applyMigrations } from "../storage/migration/migrations.ts";
import { authorizeConditions } from "../server/identity/mod.ts";
import { authorityTarget } from "../storage/ledger/command-outcome.ts";
import { openReaderConnection } from "../storage/ledger/reader-connection.ts";
import { executeRead, readKey } from "../storage/ledger/reads.ts";
import { openConnection } from "../storage/ledger/mod.ts";
import { serveWriter, type WorkerSelf } from "../storage/ledger/writer-loop.ts";
import type { WriterResponse } from "../storage/ledger/writer-message.ts";
import { confirmationHandleRegisterSchema } from "../../protocol/base/mod.ts";
import { assemble } from "./ledger-registration.ts";
import type { TestBoot, TestRequest } from "./ledger-types.ts";

const self = globalThis as unknown as {
  name: string;
  onmessage: ((event: MessageEvent<TestRequest>) => void) | null;
  postMessage(value: unknown): void;
  close(): void;
};
const unavailable = () =>
  err({
    code: "unavailable" as const,
    message: "테스트 Worker를 사용할 수 없다",
  });

async function start() {
  const boot: TestBoot = JSON.parse(self.name);
  const registration = await assemble(boot);
  let reader: ReturnType<typeof openReaderConnection> extends Result<infer T>
    ? T
    : never;
  let adapter: WorkerSelf | undefined;
  let complete: ((reply: WriterResponse) => void) | undefined;
  if (boot.role === "writer") {
    const migrated = await applyMigrations(boot.path, registration.steps, {
      clock: registration.clock,
    });
    if (!migrated.ok) return self.postMessage({ id: 0, result: migrated });
    let startupFailure: Result<never> | undefined;
    adapter = {
      name: JSON.stringify({ path: boot.path }),
      onmessage: null,
      close() {},
      postMessage(reply) {
        if (reply.id === 0 && reply.op === "failed") {
          startupFailure = err(reply.body);
        } else complete?.(reply);
      },
    };
    serveWriter(adapter, registration.writer);
    if (startupFailure) {
      return self.postMessage({ id: 0, result: startupFailure });
    }
  } else {
    const opened = openReaderConnection(boot.path);
    if (!opened.ok) return self.postMessage({ id: 0, result: opened });
    reader = opened.value;
  }
  let queue = Promise.resolve();
  self.onmessage = (event) => {
    // 제어 요청은 실제 serveWriter reply 뒤에만 Worker-local 상태를 바꾼다.
    queue = queue.then(async () => {
      const request = event.data;
      let result: Result<unknown>;
      try {
        result = await handle(request);
      } catch {
        result = unavailable();
      }
      try {
        self.postMessage({ id: request.id, result });
      } catch {
        self.postMessage({ id: request.id, result: unavailable() });
      }
      if (request.op === "close") self.close();
    });
  };
  self.postMessage({ id: 0, result: ok(undefined) });

  function confirmationOp(request: TestRequest): Result<unknown> {
    if (request.op !== "confirmation" || boot.role !== "writer") {
      return unavailable();
    }
    const registry = registration.confirmation;
    if (request.action === "clear") {
      registry.clear();
      return ok(undefined);
    }
    if (request.action === "close-window") {
      registry.closeWindow(request.windowId ?? "");
      return ok(undefined);
    }
    const parsed = confirmationHandleRegisterSchema.safeParse(request.request);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "확인 등록이 올바르지 않다",
      });
    }
    const issued = registry.issue(parsed.data);
    return issued.ok ? ok(issued.value) : issued;
  }

  async function writerRequest(request: TestRequest): Promise<Result<unknown>> {
    return await new Promise((resolve) => {
      complete = (reply) => {
        complete = undefined;
        resolve(
          reply.op === "closed" || reply.op === "blob-noted"
            ? ok(undefined)
            : reply.op === "failed"
            ? err(reply.body)
            : reply.body,
        );
      };
      if (
        request.op !== "command" && request.op !== "read-result" &&
        request.op !== "close"
      ) {
        complete = undefined;
        resolve(unavailable());
        return;
      }
      adapter!.onmessage!(new MessageEvent("message", { data: request }));
    });
  }
  async function handle(request: TestRequest): Promise<Result<unknown>> {
    switch (request.op) {
      case "set-credential":
        return registration.credentials.set(request.ctx);
      case "revoke-credential":
        registration.credentials.revoke(request.credentialRef);
        return ok(undefined);
      case "command":
      case "read-result":
        return adapter ? await writerRequest(request) : unavailable();
      case "confirmation":
        return confirmationOp(request);
      case "close":
        if (adapter) return await writerRequest(request);
        reader.close();
        return ok(undefined);
      case "read": {
        if (adapter) return unavailable();
        const current = registration.checkCredential(request.ctx);
        if (!current.ok) return current;
        const definition = registration.reads.get(readKey(request.route));
        if (!definition) {
          return err({ code: "not_found", message: "등록되지 않은 read다" });
        }
        const run = request.ctx.run ?? current.value.conditions.run;
        const ctx = run === undefined
          ? current.value
          : { ...current.value, run };
        const allowed = authorizeConditions(
          ctx,
          definition.read.route.name,
          authorityTarget(ctx, run),
        );
        if (!allowed.ok) return allowed;
        return executeRead(
          reader,
          definition.read,
          definition.ports,
          ctx,
          request.input,
        );
      }
      case "inspect": {
        if (!adapter) return unavailable();
        const db = new DatabaseSync(boot.path, { readOnly: true });
        try {
          db.exec("pragma query_only=ON; begin");
          const statement = db.prepare(request.query);
          statement.setReadBigInts(true);
          return ok(statement.all(...request.params));
        } finally {
          if (db.isTransaction) db.exec("rollback");
          db.close();
        }
      }
      case "probe-write": {
        if (!adapter) return unavailable();
        const opened = openConnection(boot.path);
        if (!opened.ok) return opened;
        const connection = opened.value;
        try {
          connection.exec("begin immediate");
          return ok(connection.sql.run(request.query, request.params));
        } catch {
          return err({
            code: "invalid_input",
            message: "테스트 write probe가 거절됐다",
          });
        } finally {
          try {
            if (connection.inTransaction()) connection.exec("rollback");
          } finally {
            connection.close();
          }
        }
      }
    }
  }
}

void start().catch(() => self.postMessage({ id: 0, result: unavailable() }));

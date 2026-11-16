// The guest half of an app that runs on the phone: its backend.js runs in its screen's guest after the base. The base
// calls installLocalBackend before backend.js evaluates; it installs the backend host (handler port, CAP_HOST with the
// app database, random) and gives the bridge the runner for read and write operations. Each local call is one
// transaction: modules/lophn-app-db's endCall writes the call's changeset to the outbox in that transaction and commits.
// No React Native here: guest/base.ts passes the native handle, the tests a node:sqlite stand-in.
import { createIdSource } from "../../../../base/id.ts";
import {
  installPhoneBackendHost,
  type PhoneStoreDb,
} from "../../../../protocol/apps/phone-backend-host.ts";
import type { GuestAppDb } from "../../../modules/lophn-app-db/index.ts";
import type { Bridge, LocalRun } from "../../../guest/bridge.ts";

// A local call holds the file's write lock until it ends, and the host's own writes give up after their 5 s busy
// timeout. A call still running after this is rolled back and fails `unavailable`. Only an `await` lets the limit
// fire; one long statement is stopped by the module's own 5 s limit.
export const LOCAL_CALL_LIMIT_MS = 3000;

// The same mark and codes as @lophn/cap-tool's HandlerRejection (packages/sdk/cap-tool/rejection.ts).
const APP_TOOL_REJECTION = Symbol.for("lophn.app-tool-rejection");
const REJECTION_CODES = ["invalid_input", "forbidden", "conflict", "unavailable"];

const messageOf = (thrown: unknown) => (thrown instanceof Error ? thrown.message : String(thrown));

function failure(thrown: unknown): Error {
  const mark =
    thrown !== null && typeof thrown === "object"
      ? (thrown as Record<symbol, unknown>)[APP_TOOL_REJECTION]
      : undefined;
  const code = typeof mark === "string" && REJECTION_CODES.includes(mark) ? mark : "internal";
  return new Error(`${code}: ${messageOf(thrown)}`);
}

export function installLocalBackend(
  global: object,
  db: GuestAppDb,
  bridge: Pick<Bridge, "init" | "send" | "runLocal">,
  limitMs = LOCAL_CALL_LIMIT_MS,
): void {
  // The database answers only inside a call: a write outside one would commit without an outbox row, and sync would
  // never see it.
  let open = false;
  const guard = () => {
    if (!open) throw new Error("the app database is open only while an operation runs");
  };
  const store: PhoneStoreDb = {
    exec(sql) {
      guard();
      db.exec(sql);
    },
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        get: (...params) => (guard(), statement.get(params)),
        all: (...params) => (guard(), statement.all(params)),
        run: (...params) => (guard(), statement.run(params)),
      };
    },
  };
  const randomBytes = (bytes: Uint8Array) => bytes.set(db.randomBytes(bytes.length));
  const host = installPhoneBackendHost(global, {
    open: () => store,
    // The phone host migrated the file before the guest mounted, so there are no steps; `store.migrate()` only checks.
    migrations: () => {
      const local = bridge.init()?.local;
      if (!local) throw new Error("unavailable: the app has not started yet");
      return { target: local.data_schema, steps: [] };
    },
    randomBytes,
  });
  const ids = createIdSource({
    clock: { now: () => new Date().toISOString(), nowMs: () => Date.now() },
    random: { fill: randomBytes },
  });

  // `free` lets the next call begin. It runs once the call's transaction has ended, or, after the time limit, once the
  // late handler settles, so nothing it still does lands in the next call's transaction.
  async function run(operation: string, input: unknown, free: () => void): Promise<unknown> {
    const started_at = new Date().toISOString();
    // A bare ULID: the sync routes take the phone's change id without a prefix.
    const id = ids.newId("chg").slice(4);
    try {
      db.beginCall();
    } catch (thrown) {
      free();
      throw new Error(`unavailable: ${messageOf(thrown)}`);
    }
    open = true;
    const settled = host
      .run(operation, input, {
        app: "",
        release: null,
        mode: "live",
        invocation: id,
        kind: "operation",
        name: operation,
        // The SDK's computer-only paths (cap-net, the broker) go to CAP_HOST.post, which answers `unavailable` here,
        // only inside a handler with an input hash. Core computes that hash; the phone has none to give.
        inputHash: "",
        caller: null,
      })
      .then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<"late">((resolve) => {
      timer = setTimeout(() => resolve("late"), limitMs);
    });
    const outcome = await Promise.race([settled, late]);
    clearTimeout(timer);
    open = false;
    // abortCall throws only when the host already closed the file, which rolled the call back.
    const abort = () => {
      try {
        db.abortCall();
      } catch {}
    };
    if (outcome === "late") {
      void settled.then(free);
      abort();
      throw new Error(`unavailable: ${operation} did not finish within ${limitMs} ms`);
    }
    let bytes: number;
    try {
      bytes = db.endCall({ id, operation, started_at }).bytes;
    } catch (thrown) {
      abort();
      throw new Error(`internal: ${messageOf(thrown)}`);
    } finally {
      free();
    }
    if (bytes > 0) {
      if (bridge.init()?.local?.operations[operation] === "read") {
        console.warn(`read operation ${operation} changed app data; the change is kept as a write`);
      }
      bridge.send({ type: "local_change" });
    }
    if (!outcome.ok) throw failure(outcome.error);
    // What the screen gets is JSON, as from the computer.
    try {
      return JSON.parse(JSON.stringify(outcome.value ?? null));
    } catch {
      throw new Error(`internal: the result of ${operation} is not JSON`);
    }
  }

  let queue: Promise<void> = Promise.resolve();
  const runLocal: LocalRun = (operation, input) => {
    const turn = queue;
    let free!: () => void;
    queue = new Promise<void>((resolve) => {
      free = resolve;
    });
    return turn.then(() => run(operation, input, free));
  };
  bridge.runLocal(runLocal);
}

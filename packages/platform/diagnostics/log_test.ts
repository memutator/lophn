import { assert, assertEquals } from "@std/assert";
import {
  type Diagnostic,
  DIAGNOSTICS_WRITE_OP,
} from "../../contracts/platform/mod.ts";
import {
  createDiagnosticHost,
  createDiagnosticIngress,
  createSafeLog,
  LOG_LEVEL,
} from "./mod.ts";

const at = "2026-10-04T00:00:00.000Z";
export const diagnostic: Diagnostic = {
  type: "diagnostic",
  kind: "lophn_internal",
  payload: {
    component: "platform/core",
    observed_at: at,
    error_class: "internal_exception",
    location: "core.command",
    count: 1,
  },
};
const catalog = {
  components: ["platform/core"],
  locations: { "core.command": "core/command" },
};
const authority = () => ({
  principal: "core",
  process: "core-process",
  task: "diagnostics",
  scope: [DIAGNOSTICS_WRITE_OP],
  permits: (value: Diagnostic) => value.payload.component === "platform/core",
});
function request(records: Diagnostic[] = [diagnostic]) {
  return {
    type: "worker_request",
    request_id: "request",
    op: DIAGNOSTICS_WRITE_OP,
    payload: { records, dropped: 0 },
  };
}

Deno.test("platform/diagnostics#R2 platform/redaction#R15 fixed descriptions and omission discard raw fields and IDs", async () => {
  const output: string[] = [];
  const log = createSafeLog({
    catalog,
    sink: (bytes) => {
      output.push(new TextDecoder().decode(bytes));
      return Promise.resolve();
    },
  });
  try {
    const ingress = createDiagnosticIngress({
      currentAuthority: authority,
      log,
    });
    assert(ingress.accept(request()).ok);
    assertEquals(
      ingress.accept(
        request([
          {
            ...diagnostic,
            payload: {
              ...diagnostic.payload,
              message: "token secret stdout HTTP dump crash memory reasoning",
            },
          } as Diagnostic,
        ]),
      ).ok,
      false,
    );
    assert(
      log.admit({
        type: "diagnostic",
        kind: "shell_view_lifetime",
        payload: {
          component: "platform/core",
          observed_at: at,
          view_id: "credential-secret",
          generation: 0,
          created: 1,
          hidden: 0,
          replaced: 0,
          disposed: 0,
          attached: 1,
        },
      }),
    );
    for (const location of ["unregistered", "constructor"]) {
      assertEquals(
        log.admit({
          ...diagnostic,
          payload: { ...diagnostic.payload, location },
        }),
        false,
      );
    }
    await log.flush();
    assertEquals(output.length, 2);
    assert(!output.join("").includes("credential-secret"));
    const record = JSON.parse(output[0]);
    assertEquals(record.location, "core/command");
    assertEquals(record.redaction.omissions[0].reason, "private");
    assertEquals(record.message, "Platform internal failure observed.");
  } finally {
    log.close();
  }
});

Deno.test("platform/diagnostics#R3 queue plus in-flight is bounded and immutable; sink failure counted", async () => {
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => release = resolve);
  const output: string[] = [];
  const log = createSafeLog({
    catalog,
    sink: async (bytes) => {
      output.push(new TextDecoder().decode(bytes));
      await blocked;
      throw new Error("private path token");
    },
  });
  try {
    const value = structuredClone(diagnostic);
    assert(log.admit(value));
    value.payload.observed_at = "private";
    await Promise.resolve();
    for (let i = 0; i < 5000; i++) log.admit(diagnostic);
    assert(log.pendingBytes <= 1024 * 1024);
    assert(log.dropped > 0);
    assertEquals(JSON.parse(output[0]).at, at);
    const lost = log.dropped;
    log.close();
    release();
    await log.flush();
    assert(log.dropped > lost);
    assertEquals(log.pendingBytes, 0);
    let observed = false;
    const rejected = createSafeLog({
      catalog,
      sink: () => {
        observed = true;
        return Promise.reject("secret");
      },
    });
    rejected.admit(diagnostic);
    await rejected.flush();
    assert(observed);
    assertEquals(rejected.dropped, 1);
    rejected.close();
  } finally {
    release();
    log.close();
    await log.flush();
  }
});

Deno.test("platform/diagnostics#R11 default info and strict loss count", () => {
  assertEquals(LOG_LEVEL, "info");
  const log = createSafeLog({ catalog, sink: async () => {} });
  try {
    for (const count of [-1, 0.5, Infinity, NaN]) {
      let rejected = false;
      try {
        log.noteDropped(count);
      } catch {
        rejected = true;
      }
      assert(rejected);
    }
    log.noteDropped(10);
    assertEquals(log.dropped, 10);
  } finally {
    log.close();
  }
});

Deno.test("platform/diagnostics#R2 host current authority fails closed and revocation is checked", async () => {
  const log = createSafeLog({ catalog, sink: async () => {} });
  try {
    for (
      const currentAuthority of [
        () => undefined,
        () => ({ ...authority(), scope: [] }),
        () => ({ ...authority(), permits: () => false }),
        () => {
          throw Error("secret");
        },
      ]
    ) {
      assertEquals(
        createDiagnosticIngress({ log, currentAuthority }).accept(request()).ok,
        false,
      );
    }
    const ingress = createDiagnosticIngress({
      log,
      currentAuthority: authority,
    });
    assertEquals(ingress.accept({ ...request(), channel: 1 }).ok, false);
    let granted = true;
    let sent = 0;
    const host = createDiagnosticHost({
      currentAuthority: () => granted ? authority() : undefined,
      send: () => {
        sent++;
        return Promise.resolve();
      },
      nextRequestId: () => "request",
    });
    host.publish([diagnostic]);
    granted = false;
    await Promise.resolve();
    await Promise.resolve();
    assertEquals(sent, 0);
    assertEquals(host.dropped, 1);
    host.close();
  } finally {
    log.close();
    await log.flush();
  }
});

Deno.test("platform/diagnostics#R3 unavailable and never-response host never blocks caller and bounds all bytes", async () => {
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => release = resolve);
  const host = createDiagnosticHost({
    currentAuthority: authority,
    send: () => blocked,
    nextRequestId: () => "request",
  });
  try {
    host.publish([diagnostic]);
    await Promise.resolve();
    for (let i = 0; i < 5000; i++) host.publish([diagnostic]);
    assert(host.pendingBytes <= 1024 * 1024);
    assert(host.dropped > 0);
    host.close();
    release();
    await Promise.resolve();
    await Promise.resolve();
    assertEquals(host.pendingBytes, 0);
    const failed = createDiagnosticHost({
      currentAuthority: authority,
      send: () => Promise.reject("credential"),
      nextRequestId: () => "failed",
    });
    failed.publish([diagnostic]);
    await Promise.resolve();
    await Promise.resolve();
    assertEquals(failed.dropped, 1);
    failed.close();
  } finally {
    host.close();
    release();
  }
});

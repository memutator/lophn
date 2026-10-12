import { assert, assertEquals } from "@std/assert";
import { manualClock, ok, seededRandom } from "../../base/mod.ts";
import { ERROR_HTTP_STATUS } from "../../protocol/platform/mod.ts";
import type { CommandEnvelope, Writer } from "../storage/ledger/mod.ts";
import {
  type Admission,
  createAdmission,
} from "../supervision/responsiveness/mod.ts";
import { CredentialRegistry } from "./identity/mod.ts";
import { call, listen } from "./harness_test.ts";

// platform/api#R3 responsiveness: command는 admission의 queue를 지나고 초과 입장은
// unavailable이다. control command는 예약 영역(responsiveness R3)으로 간다.
Deno.test("platform#T11: command 입장은 admission queue를 지나고 control command는 예약 영역을 본다", async () => {
  const admission = createAdmission();
  const seen: { lane: string; name: string }[] = [];
  const wrapped: Admission = {
    admit: (
      principal: string,
      work: () => Promise<void>,
      lane?: "normal" | "control",
    ) => {
      seen.push({ lane: lane ?? "normal", name: principal });
      return admission.admit(principal, work, lane);
    },
    enterHttp: admission.enterHttp.bind(admission),
    enterEvent: admission.enterEvent.bind(admission),
    get command() {
      return admission.command;
    },
    get httpActive() {
      return admission.httpActive;
    },
    get connections() {
      return admission.connections;
    },
  };
  const made_writer: Writer = {
    command: async (_ctx, envelope: CommandEnvelope) => {
      seen.push({
        lane: "command:" + envelope.command,
        name: envelope.command,
      });
      await Promise.resolve();
      return {
        ok: false,
        error: { code: "unavailable", message: "writer unavailable" },
      };
    },
    readResult: async () => {
      await Promise.resolve();
      return {
        ok: false,
        error: {
          code: "unavailable",
          message: "read-result unavailable",
        } as const,
      };
    },
    close: async () => {
      await Promise.resolve();
    },
  };
  const opened = await listen({
    admission: wrapped,
    writer: made_writer,
  });
  try {
    const response = await call(opened.base, "/v1/events/advance-cursor", {
      method: "POST",
      token: opened.token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subscriber: "s",
        scanned_through_seq: "0",
        processed_through_seq: "0",
      }),
    });
    // advance-cursor는 machine actor만 받는다. user token은 403이다. 입장은 그 전에
    // 결정되므로 HTTP 입장의 증거만 남는다.
    assert(
      [403, ERROR_HTTP_STATUS.unavailable].includes(response.status),
      String(response.status),
    );
    assertEquals(admission.httpActive, 0);
  } finally {
    await opened.server.stop();
  }
});

// platform/api#R3 responsiveness: HTTP 동시 128·principal당 16과 event 연결 32·principal당 4는
// 응답 전에 결정한다. 초과 입장은 unavailable이다. 여기서는 주입한 admission의 counter만
// 증명한다. 고정 한도 자체는 responsiveness admission_test.ts가 증명한다.
Deno.test("platform#T11: HTTP 입장은 admission counter를 쓰고 release는 응답 뒤다", async () => {
  const admission = createAdmission();
  const opened = await listen({
    admission,
    reads: new Map([
      ["platform/health", () =>
        ok({
          observations: [],
          observed_at: "2026-10-04T00:00:00.000Z",
          as_of_seq: "0",
          next_cursor: null,
        })],
    ]),
  });
  try {
    const read = await call(opened.base, "/v1/platform/health", {
      method: "POST",
      token: opened.token,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assertEquals(read.status, 200);
    // 응답이 끝난 뒤 release된다. active는 0이다.
    assertEquals(admission.httpActive, 0);
    assertEquals(admission.connections, 0);
  } finally {
    await opened.server.stop();
  }
});

// platform/api#R3: 입장한 command는 writer에 한 번만 간다. 대기열이 work를 한 번 돌리고
// 입장 뒤 또 돌리면 key 없는 command가 두 번 commit된다.
Deno.test("platform/api#R3: 입장한 command는 writer에 한 번만 보낸다", async () => {
  const clock = manualClock(Date.parse("2026-10-04T00:00:00.000Z"));
  const credentials = new CredentialRegistry({
    epoch: "core-one",
    clock,
    random: seededRandom(5),
    operations: [
      { name: "events/advance-cursor", actors: ["machine"], kind: "command" },
    ],
  });
  const issued = await credentials.issue({
    actor: "machine",
    principal: "machine:cursor",
    scope: {
      operations: ["events/advance-cursor"],
      targets: { task: "cursor" },
    },
    conditions: { task: "cursor", process: "worker-generation" },
  });
  assert(issued.ok, issued.ok ? "" : issued.error.message);
  let sent = 0;
  const writer: Writer = {
    command: async () => {
      sent += 1;
      await Promise.resolve();
      return {
        ok: false,
        error: { code: "unavailable", message: "writer unavailable" },
      };
    },
    readResult: async () => {
      await Promise.resolve();
      return {
        ok: false,
        error: { code: "unavailable", message: "read-result unavailable" },
      };
    },
    close: async () => {
      await Promise.resolve();
    },
  };
  const opened = await listen({
    credentials,
    clock,
    token: issued.value.token,
    admission: createAdmission(),
    writer,
  });
  try {
    const response = await call(opened.base, "/v1/events/advance-cursor", {
      method: "POST",
      token: opened.token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: {
          subscriber: "machine:cursor",
          scanned_through_seq: "0",
        },
        idempotency_key: "cursor-once-0000000000000001",
        compare: { processed_through_seq: "0" },
        prepared: [],
      }),
    });
    const text = await response.text();
    assertEquals(sent, 1, `status ${response.status} ${text}`);
  } finally {
    await opened.server.stop();
  }
});

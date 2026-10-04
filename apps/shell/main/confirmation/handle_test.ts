import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConfirmationHandleRegister } from "../../../../packages/contracts/platform/mod.ts";

import {
  contentBasis,
  type CoreHandlePort,
  earlierDeadline,
  HANDLE_TTL_MS,
  HandleTable,
} from "./handle.ts";

const REF = "A".repeat(43);

function port(log: string[]): CoreHandlePort {
  return {
    register: (request) => {
      log.push(`register:${request.window_id}`);
      return Promise.resolve({
        ok: true,
        confirmation: REF,
        expiresAt: request.expires_at,
      });
    },
    closeWindow: (windowId) => {
      log.push(`close:${windowId}`);
      return Promise.resolve();
    },
    clear: () => {
      log.push("clear");
      return Promise.resolve();
    },
  };
}

test("shell/confirmation-window#R9: handle 원문은 표에만 있고 displayId로만 찾는다", () => {
  const table = new HandleTable();
  table.remember({
    ref: REF,
    windowId: "win-1",
    displayId: "dsp_1",
    targetRef: "apr_00000000000000000000000000",
    contentHash: "ab",
    allowed: ["grant_approval_request"],
    epoch: "epoch-1",
    expiresAtMs: 1_000,
    spent: false,
    unknown: false,
  });
  const found = table.find("dsp_1");
  assert.equal(found?.ref, REF);
  assert.equal(table.find("other"), undefined);
  const exposed = JSON.stringify({ displayId: found?.displayId });
  assert.equal(exposed.includes(REF), false);
});

test("shell/confirmation-window#R9: 창을 닫으면 그 창의 handle만 지운다", () => {
  const table = new HandleTable();
  const base = {
    ref: REF,
    targetRef: "t",
    contentHash: "h",
    allowed: ["grant_approval_request"],
    epoch: "e",
    expiresAtMs: 1,
    spent: false,
    unknown: false,
  };
  table.remember({ ...base, windowId: "win-1", displayId: "a" });
  table.remember({
    ...base,
    ref: "B".repeat(43),
    windowId: "win-2",
    displayId: "b",
  });
  assert.equal(table.drop("a")?.windowId, "win-1");
  assert.equal(table.find("a"), undefined);
  assert.equal(table.find("b")?.windowId, "win-2");
});

test("shell/confirmation-window#R9: core epoch가 바뀌면 옛 handle을 버린다", () => {
  const table = new HandleTable();
  table.remember({
    ref: REF,
    windowId: "win-1",
    displayId: "a",
    targetRef: "t",
    contentHash: "h",
    allowed: ["grant_approval_request"],
    epoch: "old",
    expiresAtMs: 1,
    spent: false,
    unknown: false,
  });
  table.dropEpoch("next");
  assert.equal(table.find("a"), undefined);
});

test("shell/confirmation-window#R9: 기한은 120초와 대상 기한 중 이른 시각이다", () => {
  const now = 1_000_000;
  const sooner = new Date(now + 10_000).toISOString();
  assert.equal(earlierDeadline(now, sooner), now + 10_000);
  assert.equal(earlierDeadline(now, null), now + HANDLE_TTL_MS);
  assert.equal(earlierDeadline(now, new Date(now - 1).toISOString()), null);
});

test("shell/confirmation-window#R9: 등록 메시지는 창·대상·내용 hash·허용 결정·기한을 묶는다", async () => {
  const log: string[] = [];
  const request: ConfirmationHandleRegister = {
    type: "confirmation_handle_register",
    window_id: "win-1",
    target_ref: "apr_00000000000000000000000000",
    content_hash: contentBasis({
      binding_hash: "b".repeat(64),
      approval: "apr_00000000000000000000000000",
      created_seq: "1",
    }),
    allowed_decisions: ["grant_approval_request", "reject_approval_request"],
    expires_at: new Date(Date.now() + 1000).toISOString(),
  };
  const issued = await port(log).register(request);
  assert.equal(issued.ok, true);
  if (issued.ok) assert.equal(issued.confirmation.length, 43);
  assert.deepEqual(log, ["register:win-1"]);
  assert.equal(request.content_hash.length, 64);
  const swapped = contentBasis({
    created_seq: "1",
    approval: "apr_00000000000000000000000000",
    binding_hash: "b".repeat(64),
  });
  assert.equal(swapped, request.content_hash);
});

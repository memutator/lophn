import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../../base/mod.ts";
import {
  CONFIRMATION_HANDLE_TTL_MS,
  type ConfirmationHandleRegister,
} from "../../../protocol/server/mod.ts";
import { confirmationBinding } from "./confirmation-binding.ts";
import { ConfirmationRegistry } from "./confirmation.ts";
import { consumeRouteConfirmation } from "./confirmation-route.ts";
import { confirmationBridge } from "./confirmation-bridge.ts";

const START = Date.parse("2026-01-01T00:00:00.000Z");
const HASH = "ab".repeat(32);
const LATER = new Date(START + 600_000).toISOString();

function registry(clock = manualClock(START)) {
  const random = seededRandom(7);
  return {
    clock,
    registry: new ConfirmationRegistry({
      clock,
      random: (bytes) => random.fill(bytes),
    }),
  };
}

function request(
  over: Partial<ConfirmationHandleRegister> = {},
): ConfirmationHandleRegister {
  return {
    type: "confirmation_handle_register",
    window_id: "win-1",
    target_ref: "cac_01arz3ndektsv4rrffq69g5fav",
    content_hash: HASH,
    allowed_decisions: ["grant"],
    expires_at: LATER,
    ...over,
  };
}

Deno.test("platform/identity#R14: handle은 창·대상·내용·결정·120초에 묶인 메모리 값이고 원문을 돌려주지 않는다", () => {
  const { registry: handles } = registry();
  const issued = handles.issue(request());
  assert(issued.ok);
  assertEquals(issued.value.confirmation.length, 43);
  assertEquals(
    issued.value.expires_at,
    new Date(START + CONFIRMATION_HANDLE_TTL_MS).toISOString(),
  );
  const sooner = handles.issue(request({
    expires_at: new Date(START + 30_000).toISOString(),
  }));
  assert(sooner.ok);
  assertEquals(sooner.value.expires_at, new Date(START + 30_000).toISOString());
  assert(issued.value.confirmation !== sooner.value.confirmation);
});

Deno.test("platform/identity#R14: 이미 지난 기한과 지난 대상 기한은 발급하지 않는다", () => {
  const { registry: handles } = registry();
  const expired = handles.issue(request({
    expires_at: new Date(START - 1).toISOString(),
  }));
  assert(!expired.ok);
  assertEquals(expired.error.code, "invalid_input");
});

Deno.test("platform/approvals#R5: 다른 대상·다른 내용·다른 결정은 거절하고 같은 확인은 한 번만 소비한다", () => {
  const { registry: handles } = registry();
  const issued = handles.issue(request());
  assert(issued.ok);
  const use = {
    ref: issued.value.confirmation,
    decision: "grant",
    binding: { target: request().target_ref, content: HASH },
  };
  assert(!handles.reserve({ ...use, decision: "reject" }).ok);
  assert(
    !handles.reserve({
      ...use,
      binding: { ...use.binding, target: "other" },
    }).ok,
  );
  assert(
    !handles.reserve({
      ...use,
      binding: { ...use.binding, content: "cd".repeat(32) },
    }).ok,
  );
  assert(handles.reserve(use).ok);
  assertEquals(handles.reserve(use).ok, false);
  handles.consume(use.ref);
  assert(!handles.reserve(use).ok);
});

Deno.test("platform/approvals#R4: 창 닫기·연결 종료는 handle을 무효로 하고 침묵은 결정이 아니다", () => {
  const { registry: handles } = registry();
  const first = handles.issue(request());
  const second = handles.issue(request({ window_id: "win-2" }));
  assert(first.ok && second.ok);
  handles.closeWindow("win-1");
  const closed = handles.reserve({
    ref: first.value.confirmation,
    decision: "grant",
    binding: { target: request().target_ref, content: HASH },
  });
  assert(!closed.ok);
  assert(
    handles.reserve({
      ref: second.value.confirmation,
      decision: "grant",
      binding: { target: request().target_ref, content: HASH },
    }).ok,
  );
  handles.clear();
  assert(
    !handles.reserve({
      ref: second.value.confirmation,
      decision: "grant",
      binding: { target: request().target_ref, content: HASH },
    }).ok,
  );
});

Deno.test("platform/approvals#R7: 기한이 지나면 소비하지 않고 끝난 handle은 commit 실패로 되살리지 않는다", () => {
  const { clock, registry: handles } = registry();
  const issued = handles.issue(request());
  assert(issued.ok);
  const use = {
    ref: issued.value.confirmation,
    decision: "grant",
    binding: { target: request().target_ref, content: HASH },
  };
  assert(handles.reserve(use).ok);
  clock.advance(CONFIRMATION_HANDLE_TTL_MS);
  handles.release(use.ref);
  assert(!handles.reserve(use).ok);
});

Deno.test("platform/ledger#R13: commit 실패는 살아 있는 handle의 예약만 푼다", () => {
  const { registry: handles } = registry();
  const issued = handles.issue(request());
  assert(issued.ok);
  const use = {
    ref: issued.value.confirmation,
    decision: "grant",
    binding: { target: request().target_ref, content: HASH },
  };
  assert(handles.reserve(use).ok);
  handles.release(use.ref);
  assert(handles.reserve(use).ok);
  handles.consume(use.ref);
  handles.release(use.ref);
  assert(!handles.reserve(use).ok);
});

Deno.test("platform/ledger#R22: ledger 없는 route는 대상이 맞을 때만 메모리에서 소비하고 실패는 넘기지 않는다", async () => {
  const { registry: handles } = registry();
  const bridge = confirmationBridge(handles);
  const route = {
    confirmation: "required" as const,
    binding: ["path", "base_hash"],
    name: "files.delete",
  };
  const input = { path: "notes/a.md", base_hash: HASH, operation: "delete" };
  const binding = await confirmationBinding(route, input);
  assert(binding);
  const issued = handles.issue(request({
    target_ref: binding.target,
    content_hash: binding.content,
    allowed_decisions: ["files.delete"],
  }));
  assert(issued.ok);
  const wrong = await consumeRouteConfirmation(
    bridge,
    route,
    { ...input, base_hash: "cd".repeat(32) },
    issued.value.confirmation,
  );
  assert(!wrong.ok);
  const consumed = await consumeRouteConfirmation(
    bridge,
    route,
    input,
    issued.value.confirmation,
  );
  assert(consumed.ok);
  const again = await consumeRouteConfirmation(
    bridge,
    route,
    input,
    issued.value.confirmation,
  );
  assert(!again.ok);
});

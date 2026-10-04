import { assert, assertEquals } from "@std/assert";
import { formatAt } from "@lophn/base";
import { REPORT_RETRY_DELAYS_MS } from "@lophn/contracts/problems/sdk-report";
import type {
  ExceptionObservationInput,
  ExceptionObserverTransport,
  ReportAcceptance,
} from "@lophn/contracts/problems/sdk-report";
import { createExceptionObserver } from "./exception-observer.ts";

const START = Date.parse("2026-10-04T12:00:00.000Z");

function idSource() {
  let n = 0;
  return (prefix: string) => {
    n += 1;
    return `${prefix}_${n.toString(36).padStart(26, "0")}`;
  };
}

const acceptance: ReportAcceptance = {
  report: "rpt_00000000000000000000000001",
  snapshot: "snp_00000000000000000000000001",
  problem: null,
  diagnostic_scope: "scope-test",
};

function observer(
  transport: ExceptionObserverTransport,
  sleeps: number[] = [],
) {
  const target = new EventTarget();
  const observe = createExceptionObserver({
    now: () => formatAt(START),
    newId: idSource(),
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    currentInvocation: () => null,
    target,
  });
  const uninstall = observe(transport);
  const installed = { uninstall, completion: observe.completion };
  return { target, installed };
}

Deno.test("problems/reporting#R5: error와 unhandledrejection을 관측 ID를 먼저 정해 보내고 preventDefault하지 않는다", async () => {
  const seen: ExceptionObservationInput[] = [];
  const { target, installed } = observer((input) => {
    seen.push(input);
    return Promise.resolve({ ok: true, value: acceptance });
  });
  const failure = new TypeError("boom");
  const errorEvent = new ErrorEvent("error", {
    error: failure,
    cancelable: true,
  });
  target.dispatchEvent(errorEvent);
  assertEquals(errorEvent.defaultPrevented, false);
  const rejection = new PromiseRejectionEvent("unhandledrejection", {
    promise: Promise.resolve(),
    reason: "plain string",
    cancelable: true,
  });
  target.dispatchEvent(rejection);
  assertEquals(rejection.defaultPrevented, false);

  assertEquals(seen.length, 2);
  assertEquals(seen[0].observation, "error");
  assertEquals(seen[0].report_id, "rpt_00000000000000000000000001");
  assertEquals(seen[0].error?.name, "TypeError");
  assertEquals(seen[0].error?.message, "boom");
  assert(typeof seen[0].error?.stack === "string");
  assertEquals(seen[0].error?.message_missing_reason, null);
  assertEquals(seen[0].error?.stack_missing_reason, null);
  assertEquals(seen[0].error_missing_reason, null);
  assertEquals(seen[1].observation, "unhandledrejection");
  assert(seen[1].report_id !== seen[0].report_id);
  assertEquals(seen[1].error?.name, "UnknownError");
  assertEquals(seen[1].error?.message, "plain string");
  assertEquals(seen[1].error?.message_missing_reason, null);
  assertEquals(seen[1].error?.stack, null);
  assertEquals(seen[1].error?.stack_missing_reason, { reason: "not a string" });

  const completion = installed.completion(seen[0].report_id);
  assert(completion);
  assertEquals(await completion, { status: "accepted", acceptance });
  installed.uninstall();
});

Deno.test("problems/reporting#R5: 해제한 observer는 더 이상 잡지 않고 원래 실패를 숨기지 않는다", () => {
  const seen: ExceptionObservationInput[] = [];
  const { target, installed } = observer((input) => {
    seen.push(input);
    return Promise.resolve({ ok: true, value: acceptance });
  });
  installed.uninstall();
  const event = new ErrorEvent("error", {
    error: new Error("after"),
    cancelable: true,
  });
  target.dispatchEvent(event);
  assertEquals(event.defaultPrevented, false);
  assertEquals(seen, []);
});

Deno.test("problems/reporting#R5: observer는 오류 원본 객체를 저장하지 않고 이름·message·stack만 보낸다", () => {
  const seen: ExceptionObservationInput[] = [];
  const secret = { token: "raw-secret" };
  const failure = new Error("visible");
  Object.assign(failure, secret);
  const { target } = observer((input) => {
    seen.push(structuredClone(input));
    return Promise.resolve({ ok: true, value: acceptance });
  });
  target.dispatchEvent(new ErrorEvent("error", { error: failure }));
  const encoded = JSON.stringify(seen[0]);
  assert(!encoded.includes("raw-secret"));
  assert(!encoded.includes("token"));
  assertEquals(Object.keys(seen[0].error ?? {}).sort(), [
    "message",
    "message_missing_reason",
    "name",
    "stack",
    "stack_missing_reason",
  ]);
});

Deno.test("problems/reporting#R16: observer 전송도 같은 retry 간격을 쓴다", async () => {
  const sleeps: number[] = [];
  let calls = 0;
  const { target, installed } = observer((input) => {
    calls += 1;
    void input;
    return Promise.reject(new Error("dropped"));
  }, sleeps);
  const event = new ErrorEvent("error", {
    error: new Error("again"),
    cancelable: true,
  });
  target.dispatchEvent(event);
  assertEquals(event.defaultPrevented, false);
  const completion = installed.completion("rpt_00000000000000000000000001");
  assert(completion);
  assertEquals((await completion).status, "failed");
  assertEquals(calls, 4);
  assertEquals(sleeps, [...REPORT_RETRY_DELAYS_MS]);
});

Deno.test("problems/reporting#R5: message·stack이 없으면 missing reason을 남긴다", () => {
  const seen: ExceptionObservationInput[] = [];
  const { target } = observer((input) => {
    seen.push(input);
    return Promise.resolve({ ok: true, value: acceptance });
  });
  const failure = new Error(" ");
  Object.defineProperty(failure, "stack", { value: undefined });
  target.dispatchEvent(new ErrorEvent("error", { error: failure }));
  assertEquals(seen[0].error?.message, " ");
  assertEquals(seen[0].error?.message_missing_reason, null);
  assertEquals(seen[0].error?.stack, null);
  assertEquals(seen[0].error?.stack_missing_reason, { reason: "not a string" });
});

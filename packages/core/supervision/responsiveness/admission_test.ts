import { assert, assertEquals } from "@std/assert";
import {
  COMMAND_ADMISSION_PRINCIPAL,
  COMMAND_ADMISSION_TOTAL,
  COMMAND_CONTROL_RESERVED,
  createAdmission,
  EVENT_CONNECTION_PRINCIPAL,
  EVENT_CONNECTION_TOTAL,
  HTTP_CONCURRENT_PRINCIPAL,
  HTTP_CONCURRENT_TOTAL,
} from "./mod.ts";

function gate() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

Deno.test("platform/responsiveness#R3: command 입장은 전체 256·principal당 64이고 초과는 거절이다", async () => {
  const admission = createAdmission();
  const gates = [gate(), gate()];
  try {
    // 256개의 실행 슬롯을 모두 gate로 막아 둔다.
    for (let i = 0; i < COMMAND_ADMISSION_TOTAL; i++) {
      assert(
        await admission.admit("hold", () => gates[i % 2].promise, "control"),
      );
    }
    assertEquals(admission.command.active, COMMAND_ADMISSION_TOTAL);
    assertEquals(admission.command.queued, 0);
    // principal당 64까지는 대기한다. 슬롯이 가득 차 있으므로 대기 약속은 그대로 둔다.
    const queued: Promise<boolean>[] = [];
    for (let i = 0; i < COMMAND_ADMISSION_PRINCIPAL; i++) {
      queued.push(admission.admit("a", () => Promise.resolve()));
    }
    assertEquals(admission.command.queued, COMMAND_ADMISSION_PRINCIPAL);
    // 65번째는 principal 한도로 거절이다.
    assertEquals(await admission.admit("a", () => Promise.resolve()), false);
    // 전체에서 예약을 뺀 자리까지 차면 일반 입장은 거절이다(caller priority 없음).
    const normalLimit = COMMAND_ADMISSION_TOTAL - COMMAND_CONTROL_RESERVED;
    for (let i = 0; i < normalLimit - COMMAND_ADMISSION_PRINCIPAL; i++) {
      queued.push(
        admission.admit(
          `p-${Math.floor(i / 16)}-${i % 16}`,
          () => Promise.resolve(),
        ),
      );
    }
    assertEquals(admission.command.queued, normalLimit);
    assertEquals(
      await admission.admit("overflow", () => Promise.resolve()),
      false,
    );
    // gate가 풀리면 대기자가 잘리지 않고 차례로 들어간다.
    gates.forEach((item) => item.resolve());
    const results = await Promise.all(queued);
    assert(results.every(Boolean));
  } finally {
    gates.forEach((item) => item.resolve());
  }
});

Deno.test(
  "platform/responsiveness#R3: 회수·정지 제어는 예약 영역으로 입장한다",
  async () => {
    const admission = createAdmission();
    const gate = (() => {
      let resolve: () => void = () => {};
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    })();
    try {
      // 256개의 실행 슬롯을 모두 gate로 막아 둔다.
      for (let i = 0; i < COMMAND_ADMISSION_TOTAL; i++) {
        assert(await admission.admit("hold", () => gate.promise, "control"));
      }
      // 일반 queue도 예약을 뺀 자리까지 채운다. principal은 각각 다르다.
      const normalLimit = COMMAND_ADMISSION_TOTAL - COMMAND_CONTROL_RESERVED;
      const queued: Promise<boolean>[] = [];
      for (let i = 0; i < normalLimit; i++) {
        queued.push(admission.admit(`p-${i}`, () => Promise.resolve()));
      }
      assertEquals(admission.command.queued, normalLimit);
      // 일반 입장이 거절인 상태에서도 예약 영역(control lane)은 16개까지 받는다.
      const control: Promise<boolean>[] = [];
      for (let i = 0; i < COMMAND_CONTROL_RESERVED; i++) {
        control.push(
          admission.admit("revoke", () => Promise.resolve(), "control"),
        );
      }
      // 17번째 control은 예약 한도로 거절이다.
      assertEquals(
        await admission.admit("revoke", () => Promise.resolve(), "control"),
        false,
      );
      assertEquals(admission.command.queued, normalLimit);
      // gate가 풀리면 control이 normal queue보다 먼저 들어간다.
      gate.resolve();
      assert((await Promise.all(control)).every(Boolean));
      assert((await Promise.all(queued)).every(Boolean));
    } finally {
      gate.resolve();
    }
  },
);

Deno.test(
  "platform/responsiveness#R3: 대기 5초를 넘은 대기자는 잘라내고 false다",
  async () => {
    // 테스트가 기한을 줄일 때만 쓴다. 기본값은 architecture 2.3의 고정 값이다.
    const admission = createAdmission(30);
    const gate = (() => {
      let resolve: () => void = () => {};
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    })();
    try {
      for (let i = 0; i < COMMAND_ADMISSION_TOTAL; i++) {
        assert(await admission.admit("hold", () => gate.promise, "control"));
      }
      // 슬롯이 가득 차 있으므로 대기자는 queue에서 시작을 기다린다.
      const waiter = admission.admit("a", () => Promise.resolve());
      assertEquals(admission.command.queued, 1);
      assertEquals(await waiter, false);
      assertEquals(admission.command.queued, 0);
    } finally {
      gate.resolve();
    }
  },
);

Deno.test(
  "platform/responsiveness#R3: HTTP 동시 128·principal당 16, event 연결 32·principal당 4",
  () => {
    const admission = createAdmission();
    const arrivals: { release(): void }[] = [];
    // HTTP는 전체 128까지 즉시 결정이다.
    for (let i = 0; i < HTTP_CONCURRENT_TOTAL; i++) {
      const arrival = admission.enterHttp(`p-${i % 8}`);
      assert(arrival.ok);
      arrivals.push(arrival.value);
    }
    assertEquals(admission.httpActive, HTTP_CONCURRENT_TOTAL);
    const refused = admission.enterHttp("more");
    assertEquals(refused.ok, false);
    if (!refused.ok) assertEquals(refused.error.code, "unavailable");
    // release는 idempotent다.
    arrivals[0].release();
    arrivals[0].release();
    assertEquals(admission.httpActive, HTTP_CONCURRENT_TOTAL - 1);
    arrivals.slice(1).forEach((arrival) => arrival.release());
    assertEquals(admission.httpActive, 0);
    // 같은 principal이 16을 넘으면 거절이다.
    for (let i = 0; i < HTTP_CONCURRENT_PRINCIPAL; i++) {
      const arrival = admission.enterHttp("solo");
      assert(arrival.ok);
      arrivals.push(arrival.value);
    }
    assertEquals(admission.enterHttp("solo").ok, false);
    arrivals.forEach((arrival) => arrival.release());
    // event 연결은 전체 32·principal당 4다.
    const event: { release(): void }[] = [];
    for (let i = 0; i < EVENT_CONNECTION_TOTAL; i++) {
      const arrival = admission.enterEvent(`p-${Math.floor(i / 4)}`);
      assert(arrival.ok);
      event.push(arrival.value);
    }
    assertEquals(admission.connections, EVENT_CONNECTION_TOTAL);
    assertEquals(admission.enterEvent("more").ok, false);
    event.forEach((arrival) => arrival.release());
    for (let i = 0; i < EVENT_CONNECTION_PRINCIPAL; i++) {
      const arrival = admission.enterEvent("solo");
      assert(arrival.ok);
      event.push(arrival.value);
    }
    assertEquals(admission.enterEvent("solo").ok, false);
    event.forEach((arrival) => arrival.release());
    assertEquals(admission.connections, 0);
  },
);

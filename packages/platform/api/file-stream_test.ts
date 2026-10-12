// platform/api#R3: file route는 큰 파일을 core 메모리에 모으지 않고 stream으로 흘린다.
// 소비자가 당길 때만 읽고(backpressure), 길이·Content-Type을 싣고, 끝에서 어긋나면 응답을
// 끊고, 멈춘 소비자가 입장 자리를 붙잡지 못하게 한다.
import { assert, assertEquals, assertRejects } from "@std/assert";
import { err, manualClock, ok, seededRandom } from "../../base/mod.ts";
import { documentFile } from "../../protocol/projects/mod.ts";
import {
  type CredentialIssue,
  CredentialRegistry,
  type OperationPolicy,
} from "../identity/mod.ts";
import { createAdmission } from "../responsiveness/mod.ts";
import { type FileStreamHandler, startApiServer } from "./mod.ts";
import { RouteRegistry } from "./routes.ts";
import { call, value } from "./harness_test.ts";

const POLICIES: OperationPolicy[] = [
  { name: "document.file", actors: ["user"], kind: "read" },
];
const USER: CredentialIssue = {
  actor: "user",
  principal: "user",
  scope: { operations: ["document.file"], targets: {} },
  conditions: { process: "main-generation" },
};
const INPUT = {
  version: "ver_01arz3ndektsv4rrffq69g5fav",
  path: "docs/a.md",
};
const WINDOW = 256 * 1024;

async function open(
  handler: FileStreamHandler,
  options: {
    streamIdleMs?: number;
    admission?: ReturnType<typeof createAdmission>;
  } = {},
) {
  const clock = manualClock(Date.parse("2026-10-04T00:00:00.000Z"));
  const credentials = new CredentialRegistry({
    epoch: "core-one",
    clock,
    random: seededRandom(5),
    operations: POLICIES,
  });
  const issued = value(await credentials.issue(USER));
  const server = await startApiServer({
    port: 0,
    clock,
    credentials,
    registry: new RouteRegistry([documentFile]),
    fileStreams: new Map([["documents/file", handler]]),
    ...options,
  });
  return {
    server,
    base: `http://127.0.0.1:${server.port}`,
    token: issued.token,
  };
}

function request(opened: { base: string; token: string }) {
  return call(opened.base, "/v1/documents/file", {
    method: "POST",
    token: opened.token,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(INPUT),
  });
}

// 창 단위로 만들어 내는 source. 몇 번 당겼는지 세고 선언 길이만큼 흘린다.
function windows(
  total: number,
  hooks: { pulled?: () => void; failAtEnd?: boolean; cancelled?: () => void } =
    {},
) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      hooks.pulled?.();
      const size = Math.min(WINDOW, total - offset);
      const chunk = new Uint8Array(size);
      for (let i = 0; i < size; i++) chunk[i] = (offset + i) % 251;
      offset += size;
      if (offset >= total && hooks.failAtEnd) {
        controller.error(new Error("hash mismatch at the end"));
        return;
      }
      controller.enqueue(chunk);
      if (offset >= total) controller.close();
    },
    cancel() {
      hooks.cancelled?.();
    },
  }, { highWaterMark: 0 });
}

Deno.test("platform/api#R3: file stream은 저장된 media type과 정확한 길이를 싣고 원본 bytes를 흘린다", async () => {
  const total = WINDOW * 2 + 17;
  const opened = await open(() =>
    Promise.resolve(ok({
      contentType: "text/markdown",
      length: total,
      body: windows(total),
    }))
  );
  try {
    const response = await request(opened);
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("content-type"), "text/markdown");
    assertEquals(response.headers.get("content-length"), String(total));
    const bytes = new Uint8Array(await response.arrayBuffer());
    assertEquals(bytes.length, total);
    for (const at of [0, 1, WINDOW - 1, WINDOW, total - 1]) {
      assertEquals(bytes[at], at % 251);
    }
  } finally {
    await opened.server.stop();
  }
});

Deno.test("platform/api#R3: file stream의 형식이 어긋난 media type·길이는 응답을 열지 않고 internal이다", async () => {
  for (
    const bad of [
      { contentType: "text/markdown; charset=utf-8", length: 3 },
      { contentType: "text/plain\r\nx: y", length: 3 },
      { contentType: "text/plain", length: -1 },
      { contentType: "text/plain", length: 1.5 },
    ]
  ) {
    let cancelled = false;
    const opened = await open(() =>
      Promise.resolve(ok({
        ...bad,
        body: windows(3, { cancelled: () => (cancelled = true) }),
      }))
    );
    try {
      const response = await request(opened);
      assertEquals(response.status, 500);
      assertEquals((await response.json()).error.code, "internal");
      assert(cancelled, "열지 않은 stream은 취소한다");
    } finally {
      await opened.server.stop();
    }
  }
});

Deno.test("platform/api#R3: file stream 실패는 worker 문장 없이 JSON 공통 오류다", async () => {
  const opened = await open(() =>
    Promise.resolve(
      err({ code: "unavailable", message: "worker said: /home/secret/blob" }),
    )
  );
  try {
    const response = await request(opened);
    assertEquals(response.status, 503);
    const text = await response.text();
    assertEquals(JSON.parse(text).error.code, "unavailable");
    assert(!text.includes("secret"));
  } finally {
    await opened.server.stop();
  }
});

Deno.test("platform/api#R3: file stream은 소비자가 당길 때만 다음 창을 읽는다(backpressure)", async () => {
  const total = WINDOW * 40;
  let pulls = 0;
  const opened = await open(() =>
    Promise.resolve(ok({
      contentType: "application/octet-stream",
      length: total,
      body: windows(total, { pulled: () => pulls++ }),
    }))
  );
  try {
    const response = await request(opened);
    const reader = response.body!.getReader();
    await reader.read();
    // 소비자가 잠시 멈추는 동안 source는 소켓 buffer가 찰 만큼만 앞서 읽는다.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const stalled = pulls;
    await new Promise((resolve) => setTimeout(resolve, 300));
    assertEquals(
      pulls,
      stalled,
      "멈춘 소비자 앞에서 읽기가 더 진행되면 안 된다",
    );
    assert(stalled < 40, `40개 창 중 ${stalled}개를 미리 읽었다`);
    await reader.cancel();
  } finally {
    await opened.server.stop();
  }
});

Deno.test("platform/api#R3: 64 MiB file stream은 core 메모리를 늘리지 않고 끝까지 흐른다", async () => {
  const total = 64 * 1024 * 1024;
  let produced = 0;
  let warm = true;
  const opened = await open(() => {
    const length = warm ? 16 * 1024 * 1024 : total;
    return Promise.resolve(ok({
      contentType: "application/octet-stream",
      length,
      body: windows(length, { pulled: () => (produced += WINDOW) }),
    }));
  });
  try {
    const drain = async () => {
      produced = 0;
      let received = 0;
      let outstanding = 0;
      const response = await request(opened);
      for await (const chunk of response.body!) {
        // 받은 위치의 bytes가 원본과 같다(밀리거나 건너뛰지 않았다).
        assertEquals(chunk[0], received % 251);
        received += chunk.length;
        outstanding = Math.max(outstanding, produced - received);
      }
      return { received, outstanding };
    };
    // 첫 응답으로 heap과 buffer pool을 데워 둔다. 그 뒤의 늘어남만 본다.
    await drain();
    warm = false;
    const baseline = Deno.memoryUsage().rss;
    let peak = baseline;
    const sampler = setInterval(() => {
      peak = Math.max(peak, Deno.memoryUsage().rss);
    }, 5);
    const { received, outstanding } = await drain();
    clearInterval(sampler);
    assertEquals(received, total);
    // 만들어졌지만 아직 소비되지 않은 bytes는 소켓 buffer 정도다. 파일 전체가 아니다.
    assert(
      outstanding <= 8 * 1024 * 1024,
      `${Math.round(outstanding / 1024 / 1024)} MiB가 소비 전에 만들어졌다`,
    );
    // 파일 전체를 모았다면 64 MiB 이상(`number[]`로 모으면 수백 MiB)이 늘어난다.
    const growth = peak - baseline;
    assert(
      growth < 48 * 1024 * 1024,
      `rss가 ${Math.round(growth / 1024 / 1024)} MiB 늘었다`,
    );
  } finally {
    await opened.server.stop();
  }
});

Deno.test("platform/api#R3: file stream이 끝에서 어긋나면 응답을 완료하지 않고 끊는다", async () => {
  const total = WINDOW * 3;
  const opened = await open(() =>
    Promise.resolve(ok({
      contentType: "application/octet-stream",
      length: total,
      body: windows(total, { failAtEnd: true }),
    }))
  );
  try {
    const response = await request(opened);
    assertEquals(response.status, 200);
    let received = 0;
    await assertRejects(async () => {
      for await (const chunk of response.body!) received += chunk.length;
    });
    assert(received < total, "선언한 길이를 채우지 못하고 끊긴다");
  } finally {
    await opened.server.stop();
  }
});

Deno.test("platform/api#R3: 멈춘 소비자는 stream을 취소하고 입장 자리를 돌려준다", async () => {
  const total = WINDOW * 400;
  let cancelled = false;
  const admission = createAdmission();
  const opened = await open(
    () =>
      Promise.resolve(ok({
        contentType: "application/octet-stream",
        length: total,
        body: windows(total, { cancelled: () => (cancelled = true) }),
      })),
    { streamIdleMs: 150, admission },
  );
  try {
    const response = await request(opened);
    assertEquals(response.status, 200);
    // 본문을 읽지 않고 기다린다. 소켓 buffer가 차면 server의 쓰기가 멈춘다.
    const deadline = Date.now() + 5000;
    while (!cancelled && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert(cancelled, "멈춘 소비자 앞의 source가 취소돼야 한다");
    await response.body?.cancel().catch(() => undefined);
  } finally {
    await opened.server.stop();
  }
});

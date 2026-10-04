import { assertEquals, assertRejects } from "@std/assert";
import { startFakeProvider } from "./mod.ts";
import { openStream } from "./stream.ts";

async function promptly<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), 1_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

Deno.test("dev/stack#fake-provider: reader cancel과 signal abort는 injected delay, gate, hold를 즉시 끝낸다", async () => {
  for (const kind of ["delay", "gate", "hold"] as const) {
    for (const cancel of [true, false]) {
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let aborted = 0;
      let gateSignal: AbortSignal | undefined;
      const signal = new AbortController();
      const reader = openStream({
        chunks: kind === "hold" ? [] : [{
          bytes: "never",
          ...(kind === "delay" ? { delayMs: 60_000 } : { gate: "next" }),
        }],
        end: kind === "hold" ? "hold" : "close",
        signal: signal.signal,
        instant: false,
        sleep: () => {
          entered();
          return new Promise(() => {});
        },
        waitGate: (_, signal) => {
          gateSignal = signal;
          entered();
          return new Promise(() => {});
        },
        onAbort: () => {
          aborted++;
        },
      }).getReader();
      const reading = reader.read();
      const outcome = cancel
        ? reading
        : assertRejects(() => reading, DOMException, "aborted");
      await started;
      if (cancel) await promptly(reader.cancel());
      else signal.abort();
      await promptly<unknown>(outcome);
      assertEquals(aborted, 1);
      if (gateSignal) assertEquals(gateSignal.aborted, true);
      reader.releaseLock();
    }
  }
});

Deno.test("dev/stack#fake-provider: 실제 HTTP 첫 token delay 중 client abort는 real timer와 shutdown을 기다리지 않는다", async () => {
  let received!: () => void;
  const started = new Promise<void>((resolve) => {
    received = resolve;
  });
  const provider = startFakeProvider({
    script: {
      steps: [{
        id: "slow",
        protocol: "messages",
        response: {
          status: 200,
          chunks: [{ bytes: "first", delayMs: 60_000 }],
        },
      }],
    },
    nowMs: () => {
      received();
      return 0;
    },
  });
  const signal = new AbortController();
  const pending = fetch(`${provider.url}/messages`, {
    method: "POST",
    signal: signal.signal,
  }).then(async (response) => {
    await response.text();
  });
  const rejected = assertRejects(() => pending);
  try {
    await started;
    await new Promise((resolve) => setTimeout(resolve, 20));
    signal.abort();
    await promptly(rejected);
    await promptly(provider.close());
    assertEquals(provider.requests()[0].aborted, true);
    provider.assertDone(1);
  } finally {
    signal.abort();
    await provider.close();
  }
});

Deno.test("dev/stack#fake-provider: server close는 살아 있는 HTTP client의 hold도 promptly 끝낸다", async () => {
  const provider = startFakeProvider({
    script: {
      steps: [{
        id: "held",
        protocol: "messages",
        response: {
          status: 200,
          chunks: [{ bytes: "first" }],
          end: "hold",
        },
      }],
    },
  });
  const client = new AbortController();
  try {
    const response = await fetch(`${provider.url}/messages`, {
      method: "POST",
      signal: client.signal,
    });
    const reader = response.body!.getReader();
    assertEquals(
      new TextDecoder().decode((await reader.read()).value),
      "first",
    );
    const rejected = assertRejects(() => reader.read());
    await promptly(provider.close());
    assertEquals(client.signal.aborted, false);
    await promptly(rejected);
    assertEquals(provider.requests()[0].aborted, true);
    provider.assertDone(1);
  } finally {
    client.abort();
    await provider.close();
  }
});

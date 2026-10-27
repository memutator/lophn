import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { serve } from "./serve.ts";

const encoder = new TextEncoder();

// 흘러가지 않고 한 번에 모이면 위 test들이 서로를 기다리다 멈춘다. 멈추지 않고 실패하게 시한을 둔다.
async function deadline<T>(
  promise: Promise<T>,
  what: string,
  ms = 5000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what}: 시한 초과`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// 요청 body는 handler가 첫 조각을 본 뒤에야 다음 조각을 보내고, 응답 body는 client가 첫 조각을
// 받은 뒤에야 다음 조각을 낸다. 어느 쪽이든 통째로 모이면 여기서 멈춘다.
test("request and response bodies stream instead of being collected", async () => {
  let serverSawFirst = () => {};
  const firstSeen = new Promise<void>((resolve) => {
    serverSawFirst = resolve;
  });
  let clientSawFirst = () => {};
  const firstReceived = new Promise<void>((resolve) => {
    clientSawFirst = resolve;
  });
  const server = await serve({ port: 0 }, async (request) => {
    const parts: string[] = [];
    for await (const chunk of request.body ?? []) {
      parts.push(new TextDecoder().decode(chunk));
      if (parts.length === 1) serverSawFirst();
    }
    return new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode("out:first"));
          await firstReceived;
          controller.enqueue(encoder.encode(parts.join("")));
          controller.close();
        },
      }),
    );
  });
  const port = server.addr.transport === "tcp" ? server.addr.port : 0;
  try {
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode("in:first"));
        await deadline(firstSeen, "server가 첫 요청 조각을 봤다");
        controller.enqueue(encoder.encode("in:second"));
        controller.close();
      },
    });
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    const reader = response.body!.getReader();
    const first = await deadline(
      reader.read(),
      "client가 첫 응답 조각을 받았다",
    );
    assert.equal(new TextDecoder().decode(first.value), "out:first");
    clientSawFirst();
    const rest = await reader.read();
    assert.equal(new TextDecoder().decode(rest.value), "in:firstin:second");
  } finally {
    await server.shutdown();
  }
});

// fake server는 응답을 붙들고 있는 동안 client가 끊긴 것을 request.signal로 안다.
test("a client disconnect aborts the request signal", async () => {
  let aborted = () => {};
  const signalAborted = new Promise<void>((resolve) => {
    aborted = resolve;
  });
  const server = await serve({ port: 0 }, async (request) => {
    await new Promise<void>((resolve) => {
      if (request.signal.aborted) return resolve();
      request.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    aborted();
    return new Response(null);
  });
  const port = server.addr.transport === "tcp" ? server.addr.port : 0;
  try {
    const controller = new AbortController();
    const pending = fetch(`http://127.0.0.1:${port}/`, {
      signal: controller.signal,
    }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort();
    await pending;
    await deadline(signalAborted, "request.signal abort");
  } finally {
    await server.shutdown();
  }
});

// broker가 앱마다 여는 socket이다. client는 socketPath로 붙고, 닫으면 file이 남지 않아야 한다.
test("the unix transport answers and removes its socket file on shutdown", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lophn-serve-"));
  const socketPath = join(directory, "b.sock");
  try {
    const server = await serve(
      { transport: "unix", path: socketPath },
      async (request) =>
        new Response(
          `${new URL(request.url).pathname}:${await request.text()}`,
        ),
    );
    const answer = await deadline(
      new Promise<string>((resolve, reject) => {
        const request = httpRequest(
          { socketPath, path: "/broker/ready", method: "POST" },
          (response) => {
            let text = "";
            response.setEncoding("utf8");
            response.on("data", (chunk) => (text += chunk));
            response.on("end", () => resolve(text));
          },
        );
        request.on("error", reject);
        request.end("body");
      }),
      "unix round trip",
    );
    assert.equal(answer, "/broker/ready:body");
    await server.shutdown();
    assert.equal(existsSync(socketPath), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// gateway는 upgrade 연결을 ws에 그대로 넘긴다. handler가 먼저 답하면 안 된다.
test("upgrade requests reach the upgrade option raw", async () => {
  const server = await serve(
    {
      port: 0,
      upgrade(request, socket, head) {
        socket.end(`upgraded:${request.url}:${head.byteLength}`);
      },
    },
    () => new Response("handler must not answer", { status: 400 }),
  );
  const port = server.addr.transport === "tcp" ? server.addr.port : 0;
  try {
    const received = await deadline(
      new Promise<string>((resolve, reject) => {
        const socket = connect(port, "127.0.0.1");
        let text = "";
        socket.setEncoding("utf8");
        socket.on("connect", () => {
          socket.write(
            "GET /gateway HTTP/1.1\r\nHost: lophn\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
          );
        });
        socket.on("data", (chunk) => (text += chunk));
        socket.on("end", () => resolve(text));
        socket.on("error", reject);
      }),
      "upgrade round trip",
    );
    assert.equal(received, "upgraded:/gateway:0");
  } finally {
    await server.shutdown();
  }
});

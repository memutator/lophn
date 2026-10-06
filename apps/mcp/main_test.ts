// MCP 실행 entry의 credential 조립 시험이다(connection#R17, mcp-server#R36). helper는 temp dir의 sh
// script 대역이고 core 응답은 주입한 fetch다. 사람의 실제 keychain·data root·harness 설정은 열지 않는다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import { createHelperCredentialProvider } from "../../packages/coding-agent/connection/credential/helper.ts";
import { startMcpServer } from "./main.ts";

const CAC = "cac_01h455vb4pex5v6nkc6gd5fdw1";
const TOKEN = "mcp-delivered-token-77aa21";

async function fakeHelper(body: string): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "lophn-mcp-helper-" });
  const helper = `${dir}/lophn-credential`;
  await Deno.writeTextFile(helper, `#!/bin/sh\ncat > /dev/null\n${body}\n`);
  await Deno.chmod(helper, 0o755);
  return helper;
}

type Session = {
  call(name: string, args: unknown): Promise<{
    isError: boolean;
    text: string;
  }>;
  stderr(): Promise<string>;
  close(): Promise<void>;
};

async function session(options: {
  provider?: Parameters<typeof startMcpServer>[0] extends infer O
    ? O extends { provider?: infer P } ? P : never
    : never;
  fetch: NonNullable<Parameters<typeof startMcpServer>[0]>["fetch"];
}): Promise<Session> {
  const inbox = new TransformStream<Uint8Array, Uint8Array>();
  const outbox = new TransformStream<Uint8Array, Uint8Array>();
  const errbox = new TransformStream<Uint8Array, Uint8Array>();
  const started = await startMcpServer({
    streams: {
      stdin: inbox.readable,
      stdout: outbox.writable,
      stderr: errbox.writable,
    },
    args: ["--connection", CAC, "--toolsets", "core"],
    env: { LOPHN_CONNECTION: CAC, LOPHN_MCP_TOOLSETS: "core" },
    daemonUrl: "http://127.0.0.1:1",
    submissionRoot: Deno.cwd(),
    provider: options.provider,
    fetch: options.fetch,
  });
  assert(started.ok);
  const writer = inbox.writable.getWriter();
  const reader = outbox.readable.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let id = 0;
  async function rpc(method: string, params: unknown) {
    id += 1;
    await writer.write(
      encoder.encode(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      ),
    );
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        return JSON.parse(line) as {
          result?: {
            isError?: boolean;
            content?: { text: string }[];
          };
        };
      }
      const chunk = await reader.read();
      if (chunk.done) throw new Error("stdout closed");
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  }
  await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  return {
    async call(name, args) {
      const reply = await rpc("tools/call", { name, arguments: args });
      return {
        isError: reply.result?.isError === true,
        text: (reply.result?.content ?? []).map((item) => item.text).join("\n"),
      };
    },
    async stderr() {
      // stderr에 쓴 것이 없으면 읽을 chunk가 없다. 닫아서 남은 것만 읽는다.
      return await Promise.race([
        (async () => {
          const r = errbox.readable.getReader();
          const first = await r.read();
          r.releaseLock();
          return first.done ? "" : decoder.decode(first.value);
        })(),
        new Promise<string>((resolve) => setTimeout(() => resolve(""), 50)),
      ]);
    },
    async close() {
      await writer.close();
      await started.value.done;
    },
  };
}

function projects(title: string) {
  return {
    projects: [{
      id: "prj_01arz3ndektsv4rrffq69g5fav",
      name: "p",
      title,
      purpose: "목적",
      revision: "1",
      status: "active",
      documents: [],
    }],
    as_of_seq: "1",
    next_cursor: null,
  };
}

Deno.test("coding-agent/connection#R17 coding-agent/mcp-server#R36: connection 참조로 시작해 helper에서 받은 token으로만 core를 부르고 token은 MCP text·stderr에 나오지 않는다", async () => {
  const helper = await fakeHelper(`printf '%s' '{"token":"${TOKEN}"}'`);
  const seen: string[] = [];
  const mcp = await session({
    provider: createHelperCredentialProvider({
      helper,
      generation: () => "1",
    }),
    fetch: (_url, init) => {
      seen.push(init.headers["authorization"] ?? "");
      // core 응답에 token이 섞여 와도 사람·모델에게 가는 text는 가려진다.
      return Promise.resolve({
        status: 200,
        headers: new Headers(),
        bytes: new TextEncoder().encode(
          JSON.stringify(projects(`leak ${TOKEN}`)),
        ),
      });
    },
  });
  try {
    const result = await mcp.call("lophn_project", { op: "list" });
    assert(seen.length > 0);
    assertEquals(seen[0], `Bearer ${TOKEN}`);
    assert(result.text.includes("leak"), result.text);
    assertFalse(result.text.includes(TOKEN), result.text);
    assertFalse((await mcp.stderr()).includes(TOKEN));
  } finally {
    await mcp.close();
    await Deno.remove(helper.slice(0, helper.lastIndexOf("/")), {
      recursive: true,
    });
  }
});

Deno.test("coding-agent/connection#R17 coding-agent/mcp-server#R36: keychain가 잠기면 core를 부르지 않고 이유가 있는 unavailable이며 token·fallback이 없다", async () => {
  const helper = await fakeHelper(`printf '%s' '{"reason":"locked"}'\nexit 1`);
  let calls = 0;
  const mcp = await session({
    provider: createHelperCredentialProvider({
      helper,
      generation: () => "1",
    }),
    fetch: () => {
      calls += 1;
      return Promise.reject(new Error("core에 닿으면 안 된다"));
    },
  });
  try {
    const result = await mcp.call("lophn_project", { op: "list" });
    assert(result.isError, result.text);
    assertEquals(calls, 0);
    assert(result.text.includes("locked"), result.text);
    assertFalse(/token|Bearer/i.test(result.text.replace("credential", "")));
  } finally {
    await mcp.close();
    await Deno.remove(helper.slice(0, helper.lastIndexOf("/")), {
      recursive: true,
    });
  }
});

Deno.test("coding-agent/connection#R17 coding-agent/mcp-server#R36: 설치 helper가 없으면 production provider는 no_secret_service이고 평문 파일·환경 변수로 받지 않는다", async () => {
  let calls = 0;
  const previous = Deno.env.get("LOPHN_TOKEN");
  const mcp = await session({
    fetch: () => {
      calls += 1;
      return Promise.reject(new Error("core에 닿으면 안 된다"));
    },
  });
  try {
    const result = await mcp.call("lophn_project", { op: "list" });
    assert(result.isError, result.text);
    assertEquals(calls, 0);
    assert(result.text.includes("no_secret_service"), result.text);
    assertEquals(Deno.env.get("LOPHN_TOKEN"), previous);
  } finally {
    await mcp.close();
  }
});

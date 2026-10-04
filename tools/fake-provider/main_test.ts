import { assertEquals } from "@std/assert";

Deno.test("tools/fake-provider: 개발 entry는 ready 한 줄을 쓰고 script와 log를 HTTP로 받는다", async () => {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-net",
      new URL("./main.ts", import.meta.url).pathname,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const child = command.spawn();
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let line = "";
  while (!line.includes("\n")) {
    const chunk = await reader.read();
    if (chunk.done) break;
    line += decoder.decode(chunk.value);
  }
  const ready = JSON.parse(line) as { ready: boolean; url: string };
  assertEquals(ready.ready, true);
  const { url } = ready;
  try {
    const script = {
      steps: [{
        id: "one",
        protocol: "messages",
        reply: { text: "from-entry" },
      }],
    };
    const replaced = await fetch(`${url}/__fake/script`, {
      method: "POST",
      body: JSON.stringify(script),
    });
    assertEquals(replaced.status, 200);
    const response = await fetch(`${url}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "fixture-model" }),
    });
    assertEquals((await response.json()).content[0].text, "from-entry");
    const log = await (await fetch(`${url}/__fake/log`)).json();
    assertEquals(
      log.filter((entry: { matchedStep?: string }) => entry.matchedStep).length,
      1,
    );
    const bad = await fetch(`${url}/__fake/script`, {
      method: "POST",
      body: '{"steps":[{"id":"x"}]}',
    });
    assertEquals(bad.status, 400);
  } finally {
    child.kill("SIGTERM");
    await child.status;
  }
});

async function record(
  env: Record<string, string>,
  stdin: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-env",
      new URL("./record.ts", import.meta.url).pathname,
    ],
    env,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(stdin));
  await writer.close();
  const output = await child.output();
  const decoder = new TextDecoder();
  return {
    code: output.code,
    stdout: decoder.decode(output.stdout),
    stderr: decoder.decode(output.stderr),
  };
}

Deno.test("tools/fake-provider: record 명령은 live 없이 거절하고 secret을 저장하지 않는다", async () => {
  const blocked = await record({}, JSON.stringify({ body: {}, secrets: [] }));
  assertEquals(blocked.code, 1);
  assertEquals(blocked.stderr.includes("live_disabled"), true);
  assertEquals(blocked.stdout.includes("{"), false);

  const leaked = await record(
    {
      LOPHN_LIVE_PROVIDER: "1",
    },
    JSON.stringify({
      body: { note: "token sk-live-secret-value" },
      secrets: ["sk-live-secret-value"],
    }),
  );
  assertEquals(leaked.code, 1);
  assertEquals(leaked.stderr.includes("secret"), true);
  assertEquals(leaked.stdout.includes("sk-live"), false);

  const clean = await record(
    { LOPHN_LIVE_PROVIDER: "1" },
    JSON.stringify({
      body: { access_token: "synthetic-access", text: "ok" },
      secrets: ["synthetic-access"],
    }),
  );
  assertEquals(clean.code, 0);
  assertEquals(JSON.parse(clean.stdout), {
    access_token: { present: true },
    text: "ok",
  });
});

Deno.test("dev/stack#fake-provider: record secret 입력은 memory envelope뿐이고 malformed envelope는 raw 출력 없이 거절한다", async () => {
  const malformed = await record(
    { LOPHN_LIVE_PROVIDER: "1" },
    '{"body":"never-print-this"',
  );
  assertEquals(malformed.code, 1);
  assertEquals(malformed.stdout, "");
  assertEquals(malformed.stderr.includes("never-print-this"), false);
  const escaped = await record(
    { LOPHN_LIVE_PROVIDER: "1" },
    JSON.stringify({
      body: { response: { body: 'data: {"text":"\\u0078y"}\n\n' } },
      secrets: ["xy"],
    }),
  );
  assertEquals(escaped.code, 1);
  assertEquals(escaped.stdout, "");
  assertEquals(escaped.stderr.includes("secret"), true);
});

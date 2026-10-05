// loading 관측 테스트의 MCP server 대역이다(T32). 실제 harness binary가 아니라
// stdin/stdout JSON-RPC를 말하는 작은 Deno script이고 `--mode`로 실패 모양을
// 고른다. 파일·network·env 권한이 없다.
const args = Deno.args;

function option(name: string): string | undefined {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
}

const mode = option("--mode") ?? "ok";
const tools = (option("--tools") ?? "lophn_index,lophn_read").split(",")
  .filter((name) => name !== "");

if (mode === "crash") Deno.exit(3);

const encoder = new TextEncoder();

async function send(message: unknown): Promise<void> {
  await Deno.stdout.write(encoder.encode(`${JSON.stringify(message)}\n`));
}

const decoder = new TextDecoder();
let buffer = "";
for await (const chunk of Deno.stdin.readable) {
  buffer += decoder.decode(chunk, { stream: true });
  let newline = buffer.indexOf("\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\n");
    if (line.trim() === "" || mode === "hang") continue;
    if (mode === "bad-json") {
      await Deno.stdout.write(encoder.encode("not a json-rpc object\n"));
      continue;
    }
    const request = JSON.parse(line) as { id?: number; method?: string };
    if (request.id === undefined) continue;
    if (request.method === "initialize") {
      if (mode === "init-error") {
        await send({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32603, message: "fixture refuses" },
        });
      } else {
        await send({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "lophn-mcp-fixture", version: "0" },
          },
        });
      }
    } else if (request.method === "tools/list") {
      if (mode === "tools-error") {
        await send({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32603, message: "fixture tools fail" },
        });
      } else if (mode === "tools-hang") {
        // 응답하지 않는다.
      } else {
        await send({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            tools: mode === "empty-tools"
              ? []
              : tools.map((name) => ({ name, description: name })),
          },
        });
      }
    }
  }
}

import { cliMain } from "../../../packages/coding-agent/cli/main.ts";
import type { RpcFetch } from "../../../packages/protocol/client/mod.ts";
import type { Core } from "../core/mod.ts";

export type CodingCli = {
  /** 예: run("ticket claim", { ticket, base_revision }). 실패해도 던지지 않는다: code가 0이 아니고 value는 `{ error }` 꼴이다. */
  run(
    command: string,
    input?: Record<string, unknown>,
  ): Promise<{ code: number; value: unknown; stderr: string }>;
};

function sink() {
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  return {
    stream: new WritableStream<Uint8Array>({
      write(chunk) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      },
    }),
    text: () => chunks.join(""),
  };
}

// coding agent가 쓰는 길 그대로다: token 환경 변수 하나와 core 주소. CLI를 process로 띄우지 않고 in-process로
// 부른다(fetch는 단위 test가 끼운다). 입력 검사와 출력 꼴은 지나면서, 앱 E2E 한 번에 여덟 번쯤 부르는 Deno 시작은 아낀다.
export function codingCli(
  core: Core,
  token: string,
  fetch?: RpcFetch,
): CodingCli {
  const env = new Map([
    ["LOPHN_CODING_TOKEN", token],
    ["LOPHN_DAEMON_URL", core.baseUrl],
  ]);
  return {
    async run(command, input = {}) {
      const stdout = sink();
      const stderr = sink();
      const code = await cliMain(
        [
          ...command.split(" "),
          "--json",
          "--input",
          JSON.stringify(input),
        ],
        {
          env: { get: (name) => env.get(name) },
          stdout: stdout.stream,
          stderr: stderr.stream,
          ...(fetch === undefined ? {} : { fetch }),
        },
      );
      const text = stdout.text().trim();
      return {
        code,
        value: text === "" ? undefined : JSON.parse(text),
        stderr: stderr.text(),
      };
    },
  };
}

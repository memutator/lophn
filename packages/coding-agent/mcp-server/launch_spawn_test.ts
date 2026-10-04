// 오프라인 시작 테스트다(R1, connection#R16). 생성한 argv로 server를 띄워
// initialize·tools/list가 네트워크 차단에서 성공하는지 본다. 설치된 코드·설정·
// 캐시만 쓰므로 시작 download가 없다. 사람 데이터 root는 열지 않는다. worker-common
// 대로 temp dir를 LOPHN_HOME 자리에 둔다.
import { assertEquals } from "@std/assert";
import { mcpLaunchArgv } from "./launch.ts";

const deno = Deno.execPath();

function tempEnv(dir: string): Record<string, string> {
  return {
    LOPHN_HOME: dir,
    DENO_DIR: "/home/pyosechang/.cache/deno",
    PATH: "/usr/bin:/bin",
  };
}

Deno.test(
  "coding-agent/connection#R16: 생성한 argv로 오프라인 시작에서 initialize가 된다",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      // 설치 resource는 이 저장소 자체다. 실제 package가 있는 저장소 자리에서
      // 시작한다. 홈 루트를 실제 ~로 두지 않는다(worker-common: 사람 데이터 root를
      // 열지 않는다).
      const resources = new URL("../../..", import.meta.url)
        .pathname.replace(/\/$/, "");
      const argv = mcpLaunchArgv({
        deno,
        resources,
        cache: `${dir}/deno`,
        connection: "",
        coreEndpoint: "http://127.0.0.1:1",
      });
      const command = new Deno.Command(argv.command, {
        args: argv.args,
        cwd: resources,
        env: { ...argv.env, ...tempEnv(dir) },
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      });
      const child = command.spawn();
      const encoder = new TextEncoder();
      const writer = child.stdin.getWriter();
      // initialize를 먼저 쓴다. 오프라인에서도 응답이 나온다.
      await writer.write(
        encoder.encode(
          '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"test-client"}}}\n',
        ),
      );
      await writer.write(
        encoder.encode('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n'),
      );
      await writer.close();
      const decoder = new TextDecoder();
      let stdout = "";
      let stderrText = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 15_000);
      // 진단 reader를 함께 돌린다. stderr를 안 읽으면 자식이 막힐 수 있다.
      const diag = (async () => {
        for await (const chunk of child.stderr) {
          stderrText += decoder.decode(chunk, { stream: true });
        }
      })();
      for await (const chunk of child.stdout) {
        stdout += decoder.decode(chunk, { stream: true });
        // 응답 줄이 임의로 끊겨 도착한다. discovery까지 도착했을 때 본다.
        if (stdout.includes("lophn_index")) break;
      }
      clearTimeout(timer);
      // 이미 끝났을 수 있다. stdin 닫힘으로 server도 끝난다(R1).
      try {
        child.kill("SIGTERM");
      } catch {
        // 이미 끝났으면 조용히 넘어간다.
      }
      await child.status;
      await diag;
      // initialize에 답한다. protocol 버전을 그대로 돌려준다(R1).
      assertEquals(stdout.includes('"serverInfo"'), true);
      assertEquals(stdout.includes("2025-06-18"), true);
      // tools/list에 답한다. core discovery가 나온다(R3).
      assertEquals(stdout.includes('"tools"'), true);
      assertEquals(stdout.includes("lophn_index"), true);
      // stdout에는 JSON-RPC만 있다. 초기화 안내 문장은 없다(R1).
      assertEquals(stdout.startsWith("{"), true);
      // 진단이 비어 있어야 오프라인 시작이 깨끗하다. 실패 이유를 stderr로 본다.
      assertEquals(stderrText, "");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

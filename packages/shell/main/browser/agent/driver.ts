import type {
  HostRequest,
  HostToolOutput,
} from "../../../../protocol/lophn-agent/host-queue.ts";

// core의 `browser_call` 요청을 실제 탭에 돌리는 port다. surface가 요청을 가져와 여기에 넘기고 결과를 `host/done`에 싣는다.
export type BrowserCallPayload = Extract<
  HostRequest,
  { kind: "browser_call" }
>["payload"];
export type BrowserDriver = {
  run(payload: BrowserCallPayload): Promise<HostToolOutput>;
};

// CDP 실행은 아직 없다(bu-cdp가 채운다). 모든 호출에 unavailable이다.
// ctx는 ShellContext다. 지금은 쓰지 않아 import하지 않는다: desktop/wiring/context.ts를 import하면 tsconfig.json(엄격한 project,
// desktop/wiring은 빼 둔다)이 이 file을 통해 그 뒤를 모두 끌어와 실패한다. bu-cdp가 ShellContext를 쓰려면 이 폴더를 tsconfig.node.json으로 옮긴다.
export function createBrowserDriver(_ctx: unknown): BrowserDriver {
  return {
    run: () =>
      Promise.resolve({
        error: {
          code: "unavailable",
          message: "browser control is not ready",
        },
      }),
  };
}

// `--on <기계>`가 붙은 명령의 core 호출이다. 명령 code는 그대로 두고 core 호출만 이 컴퓨터 core의 `machines/call`로 바꾼다.
// `shell_capability` 칸을 싣지 않는다: CLI에는 capability가 없고, 그 칸이 없는 호출을 core가 사람의 터미널(`terminal`)로 정해
// 받는 기계에 알린다. 받는 기계가 무엇을 받는지는 그 기계의 기기 route 목록과 허락이 정하므로 여기서 거르지 않는다.
import { machinesCall } from "../protocol/remote/mod.ts";
import type { CommandCore } from "./commands/types.ts";

export function remoteCore(core: CommandCore, machine: string): CommandCore {
  return {
    // read와 memory는 입력 그대로가 받는 기계의 HTTP body다.
    read: (route, input) =>
      core.read(machinesCall, {
        machine,
        resource: route.resource,
        method: route.method,
        body: input,
      }) as never,
    // command는 HTTP envelope이다(`connection/command-core.ts`의 clientCore와 같은 꼴, `prepared`는 비어 있다).
    command: (route, input, options) =>
      core.read(machinesCall, {
        machine,
        resource: route.resource,
        method: route.method,
        body: {
          input,
          idempotency_key: options.key,
          compare: options.compare ?? {},
          prepared: [],
        },
      }) as never,
  };
}

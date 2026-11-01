import type { CommandCore } from "../commands/types.ts";
import type { CoreClient } from "./client/core.ts";

// binary가 명령 code에 끼우는 core 호출이다. user token HTTP client 위에 얇게 얹는다.
// route 출력은 client가 route의 output schema로 이미 검사했다.
export function clientCore(client: CoreClient): CommandCore {
  return {
    read: (route, input) => client.read(route, input) as never,
    command: (route, input, options) =>
      client.command(route, {
        input,
        idempotency_key: options.key,
        compare: options.compare ?? {},
      }) as never,
  };
}

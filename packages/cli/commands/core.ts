// binary만 부르는 core 명령의 표다. `COMMANDS`는 core가 import하므로(node control을 실을 수 없다) 여기에 모양만 두고
// 실행은 binary 입구(main.ts)가 core control로 잇는다. agent tool의 명령 목록(`commandsForWorkspace`)에는 들어가지 않는다.
import { z } from "zod";
import { ok, type LophnError, type Result } from "../../base/mod.ts";
import type { CommandDoc } from "./types.ts";

// binary가 `core stop`에 쓰는 IO다. main.ts가 control stop을 끼운다.
export type CoreCommandContext = {
  stop(): Promise<Result<null, LophnError>>;
};

export type CoreCommand = CommandDoc & {
  // binary 입구만 아는 명령이다. `LOCAL_COMMANDS`와 모양이 같고 ctx만 다르다.
  binary: true;
  run(
    input: Record<string, unknown>,
    ctx: CoreCommandContext,
  ): Promise<Result<unknown, LophnError>>;
};

const empty = z.strictObject({});

export const CORE_COMMANDS: readonly CoreCommand[] = [
  {
    name: "core.stop",
    summary: "Stop the running lophn core",
    description:
      "Sends stop to the core of this data root and does not start one. Fails with unavailable when no core is running.",
    input: empty,
    effect: "write",
    binary: true,
    run: async (_input, ctx) => {
      const stopped = await ctx.stop();
      return stopped.ok ? ok({ stopped: true }) : stopped;
    },
  },
];

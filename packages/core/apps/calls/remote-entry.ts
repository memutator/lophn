import type { z } from "zod";
import { err, type Result } from "../../../base/mod.ts";
import type { appRemoteCall } from "../../../protocol/apps/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type {
  MachineCandidate,
  Requester,
} from "../../../protocol/machine/requester.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { MemoryHandler } from "../../server/mod.ts";
import type { AppToolCallPath } from "../ports.ts";

type RemoteEntryDeps = {
  path: AppToolCallPath;
  // 이 기계의 명단이 아는 기기의 종류와, 그 컴퓨터가 이 기계에서 터미널 입력을 허락받았는가.
  kind(principal: string): "phone" | "computer" | null;
  granted(principal: string): boolean;
  // 기기 id로 명단의 컴퓨터를 찾는다(기계 id는 컴퓨터마다 하나라고 보지 않는다).
  resolve(device: string): Result<MachineCandidate>;
  // 받은 call 처리가 자격 옆에 실은 요청한 쪽(frame의 `by`).
  requesterOf(ctx: AuthenticatedContext): Requester | undefined;
};

function forbidden(message: string): Result<never> {
  return err({ code: "forbidden", message });
}

// `apps/remote_call`: 다른 컴퓨터가 넘긴 앱 command를 이 기계의 앱 호출 경로로 돌린다. 판정은 이 기계의 자료로 한다: 부른 기기가 명단의
// 컴퓨터이고 터미널 입력을 허락받았는가. command가 내놓은 것인가와 private은 호출 경로의 Gate가 본다. 요청한 쪽의 종류만 믿고
// name 같은 글은 믿지 않는다. 자격은 여기서 만든다: route로는 `remote` 자격이 생기지 않는다.
export function remoteCallHandler(deps: RemoteEntryDeps): MemoryHandler {
  return (ctx, input) => {
    const { principal } = ctx;
    if (
      !principal.startsWith("device:") ||
      deps.kind(principal) !== "computer"
    ) {
      return Promise.resolve(
        forbidden("only a computer in the roster calls an app command"),
      );
    }
    const requester = deps.requesterOf(ctx);
    if (requester === undefined) {
      return Promise.resolve(
        forbidden("an app command comes from another computer's call"),
      );
    }
    if (!deps.granted(principal)) {
      return Promise.resolve(
        forbidden("this computer has no terminal input grant here"),
      );
    }
    const computer = deps.resolve(principal.slice("device:".length));
    if (!computer.ok) {
      return Promise.resolve(forbidden("this device is not a computer here"));
    }
    const {
      app,
      command,
      input: body,
    } = input as z.infer<typeof appRemoteCall.input>;
    const remote = {
      machine: computer.value.machine as Id<"mch">,
      device: computer.value.device as Id<"dev">,
      requester,
    };
    return deps.path.call(
      {
        target: { mode: "live", app, release: null },
        kind: "command",
        name: command,
        ...(body === undefined ? {} : { input: body }),
        caller: { kind: "remote", ...remote },
      },
      { actor: "remote", remote },
    );
  };
}

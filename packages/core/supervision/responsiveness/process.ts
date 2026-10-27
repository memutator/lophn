import { spawn as spawnNode } from "node:child_process";
import process from "node:process";
import { settledWithin } from "./deadline.ts";
import {
  confirmGroupGone,
  GROUP_CONFIRM_MS,
  signalGroup,
  supportsProcessGroupEnforcement,
} from "./group.ts";
import {
  fromReadable,
  type SpawnedPipe,
  type SpawnedWriter,
  toWriter,
} from "./pipe.ts";

export { checkKillAdapter, supportsProcessGroupEnforcement } from "./group.ts";
export type { SpawnedPipe, SpawnedWriter } from "./pipe.ts";

export type Spawned = {
  pid: number;
  stdin: SpawnedWriter;
  stdout: SpawnedPipe;
  stderr: SpawnedPipe;
  // 실제 leader의 종료 code. 신호로 죽으면 null. leader exit는 group 종료의 증거가 아니다.
  exited: Promise<number | null>;
  // group 전체에 SIGKILL을 보내고 leader exit와 group 소멸을 확인한다. true만 종료 확인이다.
  // leader가 스스로 끝나도 자동으로 같은 경계를 지나며, 여러 번 불러도 같은 결과를 돌려준다.
  terminate(): Promise<boolean>;
};

export type SpawnRequest = {
  command: string;
  args: string[];
  env: Record<string, string>;
  // 없으면 부모의 cwd다.
  cwd?: string;
};

// SIGKILL 뒤 leader의 exit status를 기다리는 한도.
export const LEADER_EXIT_MS = 1_000;

// detached:true가 setsid를 호출해 pid=pgid=session leader가 된다(Deno 2.9.7 실측).
// group 종료는 이 handle이 띄운 pid만 대상으로 한다. PID 파일은 읽지도 쓰지도 않는다.
export function spawnProcess(request: SpawnRequest): Spawned {
  if (!supportsProcessGroupEnforcement(process.platform)) {
    throw new Error(
      "process group enforcement is only verified on linux; refusing to spawn",
    );
  }
  const child = spawnNode(request.command, request.args, {
    detached: true,
    shell: false,
    env: request.env,
    ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
    stdio: ["pipe", "pipe", "pipe"],
  });
  // spawn 실패(ENOENT 등)의 'error'를 받지 않으면 core 전체가 죽는다. 실패는 pid로 판정한다.
  child.on("error", () => {});
  const pid = child.pid;
  if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 1) {
    throw new Error("spawn did not return a pid");
  }
  const exited = new Promise<number | null>((resolve) => {
    child.on("exit", (code, signal) => resolve(signal ? null : code));
  });

  // leader exit와 강제 종료가 모두 이 한 경계를 거친다. leader가 이미 끝났어도 같은 group의
  // 손자는 남아 있을 수 있으므로 group에 SIGKILL을 보내고 비었는지 확인한다.
  // leader-only kill로 성공을 만들지 않는다: adapter가 실패하면 false다.
  let reaping: Promise<boolean> | undefined;
  const reap = () =>
    (reaping ??= (async () => {
      const sent = await signalGroup(pid);
      if (sent === "failed") return false;
      if (!(await settledWithin(exited, LEADER_EXIT_MS))) return false;
      return await confirmGroupGone(pid, GROUP_CONFIRM_MS);
    })().catch(() => false));
  void exited.then(reap);

  return {
    pid,
    stdin: toWriter(child.stdin!),
    stdout: fromReadable(child.stdout!),
    stderr: fromReadable(child.stderr!),
    exited,
    terminate: reap,
  };
}

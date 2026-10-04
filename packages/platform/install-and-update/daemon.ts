import { err, ok, type Result } from "../../base/mod.ts";
import { type InstanceState } from "../../contracts/platform/mod.ts";
import { QUIT_FLAG, TRAY_FLAG } from "../../contracts/shell/mod.ts";
import { INSTANCE_LOCK_NAME } from "./instance-lock.ts";
import { readRunMetadata } from "./run-metadata.ts";

// daemon 시작·중지·상태·log의 위치 방법. 실제 process 띄우기는 각 OS의 launcher가
// 하고, 이 모듈은 앞 단계의 결정을 내놓는다(coding-agent/cli#R8의 `lophn daemon`이 쓴다).
// API token은 필요 없고 coding credential을 쓰지 않는다.

/** 시작이 열지 않는 Electron main의 실행 옵션. argv·env에 credential은 없다. */
export type DaemonStart = {
  /** 실행 권한이 launcher로 해석하는 실행 이름. */
  executable: string;
  /** 창 없는 시작 intent(desktop#R21). package.json·wrapper 스크립트가 이 argv를 받는다. */
  argv: readonly [typeof TRAY_FLAG];
  env: Record<string, string>;
};

/** 중지가 실행 중인 Electron main에 보내는 second-instance 요청. */
export type DaemonStop = {
  executable: string;
  argv: readonly [typeof QUIT_FLAG];
  env: Record<string, string>;
};

// launcher는 프로세스 환경을 바탕으로 데이터 root만 덮어쓴다. credential은 env에 넣지 않는다.
export function daemonStart(
  dataRoot: string,
  executable: string,
): Result<DaemonStart> {
  if (executable === "" || executable.includes("\0")) {
    return err({ code: "invalid_input", message: "실행 이름이 올바르지 않다" });
  }
  if (!dataRoot.startsWith("/")) {
    return err({
      code: "invalid_input",
      message: "데이터 root가 절대 경로가 아니다",
    });
  }
  return ok({
    executable,
    argv: [TRAY_FLAG],
    env: { LOPHN_HOME: dataRoot },
  });
}

// OS single-instance 통로 --quit이 실행 중인 main의 second-instance에 도착하면
// main이 정상 종료 순서를 밟는다. token이 없으므로 권한은 OS 사용자 권한 하나다.
export function daemonStop(
  dataRoot: string,
  executable: string,
): Result<DaemonStop> {
  if (executable === "" || executable.includes("\0")) {
    return err({ code: "invalid_input", message: "실행 이름이 올바르지 않다" });
  }
  if (!dataRoot.startsWith("/")) {
    return err({
      code: "invalid_input",
      message: "데이터 root가 절대 경로가 아니다",
    });
  }
  return ok({
    executable,
    argv: [QUIT_FLAG],
    env: { LOPHN_HOME: dataRoot },
  });
}

// lock 파일이 있고 다른 process가 쥐고 있으면 running, 풀려 있으면 absent다.
// metadata는 이 판정을 바꾸지 않는다(비정상 종료는 마지막 위치를 남겨 둔다).
export async function instanceState(
  runDir: string,
): Promise<Result<InstanceState>> {
  let file: Deno.FsFile;
  try {
    file = await Deno.open(`${runDir}/${INSTANCE_LOCK_NAME}`, {
      create: true,
      read: true,
      write: true,
      mode: 0o600,
    });
  } catch {
    return err({
      code: "unavailable",
      message: "instance lock 파일을 열 수 없다",
    });
  }
  let held = false;
  try {
    held = !(await file.tryLock(true));
  } catch {
    held = false;
  }
  try {
    if (!held) file.unlock();
  } catch {
    // 풀기 실패는 판정을 바꾸지 않는다. 프로세스가 죽으면 커널이 푼다.
  }
  try {
    file.close();
  } catch {
    // 닫기 실패도 판정을 바꾸지 않는다.
  }
  return ok(held ? "running" : "absent");
}

// lock으로 현재 상태를 고르고 metadata를 읽는다. metadata가 없어도 absent다.
export async function daemonStatus(
  runDir: string,
): Promise<Result<{ state: InstanceState; metadata: "present" | "absent" }>> {
  const state = await instanceState(runDir);
  if (!state.ok) return state;
  const metadata = await readRunMetadata(runDir);
  return ok({
    state: state.value,
    metadata: metadata.ok ? "present" : "absent",
  });
}

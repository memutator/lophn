// docs/plan/contracts.md의 contracts#T10: E2E harness.
// 실제 Electron shell과 실제 core를 임시 LOPHN_HOME으로 띄우고, renderer DOM은
// Chromium 원격 디버깅으로 읽는다. 끝나면 띄운 프로세스만 정확한 pid로 정리한다.
// 실제 ~/.lophn은 읽지도 쓰지도 않는다.

/** 화면이 없으면(DISPLAY 없음) E2E를 건너뛴다. */
/** `deno task e2e`가 켠다. check의 test 단계에서는 flow가 Electron을 띄우지 않는다. */
export const E2E_FLAG = "LOPHN_E2E";

/** flow를 돌릴지. `deno task e2e`로 불렸고 화면이 있을 때만 돈다. */
export function e2eEnabled(
  env: { DISPLAY?: string; LOPHN_E2E?: string } = Deno.env.toObject(),
): boolean {
  return env[E2E_FLAG] === "1" && displayAvailable(env);
}

export function displayAvailable(
  env: { DISPLAY?: string } = Deno.env.toObject(),
): boolean {
  return typeof env.DISPLAY === "string" && env.DISPLAY !== "";
}

/** 원격 디버깅 포트. 0이면 Chromium이 빈 포트를 고른다. */
export const DEBUG_PORT = 0;

/** core hello·창 준비를 기다리는 한계. core hello 한계(30초)보다 넉넉하다. */
export const READY_TIMEOUT_MS = 60_000;

/** 종료 뒤 프로세스가 사라질 때까지 기다리는 한계. */
export const EXIT_TIMEOUT_MS = 15_000;

export interface ElectronLaunch {
  /** Electron 실행 파일. `apps/shell/main/node_modules/electron/dist/electron`. */
  executable: string;
  /** shell main 앱 인자. build 결과의 main.cjs다. */
  app: string;
  /** 임시 데이터 root. `--home`으로 넘어가 실제 ~/.lophn을 피한다. */
  home: string;
  /** 원격 디버깅 포트. */
  port: number;
  /** 추가 env. LOPHN_HOME은 home으로 고정한다. */
  env?: Record<string, string>;
}

/** Electron 실행 인자. 원격 디버깅 포트와 임시 home만 더한다. */
export function electronArgs(launch: ElectronLaunch): string[] {
  return [
    `--remote-debugging-port=${launch.port}`,
    launch.app,
    "--home",
    launch.home,
  ];
}

export interface DevToolsTarget {
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
  title?: string;
}

/**
 * 원격 디버깅 target 목록에서 shell renderer 페이지를 고른다.
 * devtools·service worker·blank는 제외하고 lophn-shell scheme 페이지를 우선한다.
 */
export function pickPageTarget(
  targets: readonly DevToolsTarget[],
): DevToolsTarget | undefined {
  const pages = targets.filter((target) =>
    target.type === "page" &&
    typeof target.webSocketDebuggerUrl === "string" &&
    !target.url?.startsWith("devtools://")
  );
  // overlay 창은 내용이 없다. desktop 페이지를 우선하고, 없으면 shell 페이지를 고른다.
  return pages.find((target) => target.url?.includes("://desktop/")) ??
    pages.find((target) => target.url?.startsWith("lophn-shell:")) ??
    pages.find((target) => target.url !== undefined && target.url !== "") ??
    pages[0];
}

export interface CdpResponse {
  id: number;
  result?: { result?: { value?: unknown } };
  error?: { message?: string };
}

/** CDP Runtime.evaluate 응답에서 값을 꺼낸다. 오류면 던진다. */
export function readEvaluation(response: CdpResponse): unknown {
  if (response.error) {
    throw new Error(
      `cdp evaluate 실패: ${response.error.message ?? "unknown"}`,
    );
  }
  return response.result?.result?.value;
}

/** 프로세스 트리. 정확한 pid로만 정리하기 위해 재귀로 모은다. */
export async function descendantPids(root: number): Promise<number[]> {
  const found: number[] = [];
  const queue = [root];
  const seen = new Set<number>();
  while (queue.length > 0) {
    const pid = queue.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    // 존재하지 않는 pid는 트리에 넣지 않는다.
    if (!processAlive(pid)) continue;
    found.push(pid);
    queue.push(...await childPids(pid));
  }
  return found;
}

async function childPids(pid: number): Promise<number[]> {
  // /proc/<pid>/task/<pid>/children만 자식 pid를 담는다. 다른 경로는 디렉터리라
  // 읽으면 자기 자신을 자식으로 오인한다.
  try {
    const text = await Deno.readTextFile(`/proc/${pid}/task/${pid}/children`);
    return text.trim().split(/\s+/).filter((part) => part !== "").map(Number)
      .filter((value) => Number.isInteger(value) && value > 0);
  } catch {
    return [];
  }
}

/** 프로세스가 아직 살아 있는지. /proc로 확인해 신호 권한과 무관하게 판단한다. */
export function processAlive(pid: number): boolean {
  try {
    return Deno.statSync(`/proc/${pid}`).isDirectory;
  } catch {
    return false;
  }
}

/**
 * 정확한 pid들에만 신호를 보낸다. 넓은 패턴(pkill -f)은 쓰지 않는다.
 * 없는 pid는 건너뛴다.
 */
export function signalPids(pids: readonly number[], signal: Deno.Signal): void {
  for (const pid of pids) {
    try {
      Deno.kill(pid, signal);
    } catch {
      // 이미 끝났다.
    }
  }
}

/** fixture 디렉터리를 임시 폴더로 복사한다. 대상은 새로 만든다. */
export async function copyFixture(
  source: string,
  destination: string,
): Promise<void> {
  await Deno.mkdir(destination, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    const from = `${source}/${entry.name}`;
    const to = `${destination}/${entry.name}`;
    if (entry.isDirectory) await copyFixture(from, to);
    else if (entry.isFile) await Deno.copyFile(from, to);
  }
}

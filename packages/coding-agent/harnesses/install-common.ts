// 설치 형식들이 같이 쓰는 타입과 작은 함수다.
import type { HarnessId } from "../../protocol/coding-agent/mod.ts";
import type { HARNESS_INSTALL_OUTCOMES } from "../../protocol/coding-agent/mod.ts";

export type Outcome = (typeof HARNESS_INSTALL_OUTCOMES)[number];

export type InstallPorts = {
  // 없으면 null이다.
  read(path: string): Promise<string | null>;
  // 상위 폴더도 만든다. `executable`이면 실행 권한을 준다.
  write(path: string, text: string, executable?: boolean): Promise<void>;
  // 폴더 안 항목 이름이다. 폴더가 없으면 null이다.
  list(dir: string): Promise<string[] | null>;
  // file 하나나 빈 폴더 하나를 지운다. recursive가 아니다.
  remove(path: string): Promise<void>;
};

// 한 항목의 결과다. `files`는 쓴·지운(dry_run이면 쓸·지울) 절대 경로다.
export type Step = { outcome: Outcome; files: string[] };

export type Json = Record<string, unknown>;

export function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isWindowsHome(home: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(home) || home.includes("\\");
}

export function trimHome(home: string): string {
  return home.replace(/[\\/]+$/, "");
}

// home 기준 상대 경로를 home의 OS 구분자에 맞춰 잇는다(Codex trust key·Muse managed 경로가 혼합 구분자로 깨지지 않게).
export function joinHome(home: string, rel: string): string {
  const sep = isWindowsHome(home) ? "\\" : "/";
  return `${trimHome(home)}${sep}${rel.replaceAll("/", sep)}`;
}

// 우리 hook command(`lophn hook <harness> `나 개발·설치 절대 경로 `<절대 경로> hook <harness> `)인지다.
export function ownedCommand(harness: HarnessId, command: unknown): boolean {
  return (
    typeof command === "string" &&
    new RegExp(`^(?:lophn|(?:\\/|[A-Za-z]:[\\\\/])\\S+) hook ${harness} `).test(
      command,
    )
  );
}

// 놓인 file 본문에서 hook command의 앞부분(`lophn`이나 절대 경로)을 읽는다. dry_run은 이것으로 기대 본문을 만들어
// command만 다른 것(개발 경로로 놓인 것, 옛 경로)은 놓을 것으로 보지 않는다.
export function placedCommand(
  harness: HarnessId,
  text: string | null,
): string | undefined {
  return text?.match(
    new RegExp(`"(lophn|(?:\\/|[A-Za-z]:\\/)[^"\\\\\\n]*) hook ${harness} `),
  )?.[1];
}

// 키 순서와 상관없는 JSON 비교다.
export function sameJson(a: unknown, b: unknown): boolean {
  return canon(a) === canon(b);
}

function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canon(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

// 계산에 쓴 본문과 지금 file이 모두 같은지다. 읽은 뒤 다른 도구가 고쳤으면 그 고침을 덮지 않으려고 쓰기 직전에 본다.
export async function unchangedSinceRead(
  ports: InstallPorts,
  files: readonly { path: string; text: string | null }[],
): Promise<boolean> {
  for (const file of files) {
    if ((await ports.read(file.path)) !== file.text) return false;
  }
  return true;
}

// 쓸 file들을 모두 계산한 뒤 하나라도 못 만들면(null) 아무것도 쓰지 않고 `failed`다. 계산 결과가 현재 본문과 같으면 놓을 것이 없다.
// 쓰기 직전에 file이 바뀌었으면 읽기부터 한 번 다시 하고, 두 번째도 바뀌었으면 아무것도 쓰지 않고 `failed`다.
export async function editFiles(
  ports: InstallPorts,
  jobs: readonly {
    path: string;
    make(text: string | null): string | null;
    executable?: boolean;
  }[],
  dryRun: boolean,
): Promise<Step> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const planned: {
      path: string;
      text: string | null;
      next: string;
      executable?: boolean;
    }[] = [];
    for (const job of jobs) {
      const text = await ports.read(job.path);
      const next = job.make(text);
      if (next === null) return { outcome: "failed", files: [] };
      if (next !== text) {
        planned.push({
          path: job.path,
          text,
          next,
          executable: job.executable,
        });
      }
    }
    if (planned.length === 0) return { outcome: "unchanged", files: [] };
    const files = planned.map((one) => one.path);
    if (dryRun) return { outcome: "missing", files };
    if (!(await unchangedSinceRead(ports, planned))) continue;
    for (const one of planned) {
      await ports.write(one.path, one.next, one.executable);
    }
    return { outcome: "installed", files };
  }
  return { outcome: "failed", files: [] };
}

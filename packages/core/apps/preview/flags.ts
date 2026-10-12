// preview 자식의 Deno flag 판정. supervisor 쪽(launcher)이 시작 전에 쓴다.
import { flagsAccepted } from "../runtime/mod.ts";
import type { PreviewLaunch } from "./model.ts";

function inside(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}/`);
}

function listOf(flag: string): string[] {
  const at = flag.indexOf("=");
  return at < 0 ? [] : flag.slice(at + 1).split(",").filter((v) => v !== "");
}

// 운영 data 자리: `.../apps/<app>/preview/<nonce>` 옆의 `.../apps/<app>/data`다.
// preview 입력의 dataPath가 이 모양이 아니면 disposable 영역이 아니다.
export function liveDataOf(
  launch: Pick<PreviewLaunch, "app" | "nonce" | "dataPath">,
): string | undefined {
  const suffix = `/apps/${launch.app}/preview/${launch.nonce}`;
  if (!launch.dataPath.endsWith(suffix)) return undefined;
  const root = launch.dataPath.slice(0, -suffix.length);
  return `${root}/apps/${launch.app}/data`;
}

// preview 자식의 Deno flag가 disposable 영역 밖을 쓰지 못하는지 본다. 두 socket과 가상 host의
// 허락은 supervisor가 시작마다 더하므로 입력 flag에는 net 허락이 없어야 하고(외부·loopback host
// 듣기·연결 없음), 쓰기 허락은 disposable 영역 하나이며, 읽기 허락은 운영 data와 그 위 폴더를
// 포함하지 않는다. 위반이면 이유를, 괜찮으면 undefined를 돌려준다.
export function previewFlagsViolation(
  launch: PreviewLaunch,
): string | undefined {
  const live = liveDataOf(launch);
  if (live === undefined) {
    return "preview data path is not a disposable preview directory";
  }
  if (!flagsAccepted(launch.flags)) {
    return "preview flags include a forbidden flag";
  }
  for (const flag of launch.flags.args) {
    const name = flag.split("=")[0];
    if (name === "--allow-net") return "preview flags cannot allow network";
    if (name === "--allow-write") {
      if (listOf(flag).some((path) => path !== launch.dataPath)) {
        return "preview can write only its disposable directory";
      }
    }
    if (name === "--allow-read") {
      for (const path of listOf(flag)) {
        if (inside(path, live) || inside(live, path)) {
          return "preview cannot read production data";
        }
      }
    }
  }
  return undefined;
}

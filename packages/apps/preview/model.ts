// preview 값과 판정. preview는 별도 entity·ID·운영 상태·ledger 표가 아니다(domain-model apps/preview).
// 프로세스 메모리와 disposable 파일에만 있다.
import type { RuntimeReason } from "../../contracts/apps/mod.ts";
import type { Blueprint } from "../blueprint/mod.ts";
import {
  flagsAccepted,
  type PreviewLaunch,
  previewNonceSchema,
} from "../runtime/mod.ts";

export const PREVIEW_UNAVAILABLE: RuntimeReason = {
  code: "preview_unavailable",
  summary: "no live preview process exists",
};
export const PREVIEW_STARTING: RuntimeReason = {
  code: "starting",
  summary: "the preview process has not passed its readiness check",
};

// preview의 disposable 영역은 운영 data(`apps/<app>/data`)와 따로 이 이름 아래에만 둔다.
export function previewDirectory(
  dataRoot: string,
  app: string,
  nonce: string,
): string {
  return `${dataRoot}/apps/${app}/preview/${nonce}`;
}

export function validNonce(value: string): boolean {
  return previewNonceSchema.safeParse(value).success;
}

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
// 포함하지 않는다(apps/preview#R2, R4). 위반이면 이유를, 괜찮으면 undefined를 돌려준다.
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

// preview 대역이 검사하는 선언이다. 운영과 같은 모양의 선언 검사만 하고 grant는 없다.
export type PreviewScope = {
  secrets: readonly string[];
  net: readonly { host: string; port: number }[];
  documents: readonly string[];
};

export function previewScopeOf(
  blueprint: Pick<Blueprint, "permissions">,
): PreviewScope {
  const secrets: string[] = [];
  const net: { host: string; port: number }[] = [];
  const documents: string[] = [];
  for (const requirement of blueprint.permissions) {
    const scope = requirement.scope as Record<string, unknown>;
    if (requirement.kind === "secret.use") secrets.push(String(scope["name"]));
    else if (requirement.kind === "net.fetch") {
      net.push({ host: String(scope["host"]), port: Number(scope["port"]) });
    } else if (requirement.kind === "document.save") {
      documents.push(String(scope["key"]));
    }
  }
  return { secrets, net, documents };
}

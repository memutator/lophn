// preview 값과 판정. preview는 별도 entity·ID·운영 상태·ledger 표가 아니다(domain-model apps/preview).
// 프로세스 메모리와 disposable 파일에만 있다.
import type { RuntimeReason } from "../../protocol/apps/mod.ts";
import type { Blueprint } from "../blueprint/mod.ts";
import type { LimitKey } from "../permissions/mod.ts";

// core가 supervisor에 알리는 preview 시작 입력이다. runtime/control-protocol의 PreviewLaunch와 같은
// 모양이고(launcher.ts가 두 type이 같음을 컴파일 때 확인한다), core graph가 runtime 구현을
// import하지 않도록 이 leaf가 모양만 따로 쥔다.
export type PreviewLaunch = {
  app: string;
  nonce: string;
  // 준비 전 bundle이면 null이다. 가짜 release를 만들지 않는다.
  release: string | null;
  bundleHash: string;
  commands: string[];
  screens?: Record<string, ("full" | "panel" | "card")[]>;
  dataSchema: number;
  flags: { args: string[]; limits: LimitKey[] };
  entry: string;
  importMap: string;
  // disposable 영역. `apps/<app ID>/preview/<nonce>`다.
  dataPath: string;
};

// supervisor가 알리는 프로세스 관측(runtime/control-protocol의 ObservationWire와 같은 모양).
export type PreviewObservationWire = {
  app: string;
  release: string | null;
  mode: "live" | "preview";
  bundle_hash: string | null;
  process_nonce: string;
  endpoint: string;
  commands: string[];
  screens: Record<string, ("full" | "panel" | "card")[]>;
  ready: boolean;
  accepting: boolean;
  reason?: { code: string; summary: string };
  record_failed?: string;
};

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

// runtime/control-protocol의 previewNonceSchema와 같은 규칙이다(경로에 들어가므로 `/`·`.`이 없다).
const NONCE = /^[0-9A-Za-z-]{8,64}$/;

export function validNonce(value: string): boolean {
  return NONCE.test(value);
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

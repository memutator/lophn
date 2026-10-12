import type { RunSource } from "@lophn/protocol/lophn-agent";

// App Engineer의 시작 계기와 읽기 범위. 순수 함수다. 실제 읽기
// 집행은 core의 documents·앱 읽기 통로가 하고, 이 모듈은 어떤 요청이 범위 안인지의 계약을
// 정한다(handoff가 한시적 고정 근거 읽기를 이 계약에 맡긴다).

// 시작 계기다. 사람 요청(message)과 그 요청을 잇는 handoff만 App Engineer를 시작한다.
// 주기 회차는 operator의 것이고, 문제 발생이나 release activation 같은 자료 변화는 run의
// 출처가 아니다.
export function mayStart(source: RunSource | { kind: string }): boolean {
  return source.kind === "message" || source.kind === "handoff";
}

// 이 run이 읽을 수 있는 범위를 정하는 입력이다.
export type ReadScope = {
  // 담당 앱.
  app: string;
  // 컨텍스트의 app-data source(계약의 `app-data` 자료 위치)다. source가 담당 앱의 read command일 때만
  // 그 컨텍스트의 overview·용어집을 읽는다.
  contexts: readonly {
    id: string;
    app_data: readonly { app: string; command: string }[];
  }[];
  // 이번 handoff가 싣고 온 고정 근거다. 그 handoff를 받은 run 동안만 읽는다.
  handoff: readonly { run: string; document: string; version: string }[];
  run: string;
};

export type ReadRequest =
  // 문서·blueprint·release·invocation·문제·티켓 같은 자리 자료다.
  | {
    kind: "place_material";
    place: { kind: "app" | "project" | "global"; id: string | null };
  }
  // 문서 하나. version이 null이면 최신 판을 주소로 연다.
  | {
    kind: "document";
    document: string;
    version: string | null;
    place: { kind: "app" | "project" | "global"; id: string | null } | null;
  }
  // 컨텍스트의 overview·용어집.
  | { kind: "context"; context: string }
  | { kind: "sdk_contract" };

export type ReadDecision =
  | {
    allowed: true;
    via: "own_app" | "context" | "sdk_contract" | "handoff_evidence";
  }
  // 범위 밖은 없는 것과 같다(not_found). 존재를 알리지 않는다.
  | { allowed: false; code: "not_found" };

const DENIED: ReadDecision = { allowed: false, code: "not_found" };

export function readDecision(
  scope: ReadScope,
  request: ReadRequest,
): ReadDecision {
  switch (request.kind) {
    case "sdk_contract":
      return { allowed: true, via: "sdk_contract" };
    case "place_material":
      return request.place.kind === "app" && request.place.id === scope.app
        ? { allowed: true, via: "own_app" }
        : DENIED;
    case "context": {
      const context = scope.contexts.find((entry) =>
        entry.id === request.context
      );
      const reads = context?.app_data.some((source) =>
        source.app === scope.app
      );
      return reads === true ? { allowed: true, via: "context" } : DENIED;
    }
    case "document": {
      if (request.place?.kind === "app" && request.place.id === scope.app) {
        return { allowed: true, via: "own_app" };
      }
      // 고정 판 주소만 열린다. 최신 판·연결 자료·다른 run의 근거는 주소만으로 열지 못한다.
      const pinned = request.version !== null &&
        scope.handoff.some((entry) =>
          entry.run === scope.run && entry.document === request.document &&
          entry.version === request.version
        );
      return pinned ? { allowed: true, via: "handoff_evidence" } : DENIED;
    }
  }
}

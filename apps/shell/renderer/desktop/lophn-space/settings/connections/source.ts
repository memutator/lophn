// coding agent 연결 화면이 읽고 쓰는 통로(shell#T50). 화면은 이 interface만 보고 core route 이름과 main IPC는
// core-source.ts만 안다. 모양은 contracts(coding-agent 연결·harness 감지)에서 이 화면이 쓰는 field만 옮긴 것이다.
// token·hash·설치 경로 설정은 이 통로에 없다. 연결은 "이 harness로 연결"이라는 고정 intent로만 만든다.
import type {
  ConnectView,
  DetectView,
  HarnessName,
  HarnessView,
} from "../../../../../ipc/coding.ts";
import type { SourceResult } from "../../source.ts";

export type { ConnectView, DetectView, HarnessName, HarnessView, SourceResult };

export type ConnectionScope =
  | { readonly kind: "all" }
  | { readonly kind: "app"; readonly app: string };

/** 연결 하나. 원문 token·검증 hash는 core도 내지 않는다. */
export interface ConnectionRow {
  readonly id: string;
  readonly label: string;
  readonly scope: ConnectionScope;
  readonly state: "active" | "revoked";
  /** 회수 결정이 비교하는 판. 화면은 보내지 않고 결정 창이 다시 읽는다. */
  readonly revision: string;
}

export interface AppChoice {
  readonly id: string;
  readonly name: string;
}

/** 사람이 고른 것. harness는 감지된 것 중 하나여야 하고 main이 따로 다시 검사한다. */
export interface ConnectChoice {
  readonly harness: HarnessName;
  readonly label: string;
  readonly scope: ConnectionScope;
}

export interface CodingConnectionsSource {
  /** core 연결 상태를 듣는다. 준비되면 화면이 다시 읽는다. 해제는 반환 함수다. */
  watch(listener: (state: { readonly state: string }) => void): () => void;
  /** 저장한 감지 결과. 화면이 열릴 때·다시 들어올 때 부른다. 재감지가 아니다. */
  detect(): Promise<SourceResult<DetectView>>;
  /** 사람이 [Detect again]을 누를 때만 부른다. */
  refresh(): Promise<SourceResult<DetectView>>;
  connections(): Promise<SourceResult<readonly ConnectionRow[]>>;
  apps(): Promise<SourceResult<readonly AppChoice[]>>;
  /** 연결 생성(확인 창 없음)과 선택 target 설치·확인. 실패 이유는 code다. */
  connect(choice: ConnectChoice): Promise<SourceResult<ConnectView>>;
  /** 회수 결정 창을 연다. 결정은 그 창에서만 받는다. 창은 닫혀도 결정이 아니다. */
  revoke(connection: string): Promise<SourceResult<null>>;
}

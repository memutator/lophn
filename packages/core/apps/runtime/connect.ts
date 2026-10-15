// supervisor가 지금 쥔 앱 프로세스의 관측과 core가 읽는 앱 사실의 모양. 서명 연결은 없다:
// 앱 호출은 core의 `app.call_api`를 거치고 앱에 직접 닿는 길은 없다.
import type { Result } from "../../../base/mod.ts";
import type { AppGrant } from "../../../protocol/apps/mod.ts";

type ScreenSize = "full" | "panel" | "card";

// supervisor가 지금 쥔 앱 프로세스 하나의 관측이다. 과거 event·ledger 주소로 만들지 않는다.
export type ProcessObservation = {
  app: string;
  mode: "live" | "preview";
  release: string | null;
  bundleHash: string;
  processNonce: string;
  endpoint: string;
  ready: boolean;
  accepting: boolean;
  // 실제 프로세스가 등록한 app-api key(ReadyAttestation)와 선언한 화면·크기다.
  commands: readonly string[];
  screens: Readonly<Record<string, readonly ScreenSize[]>>;
};

export type ProcessQuery =
  | { app: string; mode: "live" }
  | { app: string; mode: "preview"; nonce: string };

export type ProcessSource = {
  // 없으면 값 없음이다. supervisor에 닿지 못하면 unavailable이다.
  current(
    query: ProcessQuery,
  ): Promise<Result<ProcessObservation | undefined>>;
  // 그 nonce의 프로세스를 정지 확인 뒤 새 nonce로 다시 띄운다. 이미 다른 nonce면 하지 않는다.
  restart(app: string, nonce: string): Promise<Result<void>>;
};

export type AppFacts = {
  id: string;
  status: "active" | "archived";
  run_enabled: boolean;
  active_release: string | null;
};

// 현재 ledger 사실. 호출자 자격이 아니라 core 안의 읽기 자격으로 읽는다.
export type ConnectFacts = {
  app(id: string): Promise<Result<AppFacts | null>>;
  // 그 앱의 active grant 전체(여러 page를 모은 것).
  grants(id: string): Promise<Result<readonly AppGrant[]>>;
};

// supervisor가 지금 쥔 앱 프로세스의 관측과 core가 읽는 앱 사실의 모양. 서명 연결은 없다:
// 앱 호출은 core의 `app.call_tool`를 거치고 앱에 직접 닿는 길은 없다.
import type { Result } from "../../../base/mod.ts";
import type { AppGrant } from "../../../protocol/apps/mod.ts";

// supervisor가 지금 쥔 앱 프로세스 하나의 관측이다. 과거 event·ledger 주소로 만들지 않는다.

type AppFacts = {
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

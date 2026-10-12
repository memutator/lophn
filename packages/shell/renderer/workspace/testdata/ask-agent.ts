// [Ask <agent 이름>] test의 고정 값. id·seq는 고정이고 시각은 쓰지 않는다. 알림 행이 싣고 오는
// AskView를 만든다(어느 계기에 붙는지는 core의 몫이라 여기서 계기 이름을 보지 않는다).
import type { AskRole, AskTarget, AskView } from "../ask-view.ts";

export const NOTIFICATION_ID = "ntf_01h455vb4pex5v6nkc6gd5fd01";
export const APP_ID = "app_01h455vb4pex5v6nkc6gd5fd01";
export const SOURCE_SEQ = "41";

export const SUBJECTS: Record<AskTarget, string> = {
  problem: "prb_01h455vb4pex5v6nkc6gd5fd01",
  release: "rel_01h455vb4pex5v6nkc6gd5fd01",
};

export function askView(
  role: AskRole,
  agentName: string,
  target: AskTarget,
): AskView {
  return {
    agentName,
    request: {
      notification: NOTIFICATION_ID,
      role,
      workPlace: { kind: "app", id: APP_ID },
      openingContext: {
        sourceSeq: SOURCE_SEQ,
        target: { kind: target, id: SUBJECTS[target] },
      },
    },
  };
}

/** Ask가 붙는 알림 행의 예. */
export const ASK_VIEWS: readonly AskView[] = [
  askView("app_engineer", "App Engineer", "problem"),
  askView("app_engineer", "App Engineer", "release"),
  askView("context_engineer", "Context Engineer", "problem"),
];

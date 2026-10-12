import type {
  rewindCheckpoints,
  rewindList,
  rewindPreview,
} from "../../contracts/lophn-agent/mod.ts";
import type { ReadDefinition } from "../../contracts/platform/mod.ts";
import type { RevertDeps } from "./commands.ts";

// 되돌리기 읽기(lophn-agent/revert). preview는 저장된 목록이 아니라 지금의 기록과 파일 상태로 다시
// 만든 현재 판이고 command나 event를 만들지 않는다. 구현은 agent-RW3b가 채우고 hidden_from_seq는
// agent-RW3d가 채운다. 읽는 쪽은 사람과 machine뿐이다(agent·앱에는 내용도 경로도 주지 않는다).
export function createRevertReads(deps: RevertDeps): {
  preview: ReadDefinition<typeof rewindPreview>;
  checkpoints: ReadDefinition<typeof rewindCheckpoints>;
  list: ReadDefinition<typeof rewindList>;
} {
  void deps;
  throw new Error("not implemented: agent-RW3b");
}

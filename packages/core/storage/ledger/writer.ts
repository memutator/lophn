import { type Result } from "../../../base/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type {
  CommandEnvelope,
  CommandSuccess,
  StoredCommandResult,
} from "./writer-message.ts";

export type { CommandEnvelope, CommandSuccess, StoredCommandResult };

export type Writer = {
  command(
    ctx: AuthenticatedContext,
    envelope: CommandEnvelope,
  ): Promise<Result<CommandSuccess>>;
  readResult(
    ctx: AuthenticatedContext,
    key: string,
  ): Promise<Result<StoredCommandResult | null>>;
  close(): Promise<void>;
};

// Deno Worker 하나의 쓰기 연결만 연다. 이쪽은 SQL을 하지 않고 작은 메시지만 보낸다.
// 자격은 Worker 등록이 본다. 이쪽은 시각·회수 주장을 보내지 않는다.
// onCommit은 commit된 새 command 결과(재전달 제외)에서 domain event가 있을 때 부른다. Worker가 아니라
// 이쪽(core)에서 불러 Bus에 닿는다.

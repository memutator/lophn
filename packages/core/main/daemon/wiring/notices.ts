// program이 사람에게 남기는 기록(notices.record)을 core 안 다른 wiring이 쓰는 길이다. `ctx.noticeRecorder`가 core 안 machine
// 자격으로 쓰기 층을 지난다(commit 뒤 Bus까지 사람이 낸 것과 같다). 사람·agent·앱·renderer는 이 route를 부르지 못한다
// (route actors와 operation 정책이 machine뿐이다).
// 표를 합치는 ledger step(`apps.notices.unified`)은 낸 step 목록의 맨 끝에 붙어야 해서(schema-steps.lock.json) 앱 팀의
// schemaSteps가 아니라 목록 맨 뒤 wiring의 schemaStepsAfterTeams에 둔다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  type NoticeRecordInput,
  noticeRecord,
} from "../../../../protocol/apps/notice.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { noticeUnifiedSchemaSteps } from "../../../apps/notices/mod.ts";
import type { WiringFactory } from "./context.ts";

const NOTICE_RECORDER_PRINCIPAL = "machine:notice-recorder";
const NOTICE_RECORDER_CONTEXT: AuthenticatedContext = {
  principal: NOTICE_RECORDER_PRINCIPAL,
  actor: "machine",
  scope: { operations: [noticeRecord.name], targets: {} },
  conditions: {},
  credential_ref: NOTICE_RECORDER_PRINCIPAL,
};

export type NoticeRecorder = (
  input: NoticeRecordInput,
) => Promise<Result<{ id: string }>>;

export const noticesWiring: WiringFactory = () => ({
  name: "notices",
  schemaStepsAfterTeams: noticeUnifiedSchemaSteps,
  operations: () => [
    { name: noticeRecord.name, actors: ["machine"], kind: "command" },
  ],
  records: () => [NOTICE_RECORDER_CONTEXT],
  build(ctx) {
    const record: NoticeRecorder = async (input) => {
      const done = await ctx.writer.command(NOTICE_RECORDER_CONTEXT, {
        command: noticeRecord.name,
        input,
        compare: {},
        idempotency_key: crypto.randomUUID(),
        prepared: [],
      });
      if (!done.ok) return done;
      const id = (done.value.result as { id?: unknown } | null)?.id;
      return typeof id === "string"
        ? ok({ id })
        : err({ code: "internal", message: "notices.record returned no id" });
    };
    ctx.provide("noticeRecorder", record);
    return ok({});
  },
});

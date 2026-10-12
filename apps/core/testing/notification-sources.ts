// notifications 계기 event를 실제 writer 경로로 내는 시험용 등록. 제품 main.ts에는 없다.
// 소유 concern이 아직 발생 command를 내지 않은 계기(ticket·release activation,
// problem close·reopen)와, 발생 command가 core 조립 밖 입력을 많이 요구하는 계기를 같은
// 길로 낸다. event 정의는 각 소유 contract의 것 그대로고, payload는 그 schema가 검사한다.
import { z } from "zod";
import { err, ok } from "../../../packages/base/mod.ts";
import {
  ACTOR_KINDS,
  type CommandDefinition,
  defineCommand,
  type EventDefinition,
} from "../../../packages/contracts/platform/mod.ts";
import { releaseActivationFailed } from "../../../packages/contracts/apps/mod.ts";
import { contextViolationsRecordedEvent } from "../../../packages/contracts/documents/mod.ts";
import {
  ticketCheckFailed,
  ticketConfirmed,
} from "../../../packages/contracts/coding-agent/mod.ts";
import {
  assignmentPaused,
  questionCreated,
} from "../../../packages/contracts/lophn-agent/mod.ts";
import {
  problemClosed,
  problemOpened,
  problemReopened,
} from "../../../packages/contracts/problems/mod.ts";

const SOURCES: readonly EventDefinition[] = [
  problemOpened,
  problemReopened,
  problemClosed,
  questionCreated,
  assignmentPaused,
  ticketConfirmed,
  ticketCheckFailed,
  releaseActivationFailed,
  contextViolationsRecordedEvent,
];

const input = z.strictObject({
  event: z.string(),
  subject: z.string(),
  payload: z.record(z.string(), z.unknown()),
});

const route = defineCommand({
  resource: "notification_sources",
  method: "emit",
  name: "notification_source.emit",
  input,
  output: z.object({ seq: z.string() }),
  actors: ACTOR_KINDS,
  errors: ["invalid_input", "forbidden", "unavailable", "conflict"],
});

export function createCoreRegistration(): {
  commands: readonly CommandDefinition[];
} {
  return {
    commands: [{
      route,
      handle(tx, _ctx, raw) {
        const parsed = input.safeParse(raw);
        const definition = parsed.success
          ? SOURCES.find((source) => source.type === parsed.data.event)
          : undefined;
        if (!parsed.success || definition === undefined) {
          return err({
            code: "invalid_input",
            message: "계기 event 입력이 올바르지 않다",
          });
        }
        const subject = definition.subject.safeParse(parsed.data.subject);
        const payload = definition.payload.safeParse(parsed.data.payload);
        if (!subject.success || !payload.success) {
          return err({
            code: "invalid_input",
            message: `계기 event가 contract schema와 다르다: ${
              JSON.stringify([
                ...(subject.success ? [] : subject.error.issues),
                ...(payload.success ? [] : payload.error.issues),
              ].map((issue) => [issue.path, issue.message]))
            }`,
          });
        }
        const seq = tx.emit(
          definition,
          subject.data as string,
          payload.data,
        );
        return ok({ seq: String(seq) });
      },
    }],
  };
}

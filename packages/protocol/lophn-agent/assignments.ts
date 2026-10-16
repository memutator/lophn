import { z } from "zod";
import { defineEvent } from "../base/event.ts";
import { idSchema } from "../base/ids.ts";
import { positiveRevisionSchema } from "../base/values.ts";
import { pauseReasonOutputSchema } from "./assignment-values.ts";

// 자리(project·app)의 보관·보관 해제 반응 구독자다. notification 구독자와 같은 등록 규칙을 쓴다.

// 사람이 새 Operator 정의를 저장할 때 SaveAgent가 같은 transaction에서 부른다.

// 반응 command의 비교 기준은 기록된 cursor다(createNotification과 같은 모양).

const subject = idSchema("asg");
const revisionPair = {
  before: positiveRevisionSchema,
  after: positiveRevisionSchema,
};

export const assignmentPaused = defineEvent("AssignmentPaused", {
  subject,
  payload: z.object({
    ...revisionPair,
    reason: pauseReasonOutputSchema,
  }),
});


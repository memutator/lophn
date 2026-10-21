import { z } from "zod";
import {
  diagnosticSchema,
  workerRequestSchema,
} from "../supervision/supervision.ts";

// 이 op의 안전 책임은 나눠진다.
// - schema는 wire 모양만 고정한다. 고정 kind의 component·location·ID가 실제로 등록되었는지,
//   현재 process·task·scope가 맞는지는 host ingress가 검사한다.
// - 고정 kind의 값을 안전 설명 또는 null+omission public DiagnosticRecord로 만들고
//   redaction하는 일은 platform owner의 몫이다. schema는 redaction을 대신하지 않는다.
// - 자유 event·fields를 담은 raw LogRecord는 wire로 보내지 않는다. 보낼 수 있는 것은
//   supervision의 고정 strict catalog가 이미 정한 Diagnostic뿐이다.
// - core는 이 op를 fire-and-forget으로 부르고 await하지 않는다. 대기 bytes가
//   DIAGNOSTICS_WRITE_MAX_PENDING_BYTES를 넘으면 기록을 버리고 센다. worker가 없거나
//   응답이 오지 않아도 업무 결과나 ledger 성공을 이 op의 결과로 대신하지 않는다.

// 공개 HTTP route가 아니다. core→platform I/O 비공개 인증 pipe에서만 부른다.
export const DIAGNOSTICS_WRITE_OP = "platform.diagnostics.write";

const DIAGNOSTICS_WRITE_MAX_RECORDS = 256;
// host queue가 이미 받아 둔 기록들의 byte 상한. control frame 전체 상한은
// pipe frame의 CONTROL_MAX_BYTES(256KiB)와 codec이 강제한다. 여기서는 더 낮추지 않는다.
export const DIAGNOSTICS_WRITE_MAX_PENDING_BYTES = 1024 * 1024;

const count = z.number().refine((n) => Number.isSafeInteger(n) && n >= 0, {
  message: "invalid count",
});

export const diagnosticsWriteInputSchema = z.strictObject({
  records: z.array(diagnosticSchema).max(DIAGNOSTICS_WRITE_MAX_RECORDS),
  // 기록이 아니고 개수만 보낸 batches도 보낸다.
  dropped: count,
});

// accepted는 queue ingress가 받은 기록 수다. log 저장 성공도 ledger 확정도 아니다.
// accepted가 그 batch의 records.length 이하라는 것과 dropped이 무엇을 세는지는 host의 책임이다.
const diagnosticsWriteOutputSchema = z.strictObject({
  accepted: count.max(DIAGNOSTICS_WRITE_MAX_RECORDS),
  dropped: count,
});
export type DiagnosticsWriteOutput = z.infer<
  typeof diagnosticsWriteOutputSchema
>;

// JSON 제어(channel 0) 전용이다. stream channel은 거절한다.
export const diagnosticsWriteRequestSchema = workerRequestSchema(
  diagnosticsWriteInputSchema,
).extend({
  op: z.literal(DIAGNOSTICS_WRITE_OP),
  channel: z.never().optional(),
});

// request_id가 요청과 같은지는 runtime이 검사한다. 공통 worker failure는 그대로 쓴다.

// descriptor의 shape만 둔다. HTTP route 등록은 하지 않는다.

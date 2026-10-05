// test 앱 자식의 SDK 보고를 runner가 broker로 받아 collector에 넘긴다
// (architecture/problems 2.2). 자식은 core·collector 주소와 credential을 받지
// 않는다. 자식 메시지로 live 전환이나 결과 기록을 요청할 수 없다.
import { err, ok, type Result } from "../../../base/mod.ts";
import { reportProblemInputSchema } from "../../../contracts/problems/mod.ts";
import type { ReportProblemIngress } from "../../../contracts/problems/mod.ts";

const REJECT = "자식 보고를 받지 않는다";

// collector로 넘기는 보고. mode와 scope는 요청에서 온다. 자식 본문은 못 바꾼다.
export type BrokeredReport = {
  report: ReportProblemIngress;
  mode: "test";
  scope: string;
};

export type ReportSink = (report: BrokeredReport) => Promise<Result<unknown>>;

// 자식이 받는 실행. 주소·credential·mode는 없다. 보고는 private IPC로만 온다.
export type ChildLaunch = {
  args: string[];
  env: Record<string, string>;
};

const ADDRESS_ENV = [
  "LOPHN_CORE",
  "LOPHN_CORE_URL",
  "LOPHN_COLLECTOR",
  "LOPHN_COLLECTOR_URL",
  "LOPHN_APP_BROKER",
];
const CREDENTIAL_ENV = ["LOPHN_CREDENTIAL", "LOPHN_APP_BROKER_CREDENTIAL"];

// 자식 환경과 argv에 core·collector 주소와 credential이 있으면 거절한다.
export function childLaunch(
  args: readonly string[],
  env: Record<string, string>,
): Result<ChildLaunch> {
  const names = Object.keys(env);
  const blocked = [...ADDRESS_ENV, ...CREDENTIAL_ENV];
  if (names.some((name) => blocked.includes(name))) {
    return err({ code: "forbidden", message: REJECT });
  }
  const text = args.join(" ");
  if (blocked.some((name) => text.includes(name))) {
    return err({ code: "forbidden", message: REJECT });
  }
  return ok({ args: [...args], env: { ...env } });
}

// 자식 frame을 보고로 받아 그 요청의 mode=test와 scope를 붙여 collector에 넘긴다.
// 본문의 mode·scope·credential 주장은 보고 입력이 아니라서 schema가 먼저 거절한다.
export async function brokerReport(
  frame: Uint8Array,
  scope: string,
  sink: ReportSink,
): Promise<Result<unknown>> {
  if (scope.trim() === "") {
    return err({ code: "invalid_input", message: REJECT });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(frame),
    );
  } catch {
    return err({ code: "invalid_input", message: REJECT });
  }
  const report = reportProblemInputSchema.safeParse(parsed);
  if (!report.success) return err({ code: "invalid_input", message: REJECT });
  return await sink({ report: report.data, mode: "test", scope });
}

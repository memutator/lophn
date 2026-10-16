// test 자식은 core·collector 주소와 credential을 받지 않는다. 자식 메시지로 live 전환이나 결과 기록을
// 요청할 수 없다. 앱의 SDK 보고는 app-driver.ts의 broker가 받아 그 요청의 mode=test와 scope로 넘긴다.
import { err, ok, type Result } from "../../../../base/mod.ts";

const REJECT = "자식 보고를 받지 않는다";

// 자식이 받는 실행. 주소·credential·mode는 없다. 보고는 private IPC로만 온다.
type ChildLaunch = {
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

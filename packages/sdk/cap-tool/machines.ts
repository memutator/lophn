import { type AppResult, failed, failure, host, plain } from "./connect.ts";

// 사람의 컴퓨터 명단과 이 앱 backend가 도는 컴퓨터. 호출은 core를 거친다(broker). broker 경로는 core의 broker server와 같다
// (SDK는 core를 import하지 않는다).
const MACHINES_LIST_PATH = "/_lophn/broker/machines/list";

export type Machine = {
  /** 컴퓨터 id(`mch_`). `connectCommands`의 `on`에 그대로 쓴다. */
  id: string;
  name: string;
  status: "online" | "offline" | "connecting" | "update";
  /** 이 backend가 도는 컴퓨터. 하나뿐이다. */
  current: boolean;
  /** 그 컴퓨터가 "늘 켜 둠"으로 표시됐나. 그 컴퓨터의 기록이 아직 없으면 null. */
  always_on: boolean | null;
};

const STATUSES = ["online", "offline", "connecting", "update"];

function machineOf(value: unknown): Machine | undefined {
  const row = plain(value);
  if (
    typeof row?.["id"] !== "string" ||
    typeof row["name"] !== "string" ||
    !STATUSES.includes(row["status"] as string) ||
    typeof row["current"] !== "boolean" ||
    (row["always_on"] !== null && typeof row["always_on"] !== "boolean")
  ) {
    return undefined;
  }
  return row as Machine;
}

// 사람의 컴퓨터(폰 제외)를 읽는다. 이 컴퓨터가 처음이다. 허락이 필요 없다. 부모 invocation이 돌고 있지 않아도 된다(시작 코드와 timer에서도
// 읽는다). preview·test는 core에 가지 않고 이 컴퓨터 하나뿐인 목록이다.
export async function machines(): Promise<AppResult<Machine[]>> {
  const port = host();
  if (port === undefined) return failure("machines are not available");
  if (port.mode !== undefined && port.mode !== "live") {
    return {
      ok: true,
      value: [
        {
          id: "mch_preview",
          name: "This computer",
          status: "online",
          current: true,
          always_on: null,
        },
      ],
    };
  }
  let response;
  try {
    response = await port.post(MACHINES_LIST_PATH, {});
  } catch {
    return failure("machines could not reach the broker");
  }
  if (response.status !== 200) return failed(response);
  const rows = plain(response.body)?.["computers"];
  const listed = Array.isArray(rows) ? rows.map(machineOf) : undefined;
  if (listed === undefined || listed.some((one) => one === undefined)) {
    return failure("response did not match");
  }
  return { ok: true, value: listed as Machine[] };
}

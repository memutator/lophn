// collector가 core loopback으로 앱 로그와 진단 상세 수집 설정을 읽는 adapter
// (snapshots#R7, R12). fetch는 주입받는다: core graph의 EXTERNAL_FETCH tripwire가
// bare fetch를 금지하므로 property 접근으로만 부른다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import { appLogsOutputSchema } from "../../../../protocol/apps/mod.ts";
import type { AppLogSource } from "../logs.ts";

// 진단 상세 수집 on/off 설정의 key다. 정의는 core 등록(packages/core/problems/register.ts)이 이 key로 낸다.
export const DETAIL_COLLECTION_SETTING_KEY =
  "problems.diagnostics.detail_collection";

export type CoreCall = {
  baseUrl: string;
  credential: string;
  fetch: (
    input: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => Promise<{ status: number; bytes: Uint8Array }>;
};

async function post(
  client: CoreCall,
  path: string,
  body: unknown,
): Promise<Result<unknown>> {
  let response: { status: number; bytes: Uint8Array };
  try {
    response = await client.fetch(
      `${client.baseUrl.replace(/\/$/, "")}/v1/${path}`,
      {
        method: "POST",
        headers: {
          "authorization": `Bearer ${client.credential}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
  } catch {
    return err({ code: "unavailable", message: "transport failed" });
  }
  if (response.status !== 200) {
    return err({ code: "unavailable", message: `status ${response.status}` });
  }
  try {
    return ok(JSON.parse(new TextDecoder().decode(response.bytes)));
  } catch {
    return err({ code: "unavailable", message: "response is not JSON" });
  }
}

// apps.logs read로 앱 log buffer 조각을 받는다. core가 source를 아직 모르면 state none이다.
export function coreLogSource(client: CoreCall): AppLogSource {
  return async (query) => {
    const read = await post(client, "apps/logs", query);
    if (!read.ok) return read;
    const parsed = appLogsOutputSchema.safeParse(read.value);
    if (!parsed.success) {
      return err({ code: "unavailable", message: "unexpected logs response" });
    }
    return ok(parsed.data);
  };
}

// settings.get으로 읽은 true·false. 읽지 못하거나 boolean이 아니면 null이다.
export async function readDetailCollection(
  client: CoreCall,
): Promise<boolean | null> {
  const read = await post(client, "settings/get", {
    keys: [DETAIL_COLLECTION_SETTING_KEY],
  });
  if (!read.ok) return null;
  const settings = (read.value as { settings?: unknown })?.settings;
  if (!Array.isArray(settings)) return null;
  const found = settings.find((setting) =>
    (setting as { key?: unknown })?.key === DETAIL_COLLECTION_SETTING_KEY
  ) as { value?: unknown } | undefined;
  return typeof found?.value === "boolean" ? found.value : null;
}

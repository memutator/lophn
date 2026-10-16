// collector가 core loopback으로 앱 로그와 진단 상세 수집 설정을 읽는 adapter다.
// fetch는 주입받는다: core graph의 EXTERNAL_FETCH tripwire가
// bare fetch를 금지하므로 property 접근으로만 부른다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import { appLogsOutputSchema } from "../../../../protocol/apps/mod.ts";
import type { AppLogSource } from "../logs.ts";
import {
  DETAIL_COLLECTION_SETTING_KEY,
  detailCollectionSetting,
} from "../settings.ts";

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

// settings/list로 읽은 true·false. 읽지 못하면 null이다. 사람이 고르지 않았거나 core가 아직 모르는
// key면 선언의 기본값이다.
export async function readDetailCollection(
  client: CoreCall,
): Promise<boolean | null> {
  const read = await post(client, "settings/list", {
    keys: [DETAIL_COLLECTION_SETTING_KEY],
  });
  if (!read.ok) return null;
  const settings = (read.value as { settings?: unknown })?.settings;
  if (!Array.isArray(settings)) return null;
  const found = settings.find((setting) =>
    (setting as { key?: unknown })?.key === DETAIL_COLLECTION_SETTING_KEY
  ) as { chosen?: unknown } | undefined;
  if (found === undefined || found.chosen === undefined) {
    return detailCollectionSetting.default ?? null;
  }
  return typeof found.chosen === "boolean" ? found.chosen : null;
}

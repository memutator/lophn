import type { Result } from "../../../base/mod.ts";
import type {
  CatalogEntry,
  PROVIDER_PROTOCOLS,
} from "../../../contracts/lophn-agent/mod.ts";
import type { JsonObject } from "../../../contracts/platform/mod.ts";

// option 값을 호출 형식의 요청으로 옮기는 곳이다(harness/model#R22-R24). 호출 형식마다 effort를
// 요청 필드로 옮기는 표가 하나씩 있고, effort 밖 값은 catalog가 선언한 wire(body patch 또는
// model id 바꾸기)를 그대로 쓴다. model 이름으로 갈라지는 분기는 어디에도 두지 않는다.

export type WireProtocol = (typeof PROVIDER_PROTOCOLS)[number];

export type WirePlan = {
  // 요청에 실을 model 이름. model_id wire가 있으면 바뀐 이름, 없으면 entry.model_name.
  sent_model_name: string;
  // 요청 body에 합칠 조각. 조각이 겹치면 깊게 합친다.
  request_patch: JsonObject;
  // body_patch wire가 싣는 header. 같은 이름은 축 순서대로 쉼표로 잇고(같은 값은 한 번만)
  // 이름이 다르면 따로 둔다. 없으면 {}.
  request_headers: Record<string, string>;
};

// option_values는 options.ts가 default를 채운 뒤의 값이다(없는 축은 요청에 필드가 없다).
// 없는 축·값이거나 그 호출 형식의 표에 없는 effort 값이면 다른 값으로 바꾸지 않고
// invalid_input으로 실패한다(R24).
export function translateOptions(
  _input: {
    protocol: WireProtocol;
    entry: CatalogEntry;
    option_values: Readonly<Record<string, string>>;
  },
): Result<WirePlan> {
  throw new Error("not implemented: agent-I4");
}

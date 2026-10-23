import { fingerprint } from "../../../../base/mod.ts";
import { TOOL_NAME_MAX } from "../../../../protocol/lophn-agent/tool-catalog.ts";

// 앱 tool 이름은 `<domain>_<tool의 . → _>`다. 내장 tool의 `<자원>_<동사>`와 같은 꼴이다. domain 이름에 `_`가 없어 첫 `_` 앞이
// 늘 domain이고, 예약 domain 이름이 내장 자원과 겹침을 막는다. 같은 앱의 두 tool이 같은 이름이 되는 선언은 선언 검사가 거절한다.
// 64자를 넘을 때만 앞을 자르고 이름의 hash 앞 8자를 붙인다. 이름을 parse하지 않는다. 이름 → (앱, tool)은 정의 목록이 안다.
const HASH_LENGTH = 8;

export async function appToolName(
  domain: string,
  tool: string,
): Promise<string> {
  const wire = `${domain}_${tool.replaceAll(".", "_")}`;
  if (wire.length <= TOOL_NAME_MAX) return wire;
  const hash = (await fingerprint(wire)).slice(0, HASH_LENGTH);
  return `${wire.slice(0, TOOL_NAME_MAX - HASH_LENGTH - 1)}_${hash}`;
}

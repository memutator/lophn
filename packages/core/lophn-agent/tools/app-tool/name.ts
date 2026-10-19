import { fingerprint } from "../../../../base/mod.ts";
import {
  DOMAIN_TOOL_PREFIX,
  TOOL_NAME_MAX,
} from "../../../../protocol/lophn-agent/tool-catalog.ts";

// 앱 tool 이름은 `domain__<domain>__<tool>`이다. domain 이름은 전 domain에서 하나라 앱 id 없이 겹치지 않는다. wire 이름 문자(영문, 숫자, 밑줄, 하이픈) 밖의 글자는 밑줄로
// 바꾸고, 바꿨거나 64자를 넘으면 앞부분을 자르고 전체 이름의 hash 앞 8자를 붙인다. 같은 입력은 같은
// 이름이다. 이름을 parse하지 않는다. 이름 → (앱, tool)은 정의 목록이 안다.
const HASH_LENGTH = 8;

export async function appToolName(
  domain: string,
  tool: string,
): Promise<string> {
  const full = `${DOMAIN_TOOL_PREFIX}${domain}__${tool}`;
  const wire = full.replace(/[^A-Za-z0-9_-]/g, "_");
  if (wire === full && full.length <= TOOL_NAME_MAX) return full;
  const hash = (await fingerprint(full)).slice(0, HASH_LENGTH);
  return `${wire.slice(0, TOOL_NAME_MAX - HASH_LENGTH - 1)}_${hash}`;
}

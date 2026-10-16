import { fingerprint } from "../../../../base/mod.ts";
import {
  APP_API_TOOL_PREFIX,
  TOOL_NAME_MAX,
} from "../../../../protocol/lophn-agent/tool-catalog.ts";

// app-api tool 이름은 `app__<앱>__<api>`다. wire 이름 문자(영문, 숫자, 밑줄, 하이픈) 밖의 글자는 밑줄로
// 바꾸고, 바꿨거나 64자를 넘으면 앞부분을 자르고 전체 이름의 hash 앞 8자를 붙인다. 같은 입력은 같은
// 이름이다. 이름을 parse하지 않는다. 이름 → (앱, api)는 정의 목록이 안다.
const HASH_LENGTH = 8;

export async function appApiToolName(
  app: string,
  api: string,
): Promise<string> {
  const full = `${APP_API_TOOL_PREFIX}${app}__${api}`;
  const wire = full.replace(/[^A-Za-z0-9_-]/g, "_");
  if (wire === full && full.length <= TOOL_NAME_MAX) return full;
  const hash = (await fingerprint(full)).slice(0, HASH_LENGTH);
  return `${wire.slice(0, TOOL_NAME_MAX - HASH_LENGTH - 1)}_${hash}`;
}

// shell 크롬의 외부 링크와 provider 공식 로그인 버튼. 확인 창 없이 OS
// 기본 browser로 연다. HTTP·HTTPS이면서 userinfo가 없고 8,192자 이하인 URL만 열고, 기록에는
// origin·path만 남겨 query·fragment(OAuth state·비밀)를 쓰지 않는다. 앱 view의 링크 경로
// (`app:open-external`, app-frame/external-link.ts)와 caller를 섞지 않는다. 이 통로는 desktop 창
// 본문만 부른다.
import { z } from "zod";

import type { OpenExternalReply } from "../../ipc/open-external.ts";
import {
  checkExternalUrl,
  externalLinkRecord,
} from "../app-frame/external-link.ts";
import {
  checkCaller,
  checkInput,
  type ContentsRegistry,
  type IpcEvent,
} from "./ipc-guard.ts";

// 8,192자 검사는 checkExternalUrl이 한다. 입력 상한은 그 위에서 거른다.
const openInputSchema = z.strictObject({ url: z.string() });

interface OpenExternalDeps {
  registry: ContentsRegistry;
  /** OS 기본 browser로 연다. 실패하면 reject한다. */
  open(url: string): Promise<void>;
  log(line: string): void;
}

export function createOpenExternal(deps: OpenExternalDeps) {
  return async (
    event: IpcEvent,
    input: unknown,
  ): Promise<OpenExternalReply> => {
    const caller = checkCaller(deps.registry, event);
    if (!caller.ok || caller.value.origin.host !== "desktop") {
      return { ok: false, code: "forbidden" };
    }
    const parsed = checkInput(openInputSchema, input);
    const url = parsed.ok ? checkExternalUrl(parsed.value.url) : undefined;
    if (url === undefined) return { ok: false, code: "invalid_input" };
    const { origin, path } = externalLinkRecord(url);
    try {
      await deps.open(url);
    } catch {
      deps.log(`shell link not opened origin=${origin} path=${path}`);
      return { ok: false, code: "unavailable" };
    }
    deps.log(`shell link opened origin=${origin} path=${path}`);
    return { ok: true };
  };
}

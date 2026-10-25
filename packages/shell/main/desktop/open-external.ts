// shell 크롬의 외부 링크와 provider 공식 로그인 버튼. 확인 창 없이 OS
// 기본 browser로 연다. HTTP·HTTPS이면서 userinfo가 없고 8,192자 이하인 URL만 열고, 기록에는
// origin·path만 남겨 query·fragment(OAuth state·비밀)를 쓰지 않는다. 앱 view의 링크 경로
// (`app:open-external`, app-frame/external-link.ts)와 caller를 섞지 않는다. desktop 창 본문과
// shell 창의 navigation guard가 이 규칙을 같이 쓴다.
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
  /** OS 기본 browser로 연다. 실패하면 reject한다. */
  open(url: string): Promise<void>;
  log(line: string): void;
}

/**
 * 검사·기록·열기 하나. IPC 통로와 shell 창의 navigation guard가 같은 규칙을 쓴다:
 * http·https만, userinfo 거절, 8,192자 상한, 기록은 origin·path만.
 */
export async function openExternalLink(
  deps: OpenExternalDeps,
  url: string,
): Promise<OpenExternalReply> {
  const checked = checkExternalUrl(url);
  if (checked === undefined) return { ok: false, code: "invalid_input" };
  const { origin, path } = externalLinkRecord(checked);
  try {
    await deps.open(checked);
  } catch {
    deps.log(`shell link not opened origin=${origin} path=${path}`);
    return { ok: false, code: "unavailable" };
  }
  deps.log(`shell link opened origin=${origin} path=${path}`);
  return { ok: true };
}

/** desktop 창 본문의 `shell:open-external`. caller·입력 검사 뒤 같은 함수를 부른다. */
export function createOpenExternal(
  deps: OpenExternalDeps & { registry: ContentsRegistry },
) {
  return async (
    event: IpcEvent,
    input: unknown,
  ): Promise<OpenExternalReply> => {
    const caller = checkCaller(deps.registry, event);
    if (!caller.ok || caller.value.origin.host !== "desktop") {
      return { ok: false, code: "forbidden" };
    }
    const parsed = checkInput(openInputSchema, input);
    if (!parsed.ok) return { ok: false, code: "invalid_input" };
    return await openExternalLink(deps, parsed.value.url);
  };
}

// 프로젝트 등록의 OS 폴더 선택기. 등록된 desktop shell 창의 main frame만
// 열 수 있고, 고른 경로는 그 창에 붙은 OS dialog에서만 나온다. headless 확인은 사람 화면에
// dialog를 띄우지 않고, 개발 확인이 준 폴더(`LOPHN_SHELL_PICK_FOLDER`)만 고른 것으로 돌려준다.
import { isAbsolute } from "node:path";
import { z } from "zod";

import type { FolderPickReply } from "../../ipc/folder-picker.ts";
import type { HeadlessMode } from "./headless.ts";
import {
  checkCaller,
  checkInput,
  type ContentsRegistry,
  type IpcEvent,
} from "./ipc-guard.ts";

const pickInputSchema = z.strictObject({});

export interface FolderDialog {
  /** 부른 창에 붙은 OS 폴더 선택기. 그만두면 canceled다. */
  open(event: IpcEvent): Promise<{ canceled: boolean; paths: string[] }>;
}

export interface FolderPickerDeps {
  registry: ContentsRegistry;
  dialog: FolderDialog;
  headless: HeadlessMode;
  /** headless 확인에서만 읽는 고른 폴더. 제품 실행은 이 값을 보지 않는다. */
  headlessPick?: string;
}

function chosen(path: string | undefined): FolderPickReply {
  return {
    ok: true,
    path: path !== undefined && isAbsolute(path) ? path : null,
  };
}

export function createFolderPicker(deps: FolderPickerDeps) {
  return async (event: IpcEvent, input: unknown): Promise<FolderPickReply> => {
    const caller = checkCaller(deps.registry, event);
    // overlay·앱 view는 프로젝트를 등록하지 않는다. desktop 창 본문만 연다.
    if (!caller.ok || caller.value.origin.host !== "desktop") {
      return { ok: false, code: "forbidden" };
    }
    if (!checkInput(pickInputSchema, input).ok) {
      return { ok: false, code: "invalid_input" };
    }
    if (deps.headless.headless) return chosen(deps.headlessPick);
    try {
      const result = await deps.dialog.open(event);
      return chosen(result.canceled ? undefined : result.paths[0]);
    } catch {
      return { ok: false, code: "unavailable" };
    }
  };
}

// OS 폴더·파일 선택기. 등록된 desktop shell 창의 main frame만 열 수 있고, 고른 경로는 그 창에 붙은
// OS dialog에서만 나온다. dialog 제목은 main이 purpose로 정한다. headless 확인은 사람 화면에
// dialog를 띄우지 않고, 개발 확인이 준 경로(`LOPHN_SHELL_PICK_FOLDER`, `LOPHN_SHELL_PICK_FILE`)만 고른 것으로
// 돌려준다.
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
import { word } from "./wording.ts";

const folderInputSchema = z.strictObject({
  purpose: z.enum(["register", "relocate"]).optional(),
});
const fileInputSchema = z.strictObject({});

const FOLDER_TITLES = {
  register: "common.title.pick-folder-register",
  relocate: "common.title.pick-folder-relocate",
} as const;

export interface PickRequest {
  kind: "folder" | "file";
  /** OS dialog 제목. */
  title: string;
}

export interface PickDialog {
  /** 부른 창에 붙은 OS 선택기. 그만두면 canceled다. */
  open(
    event: IpcEvent,
    request: PickRequest,
  ): Promise<{ canceled: boolean; paths: string[] }>;
}

export interface PickerDeps {
  registry: ContentsRegistry;
  dialog: PickDialog;
  headless: HeadlessMode;
  /** headless 확인에서만 읽는 고른 경로. 제품 실행은 이 값을 보지 않는다. */
  headlessPick?: string;
}

function chosen(path: string | undefined): FolderPickReply {
  return {
    ok: true,
    path: path !== undefined && isAbsolute(path) ? path : null,
  };
}

function createPicker<T>(
  deps: PickerDeps,
  schema: z.ZodType<T>,
  request: (input: T) => PickRequest,
) {
  return async (event: IpcEvent, input: unknown): Promise<FolderPickReply> => {
    const caller = checkCaller(deps.registry, event);
    // overlay·앱 view는 경로를 고르지 않는다. desktop 창 본문만 연다.
    if (!caller.ok || caller.value.origin.host !== "desktop") {
      return { ok: false, code: "forbidden" };
    }
    const checked = checkInput(schema, input);
    if (!checked.ok) return { ok: false, code: "invalid_input" };
    if (deps.headless.headless) return chosen(deps.headlessPick);
    try {
      const result = await deps.dialog.open(event, request(checked.value));
      return chosen(result.canceled ? undefined : result.paths[0]);
    } catch {
      return { ok: false, code: "unavailable" };
    }
  };
}

/** 프로젝트 폴더를 등록하거나 옮길 때 폴더 하나를 고른다. */
export function createFolderPicker(deps: PickerDeps) {
  return createPicker(deps, folderInputSchema, (input) => ({
    kind: "folder",
    title: word(FOLDER_TITLES[input.purpose ?? "register"]),
  }));
}

/** project 밖 파일 하나를 고른다. */
export function createFilePicker(deps: PickerDeps) {
  return createPicker(deps, fileInputSchema, () => ({
    kind: "file",
    title: word("common.title.pick-file"),
  }));
}

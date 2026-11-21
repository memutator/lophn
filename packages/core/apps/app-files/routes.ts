// `app_files/read|put`의 core 쪽 처리기. 자리 규칙은 store.ts에 있고 여기는 어느 앱·영역인지만 정한다.
import { Buffer } from "node:buffer";
import { access } from "node:fs/promises";
import { err, ok } from "../../../base/mod.ts";
import {
  type AppFilesPutInput,
  appFilesPut,
  type AppFilesReadInput,
  appFilesRead,
} from "../../../protocol/apps/app-files.ts";
import {
  appDataFolder,
  appPreviewFolder,
} from "../../../protocol/apps/app-storage.ts";
import type { MemoryHandler } from "../../server/mod.ts";
import type { AppFileStore } from "./store.ts";

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

export type AppFileRouteDeps = {
  dataRoot: string;
  store: AppFileStore;
  /** 앱의 상태. 없는 앱이면 null이다. */
  appStatus(app: string): "active" | "archived" | null;
  /** 그 preview가 지금 도는 것인가. */
  previewRunning(app: string, nonce: string): boolean;
};

export function appFileRoutes(
  deps: AppFileRouteDeps,
): [string, MemoryHandler][] {
  return [
    [
      key(appFilesRead),
      async (_ctx, body) => {
        const { target, file, offset, length } = body as AppFilesReadInput;
        if (deps.appStatus(target.app) === null) {
          return err({ code: "not_found", message: "file not found" });
        }
        let area: string;
        if (target.mode === "preview") {
          // 멈춘 preview의 영역은 없는 것과 같다(지운다).
          if (!deps.previewRunning(target.app, target.process_nonce)) {
            return err({ code: "not_found", message: "file not found" });
          }
          area = appPreviewFolder(
            deps.dataRoot,
            target.app,
            target.process_nonce,
          );
        } else {
          area = appDataFolder(deps.dataRoot, target.app);
        }
        const read = await deps.store.read(area, file, offset, length);
        if (!read.ok) return read;
        const { meta, bytes } = read.value;
        return ok({
          type: meta.type,
          size: meta.size,
          ...(meta.name === undefined ? {} : { name: meta.name }),
          bytes_base64: Buffer.from(bytes).toString("base64"),
        });
      },
    ],
    [
      key(appFilesPut),
      async (_ctx, body) => {
        const input = body as AppFilesPutInput;
        if (deps.appStatus(input.app) !== "active") {
          return err({ code: "not_found", message: "app not found" });
        }
        const area = appDataFolder(deps.dataRoot, input.app);
        // 폰에서만 도는 앱은 컴퓨터에 data 영역이 없다(activation이 컴퓨터에서 도는 앱에만 만든다).
        if (
          !(await access(area).then(
            () => true,
            () => false,
          ))
        ) {
          return err({
            code: "unavailable",
            message: "this app has no data area on this computer",
          });
        }
        return await deps.store.put(area, {
          file: input.file,
          size: input.size,
          type: input.type,
          name: input.name,
          offset: input.offset,
          bytes: Buffer.from(input.bytes_base64, "base64"),
        });
      },
    ],
  ];
}

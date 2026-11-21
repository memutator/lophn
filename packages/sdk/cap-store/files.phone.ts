// 폰 entry의 앱 file이다. 폰에서 도는 backend는 handle을 받아 row에 두고 넘길 뿐 bytes를 읽고 쓰지 못한다.
import { CapabilityError } from "./errors.ts";
import type { AppFileHandle, AppFileMeta, AppFileOptions } from "./files.ts";

function unavailable(): never {
  throw new CapabilityError({
    code: "unavailable",
    message:
      "a backend that runs on the phone passes file handles through; it cannot read or write file bytes",
  });
}

export function putAppFile(
  _bytes: Uint8Array,
  _meta: AppFileMeta,
  _options?: AppFileOptions,
): Promise<AppFileHandle> {
  return Promise.resolve().then(unavailable);
}

export function readAppFile(
  _file: string | { file: string },
  _options?: AppFileOptions,
): Promise<Uint8Array> {
  return Promise.resolve().then(unavailable);
}

export function hasAppFile(
  _file: string | { file: string },
  _options?: AppFileOptions,
): Promise<boolean> {
  return Promise.resolve().then(unavailable);
}

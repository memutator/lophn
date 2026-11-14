// 앱이 낸 tray 값. 값은 core 메모리에만 있어 `tray` 변경이 오면 목록을 다시 읽는다.
import { appTrayList, type TrayValue } from "../../../../protocol/apps/tray.ts";
import { useCoreRead } from "../../desktop/connection/core-read.ts";

const NONE: readonly TrayValue[] = [];

export function useTrayValues(): readonly TrayValue[] {
  const read = useCoreRead(appTrayList, {}).loaded;
  return read.state === "ready" ? read.value.values : NONE;
}

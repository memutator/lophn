// The phone's one drive controller on the native module: the preview screens register in it, and every computer's link
// answers `drive.*` through its port.
import { useEffect, useState } from "react";
import {
  act,
  keepScreenOn,
  screenshot,
  snapshot,
  waitText,
} from "../../../modules/lophn-drive/index.ts";
import {
  createDrive,
  DRIVING_SHOWN_MS,
  type DriveLine,
  type PreviewHandle,
} from "./controller.ts";

export { keepScreenOn };
export type { DriveLine, DrivePort, PreviewHandle } from "./controller.ts";

export const drive = createDrive({
  native: { snapshot, act, screenshot, waitText },
  now: Date.now,
});

/** The preview's driving line, redrawn on every request and when it runs out. */
export function useDriveLine(preview: PreviewHandle | null): DriveLine {
  const [line, setLine] = useState<DriveLine>({ kind: "none" });
  useEffect(() => {
    if (preview === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      setLine(preview.line());
      clearTimeout(timer);
      // A request restarts the count; with none the line goes after DRIVING_SHOWN_MS.
      timer = setTimeout(read, DRIVING_SHOWN_MS + 100);
    };
    read();
    const stop = drive.subscribe(read);
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [preview]);
  return line;
}

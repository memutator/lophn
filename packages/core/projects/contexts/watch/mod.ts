export { createChangeDetector } from "./detector.ts";
export { type FsWatch, startFsWatch } from "./fs.ts";
export { folderCovers, watchFolders } from "./folders.ts";
export type {
  ActiveContext,
  ChangeDetector,
  ChangeDetectorDeps,
  FsEventLike,
  FsWatcherLike,
  Timer,
  TimerHandle,
  WatchDiff,
  WatchFolder,
  WatchFs,
} from "./types.ts";

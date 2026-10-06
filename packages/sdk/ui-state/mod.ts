// loading·empty·error·freshness 상태(apps/sdk#R18)와 앱 화면 root의 AppErrorBoundary(R29).
// 상태 표시는 lophn 화면과 같은 component다(R21).
export {
  AppErrorBoundary,
  type AppErrorBoundaryProps,
  RENDER_ERROR_EVENT,
} from "./app-error-boundary.tsx";
export {
  type Freshness,
  isStale,
  ReadState,
  type ReadStateProps,
} from "./read-state.tsx";
export {
  type EmptyAction,
  EmptyState,
  type EmptyStateProps,
  ErrorState,
  type ErrorStateProps,
  Loading,
  type LoadingProps,
  Skeleton,
  type SkeletonProps,
  type SkeletonShape,
  StaleNote,
  type StaleNoteProps,
  systemTimer,
  type Timer,
} from "@lophn/design/components";

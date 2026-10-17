// feedback: 로딩·빈 상태·오류·상태 표시.
// 내용의 자리 모양만 잡는 placeholder 조각. 첫 조회 지연 규칙까지 필요하면 Loading을 쓴다.
export {
  Skeleton,
  type SkeletonProps,
  type SkeletonShape,
} from "./skeleton/skeleton.tsx";
// 첫 조회가 느릴 때만 skeleton을 보이고 끝나면 내용을 그린다. 짧은 조회에는 깜빡임이 없다.
export { Loading, type LoadingProps } from "./skeleton/skeleton.tsx";
// Loading 같은 지연 규칙만 필요할 때 쓰는 hook. 300ms 안에 끝나면 loading을 보이지 않는다.
export { useDelayedLoading } from "./skeleton/delayed-loading.ts";
// 보여 줄 것이 없을 때. 이유 한 문장과 다음 행동 하나를 둔다. 불러오지 못한 것은 ErrorState다.
export {
  type EmptyAction,
  EmptyState,
  type EmptyStateProps,
} from "./empty-state/empty-state.tsx";
// 불러오지 못했을 때. 대상 이름과 다시 시도만 보이고 원인은 추측하지 않는다.
export {
  ErrorState,
  type ErrorStateProps,
} from "./error-state/error-state.tsx";
// 오래된 값 옆에 마지막 갱신의 나이를 글로 보인다. 값이 없을 때가 아니라 낡았을 때 쓴다.
export { StaleNote, type StaleNoteProps } from "./stale-note/stale-note.tsx";
// 상태 하나를 색과 아이콘과 글로 보이는 표시. 잠깐 뜨는 알림이 필요하면 Toast를 쓴다.
export {
  STATUS_ICONS,
  StatusMark,
  type StatusMarkProps,
} from "./status-mark/status-mark.tsx";
// 읽기 결과의 loading → error → empty → 내용 중 하나만 그리고 오래된 내용에는 나이를 붙인다. 상태를 따로 조립하면 Loading과 EmptyState다.
export { ReadState, type ReadStateProps } from "./read-state/read-state.tsx";
// ReadState에 넘기는 마지막 갱신 시각과 낡음 기준(Freshness), 그리고 낡았는지만 따로 알 때 쓰는 isStale.
export { type Freshness, isStale } from "./read-state/read-state.tsx";

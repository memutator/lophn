// 탭 하나의 읽기 상태 틀. 불러오는 중은 300ms 뒤부터 skeleton, 실패는 실패한 대상과 다시
// 읽기 하나, 읽은 뒤 다시 읽기가 실패하면 마지막으로 확인한 내용과 그 시각을 둔다.
import type { ReactNode } from "react";
import { ErrorState, Loading, Skeleton, StaleNote } from "@lophn/ui/feedback";

import styles from "./app-detail.module.css";
import type { ReadHandle } from "../../desktop/connection/core-read.ts";

interface LoadableProps<T> {
  read: ReadHandle<T>;
  /** 실패한 대상의 사람 말 이름. */
  target: string;
  now: () => Date;
  children: (value: T) => ReactNode;
}

export function Loadable<T>({ read, target, now, children }: LoadableProps<T>) {
  const loaded = read.loaded;
  if (loaded.state === "failed") {
    return <ErrorState target={target} onRetry={read.reload} />;
  }
  if (loaded.state === "loading") {
    return (
      <Loading
        loading
        placeholder={
          <div className={styles.placeholder} aria-busy="true">
            <Skeleton lines={3} />
          </div>
        }
      >
        {null}
      </Loading>
    );
  }
  return (
    <>
      {loaded.staleSince ? (
        <p className={styles.muted} data-stale="">
          <StaleNote updatedAt={loaded.staleSince} now={now()} />
        </p>
      ) : null}
      {children(loaded.value)}
    </>
  );
}

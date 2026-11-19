// 앱 화면을 열지 못했을 때(main이 `unavailable`로 거절) 앱이 꺼져 있거나 아직 뜨는 중이라서인지 읽어 이유를 말하는 안내.
// 꺼져 있으면 [Turn on]을 두고, 앱이 running이 되면 화면을 다시 연다(켠 뒤 탭을 닫았다 열 필요가 없다).
// EmbeddedView의 `renderFailure`에 `useNotRunningFailure`의 값을 꽂아 쓴다.
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ErrorState, Shimmer, useDelayedLoading } from "@lophn/ui/feedback";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";

import { useRunView } from "./app-detail/reads.ts";
import { useAppViews } from "./app-views.tsx";
import styles from "./app-not-running.module.css";

interface NotRunningProps {
  app: string;
  /** 오류 문구에 쓰는 사람 말 이름. */
  label: string;
  /** 화면 열기를 다시 한다(EmbeddedView의 retry). */
  reopen: () => void;
  /** 앱이 running이 된 뒤 한 번 다시 열었는가. 열리면 풀린다. */
  retried: { current: boolean };
}

function AppNotRunning({ app, label, reopen, retried }: NotRunningProps) {
  const deps = useAppViews();
  const { loaded } = useRunView(app);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = loaded.state === "ready" ? loaded.value : null;
  const running = run?.state === "running";
  // 이 안내가 서 있는 동안 멈춘 앱을 본 적이 있는가. 그렇다면 running은 켠 결과라 다시 열 만하다.
  const [seenNotRunning, setSeenNotRunning] = useState(false);
  useEffect(() => {
    if (run !== null && !running) setSeenNotRunning(true);
  }, [run, running]);
  // 안내가 서자마자 running이면(열기가 거절된 사이에 떴다) 한 번만 다시 연다. 또 거절되면 되풀이하지 않는다.
  const fired = useRef(false);
  const reopening =
    fired.current || (running && (seenNotRunning || !retried.current));
  useEffect(() => {
    if (!running || !reopening || fired.current) return;
    fired.current = true;
    retried.current = true;
    reopen();
  }, [running, reopening]);

  const showStarting = useDelayedLoading(run === null || running);
  if (loaded.state === "failed" || (running && !reopening)) {
    return (
      <ErrorState
        target={label}
        onRetry={() => {
          retried.current = false;
          reopen();
        }}
      />
    );
  }
  if (run === null || running) {
    if (!showStarting) return null;
    return (
      <div className={styles.state} aria-busy="true">
        <p className={styles.text}>
          <Shimmer>{t("app-space.empty.app-starting")}</Shimmer>
        </p>
      </div>
    );
  }
  if (!run.enabled) {
    const enableRun = deps?.enableRun;
    return (
      <div className={styles.state} data-app-off="">
        <p className={styles.text}>{t("app-space.empty.app-off")}</p>
        {failed ? (
          <p className={styles.text}>{t("app-detail.error.run-failed-on")}</p>
        ) : null}
        {/* 다른 기계의 앱은 그 기계에서 켠다(App details는 이 컴퓨터만). */}
        {enableRun === undefined ? null : (
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setFailed(false);
              void enableRun(app).then((result) => {
                setBusy(false);
                setFailed(!result.ok);
              });
            }}
          >
            {t("app-space.button.turn-on")}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className={styles.state} data-app-starting="">
      <p className={styles.text}>
        {run.state === "halted"
          ? t("app-detail.note.run-halted")
          : t("app-space.empty.app-starting")}
      </p>
    </div>
  );
}

/**
 * EmbeddedView에 꽂는 두 값. `renderFailure`는 `unavailable` 거절에만 안내를 그리고 나머지는 null(기본 오류)이다.
 * `onOpened`는 화면이 열릴 때 부르면 다음 거절에 다시 한 번 열어 본다.
 */
export function useNotRunningFailure(app: string, label: string) {
  const retried = useRef(false);
  return {
    renderFailure(code: string, reopen: () => void): ReactNode | null {
      return code === "unavailable" ? (
        <AppNotRunning
          app={app}
          label={label}
          reopen={reopen}
          retried={retried}
        />
      ) : null;
    },
    onOpened(): void {
      retried.current = false;
    },
  };
}

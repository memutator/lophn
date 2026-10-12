// shell#T57 start failure screen showing distinct launcher failure states.
// Shows start, sandbox, or schema failure without normal launcher appearance.

import { type ReactElement, useId, useState } from "react";
import { Button, Icon, iconPixels } from "@lophn/design/components";
import { connectionFailedIcon, retryIcon } from "../../../icons/mod.ts";
import { t } from "@lophn/wording";

import type { StartFailure } from "./model.ts";
import styles from "./start-failure.module.css";

export interface StartFailureProps {
  failure: StartFailure;
  /** 연결을 다시 확인한다. 세 갈래 모두 사람이 할 수 있는 행동은 다시 시도 하나다. */
  onRetry: () => void;
}

/** 시작 실패·sandbox 실패·schema 비호환을 구별하여 사람 말로 보이고 다음 행동 하나를 준다. */
export function StartFailureScreen(
  { failure, onRetry }: StartFailureProps,
): ReactElement {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  return (
    <div className={styles.screen} role="alert" data-kind={failure.kind}>
      <Icon
        icon={connectionFailedIcon}
        pixels={iconPixels("large")}
        className={styles.icon}
      />
      <h1 className={styles.title}>{t(failure.title)}</h1>
      <p className={styles.text}>{t(failure.text)}</p>
      <Button
        variant="primary"
        icon={retryIcon}
        data-action="retry"
        onClick={onRetry}
      >
        {t("launcher.button.retry")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={detailsId}
        data-details-toggle=""
        onClick={() => setOpen(!open)}
      >
        {t(
          open
            ? "launcher.button.hide-details"
            : "launcher.button.show-details",
        )}
      </Button>
      {open
        ? (
          <p className={styles.details} id={detailsId} data-details="">
            {failure.message} · {failure.nextAction}
          </p>
        )
        : null}
    </div>
  );
}

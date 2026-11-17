// 시작 실패 화면. 시작·sandbox·schema 세 경우를 연결 화면 대신 보이고, 다음 행동 하나를 준다.
import { type ReactElement, useId, useState } from "react";
import { Button, Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { actionIcons, connectionFailedIcon } from "../../../icons/mod.ts";
import { t } from "@lophn/i18n";

import type { StartFailure } from "./model.ts";
import styles from "./start-failure.module.css";

interface StartFailureProps {
  failure: StartFailure;
  /** 연결을 다시 확인한다. 사람이 할 수 있는 행동은 다시 시도 하나다. */
  onRetry: () => void;
}

export function StartFailureScreen({
  failure,
  onRetry,
}: StartFailureProps): ReactElement {
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
      {failure.update === undefined ? null : (
        <p className={styles.textSmall}>{t(failure.update)}</p>
      )}
      {failure.recovery === undefined ? null : (
        <p className={styles.textSmall} data-recovery="">
          {t(failure.recovery)}
        </p>
      )}
      <Button
        variant="primary"
        icon={actionIcons.retry}
        data-action="retry"
        onClick={onRetry}
      >
        {t("home.button.retry")}
      </Button>
      {failure.details === undefined ? null : (
        <>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-controls={detailsId}
            data-details-toggle=""
            onClick={() => setOpen(!open)}
          >
            {t(open ? "home.button.hide-details" : "home.button.show-details")}
          </Button>
          {open ? (
            <p className={styles.details} id={detailsId} data-details="">
              {t(failure.details)}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

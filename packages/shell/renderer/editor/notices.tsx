// 파일 탭 위쪽 toast. 그 탭 본문 위에 떠서 가운데에 놓인다. 밖(다른 편집기, git)에서 바뀐 것,
// 충돌, 열거나 지우지 못한 것을 알린다. 색 다른 띠나 상자를 따로 두지 않고 design Toast를 쓴다.
import type { ReactNode } from "react";
import { Toast } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import { actionIcons, editorIcons } from "../icons/mod.ts";

import styles from "./notices.module.css";

/** 탭 본문 위쪽 가운데에 toast를 놓는 자리. */
function TabToast({ children }: { children: ReactNode }) {
  return <div className={styles.slot}>{children}</div>;
}

/** 고치지 않은 파일이 밖에서 바뀌어 다시 읽었다는 짧은 알림. */
export function ReloadedToast({ onClose }: { onClose: () => void }) {
  return (
    <TabToast>
      <Toast
        title={t("document.title.reloaded")}
        body={t("document.notice.reloaded")}
        onClose={onClose}
      />
    </TabToast>
  );
}

interface ConflictToastProps {
  comparing: boolean;
  onKeepMine: () => void;
  onUseDisk: () => void;
  onCompare: () => void;
  onClose: () => void;
}

/** 고치는 중에 디스크가 바뀌었다. 어느 쪽을 남길지 고르고 디스크 쪽과 비교해 볼 수 있다. */
export function ConflictToast({
  comparing,
  onKeepMine,
  onUseDisk,
  onCompare,
  onClose,
}: ConflictToastProps) {
  const choose = (id: string) => {
    if (id === "compare") onCompare();
    else if (id === "disk") onUseDisk();
    else onKeepMine();
  };
  return (
    <TabToast>
      <Toast
        tone="error"
        role="alert"
        title={t("document.title.conflict")}
        body={t("document.notice.conflict")}
        actions={[
          {
            id: "compare",
            icon: editorIcons.compare,
            label: comparing
              ? t("document.button.hide-comparison")
              : t("document.button.compare"),
          },
          {
            id: "disk",
            icon: actionIcons.download,
            label: t("document.button.use-disk"),
          },
          {
            id: "mine",
            icon: actionIcons.save,
            label: t("document.button.keep-mine"),
            variant: "primary",
          },
        ]}
        onAction={choose}
        onClose={onClose}
      />
    </TabToast>
  );
}

/** 열거나 지우지 못했다는 알림(error)과 짧은 안내(neutral). */
export function NoticeToast({
  title,
  tone = "error",
  onClose,
}: {
  title: string;
  tone?: "neutral" | "error";
  onClose: () => void;
}) {
  return (
    <TabToast>
      <Toast tone={tone} title={title} onClose={onClose} />
    </TabToast>
  );
}

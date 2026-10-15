// 밖(다른 편집기, git)에서 파일이 바뀐 때의 toast와 충돌 화면. 저장 상태는 디스크 저장과 충돌 둘뿐이다.
import type { ReactNode } from "react";
import { DiffMark, IconButton, StatusMark } from "@lophn/design/components";
import { Button } from "@lophn/ui-control";

import { workspaceIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";
import toastStyles from "../../../../../packages/design/components/toast/toast.module.css";
import type { SaveState } from "./file-data.ts";
import styles from "./files.module.css";

/** view bar의 저장 상태. 저장됨과 저장 중은 흐린 글, 충돌은 경고 표시다. */
export function SaveMark({ status }: { status: SaveState }) {
  if (status === "conflict") {
    return (
      <span className={styles.save}>
        <StatusMark tone="warning" label="Conflict" />
      </span>
    );
  }
  return (
    <span className={styles.save}>
      {status === "saving" ? "Saving…" : "Saved"}
    </span>
  );
}

/** 탭 안 위쪽 toast. 그 탭 본문 위에 떠서 가운데에 놓이고 단추는 오른쪽 끝이다. */
function TabToast(
  { title, body, role, children }: {
    title: string;
    body: string;
    role: "status" | "alert";
    children: ReactNode;
  },
) {
  return (
    <div className={styles.tabToast}>
      <div
        className={`${toastStyles.toast} ${styles.tabToastBox}`}
        role={role}
      >
        <div className={toastStyles.text}>
          <p className={toastStyles.title}>{title}</p>
          <p className={toastStyles.body}>{body}</p>
        </div>
        <div className={styles.tabToastActions}>{children}</div>
      </div>
    </div>
  );
}

/** 고치지 않은 파일이 밖에서 바뀌어 다시 읽었다는 짧은 알림. */
export function ReloadedToast({ onDismiss }: { onDismiss: () => void }) {
  return (
    <TabToast
      role="status"
      title="Updated from disk"
      body="This file changed outside lophn, so it was read again."
    >
      <IconButton
        icon={workspaceIcons.close}
        label="Dismiss"
        size="sm"
        onClick={onDismiss}
      />
    </TabToast>
  );
}

/** 고치는 중에 디스크가 바뀌었다. 어느 쪽을 남길지 고르고 디스크 쪽과 비교해 볼 수 있다. */
export function ConflictToast(
  { comparing, onKeepMine, onUseDisk, onCompare }: {
    comparing: boolean;
    onKeepMine: () => void;
    onUseDisk: () => void;
    onCompare: () => void;
  },
) {
  return (
    <TabToast
      role="alert"
      title="This file changed on disk while you were editing"
      body="Choose which version to keep."
    >
      <Button size="sm" onClick={onCompare}>
        {comparing ? "Hide comparison" : "Compare"}
      </Button>
      <Button size="sm" onClick={onUseDisk}>Use disk version</Button>
      <Button size="sm" variant="primary" onClick={onKeepMine}>
        Keep my version
      </Button>
    </TabToast>
  );
}

interface Row {
  readonly disk: string;
  readonly mine: string;
}

const ROWS: readonly Row[] = [
  { disk: "## 성공 기준", mine: "## 성공 기준" },
  { disk: "", mine: "" },
  {
    disk: "Success: world_actions stays at 0 on every read-only scenario.",
    mine: "Success: world_actions stays at 0 and answer_match stays above 0.8.",
  },
  { disk: "", mine: "" },
  { disk: "## 찾은 것", mine: "## 찾은 것" },
  { disk: "F-009 · F-010 · F-011", mine: "F-009 · F-010" },
];

/** 디스크 쪽과 내 쪽을 나란히 보인다. 다른 줄은 +/− 기호와 배경으로 구별한다. */
export function ConflictCompare() {
  const column = (side: "disk" | "mine") => (
    <div className={styles.compareCol}>
      <div className={styles.compareHead}>
        {side === "disk" ? "On disk" : "Your edits"}
        <span>{side === "disk" ? "changed 1 minute ago" : "not saved"}</span>
      </div>
      {ROWS.map((row, index) => {
        const changed = row.disk !== row.mine;
        const kind = side === "disk" ? "delete" : "add";
        return (
          <div
            key={index}
            className={styles.diffLine}
            data-diff={changed ? kind : undefined}
          >
            <span className={styles.diffSign}>
              {changed ? <DiffMark kind={kind} /> : null}
            </span>
            <span>{row[side] || " "}</span>
          </div>
        );
      })}
    </div>
  );
  return (
    <div className={styles.compare} aria-label="Compare with disk">
      {column("disk")}
      {column("mine")}
    </div>
  );
}

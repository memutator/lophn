// 밖(다른 편집기, git)에서 파일이 바뀐 때의 toast와 충돌 화면. 저장 상태는 디스크 저장과 충돌 둘뿐이다.
// 모두 renderer 편집기의 component(`packages/shell/renderer/editor`)가 그린다. 이 파일은 gallery가
// 부르는 이름과 props를 유지하고 고정 data만 채운다.
import {
  ConflictToast as EditorConflictToast,
  ReloadedToast as EditorReloadedToast,
} from "../../../../../packages/shell/renderer/editor/notices.tsx";
import { ConflictCompare as EditorConflictCompare } from "../../../../../packages/shell/renderer/editor/conflict/conflict-compare.tsx";

/** 고치지 않은 파일이 밖에서 바뀌어 다시 읽었다는 짧은 알림. */
export function ReloadedToast({ onDismiss }: { onDismiss: () => void }) {
  return <EditorReloadedToast onClose={onDismiss} />;
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
    <EditorConflictToast
      comparing={comparing}
      onKeepMine={onKeepMine}
      onUseDisk={onUseDisk}
      onCompare={onCompare}
      onClose={() => {}}
    />
  );
}

const DISK = [
  "## 성공 기준",
  "",
  "Success: world_actions stays at 0 on every read-only scenario.",
  "",
  "## 찾은 것",
  "F-009 · F-010 · F-011",
].join("\n");

const MINE = [
  "## 성공 기준",
  "",
  "Success: world_actions stays at 0 and answer_match stays above 0.8.",
  "",
  "## 찾은 것",
  "F-009 · F-010",
].join("\n");

/** 디스크 쪽과 내 쪽을 나란히 보인다. 다른 줄은 +/− 기호와 배경으로 구별한다. */
export function ConflictCompare() {
  return <EditorConflictCompare disk={DISK} mine={MINE} />;
}

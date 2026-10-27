// document_editor 탭을 다른 창으로 옮기기 전 확인. 받는 창은 디스크에서 다시 열므로 글을 싣지
// 않고, 마지막 고침이 디스크에 닿은 뒤에만 옮긴다.
import type { TabTransfer } from "../../ipc/detached.ts";
import type { EditorSessions } from "./sessions.ts";

/** 옮겨도 되면 value가 null인 transfer, 아니면 null(탭은 그대로, 글을 잃지 않는다). */
export async function transferEditor(
  sessions: Pick<EditorSessions, "flush">,
  path: string,
): Promise<TabTransfer | null> {
  return (await sessions.flush(path)) ? { value: null, views: [] } : null;
}

import { useState } from "react";
import { t } from "@lophn/wording";

import type { ContextsSource } from "./source.ts";
import { FocusList } from "./list/focus-list.tsx";
import { FocusDetail } from "./detail/focus-detail.tsx";
import listStyles from "../documents/documents.module.css";

export interface ContextsScreenProps {
  source: ContextsSource;
  /** 처음 열 Focus. 팔레트·정보 패널의 컨텍스트 탭이 준다. */
  initialFocus?: string;
  /**
   * core 연결이 (다시) 준비될 때마다 오른다. 마지막으로 읽은 것을 둔 채 현재 기록을 다시
   * 읽는다(flow build-context의 연결 끊김).
   */
  connected?: number;
  /** 문서를 documents 화면에서 읽는다. 판이 없으면 최신 판이다. */
  onRead: (
    document: string,
    version: string | null,
    section: string | null,
  ) => void;
  /** 대화 도크를 연다. 없으면 대화 행동을 두지 않는다. */
  onAsk?: () => void;
  /** 사람이 고른 곳에 글을 저장한다. 테스트가 바꾼다. */
  save?: (name: string, text: string) => void;
}

// 사람이 저장 위치를 고르는 내려받기. Electron이 저장 창을 연다.
function download(name: string, text: string): void {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/markdown;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// contexts 화면. 왼쪽 목록 칸에서 Focus를 고르고 오른쪽에서 항목·뜻을 본다(desktop#R28).
export function ContextsScreen(
  { source, initialFocus, connected = 0, onRead, onAsk, save = download }:
    ContextsScreenProps,
) {
  const [current, setCurrent] = useState<string | null>(initialFocus ?? null);
  const [revision, setRevision] = useState(0);
  return (
    <div className={listStyles.screen} data-screen-body="contexts">
      <div className={listStyles.listColumn} data-list-column="">
        <FocusList
          source={source}
          revision={revision + connected}
          current={current}
          onOpen={setCurrent}
          onAsk={onAsk}
        />
      </div>
      <div className={listStyles.detailColumn} data-detail-column="">
        {current === null
          ? (
            <p className={listStyles.placeholder} data-detail="none">
              {t("contexts.empty.pick-focus")}
            </p>
          )
          : (
            <FocusDetail
              key={current}
              source={source}
              id={current}
              connected={connected}
              onRead={onRead}
              onAsk={onAsk}
              onChanged={() => setRevision((value) => value + 1)}
              save={save}
            />
          )}
      </div>
    </div>
  );
}

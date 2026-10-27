import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Clipboard,
  systemTimer,
  type Timer,
} from "../../_shared/shared.ts";

// 복사했다는 표시가 남는 시간.
const COPIED_MS = 2000;

export interface CopyState {
  // 마지막 복사가 실패했으면 true. 다음 성공에서 지운다.
  failed: boolean;
  // 방금 복사했으면 true. 잠시 뒤 저절로 지운다.
  copied: boolean;
  copy(text: string): void;
}

// 복사 실패(sync throw와 rejection 모두)를 상태로 바꿔 화면에 보이고 같은 버튼으로 다시 시도하게 한다.
// unmount 뒤나 더 새로운 시도가 있은 뒤에 끝난 결과는 상태를 바꾸지 않는다.
export function useCopy(
  clipboard: Clipboard,
  timer: Timer = systemTimer,
): CopyState {
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const mounted = useRef(true);
  const attempt = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!copied) return;
    const handle = timer.set(() => setCopied(false), COPIED_MS);
    return () => timer.clear(handle);
  }, [copied, timer]);
  const copy = useCallback(
    (text: string) => {
      const id = ++attempt.current;
      const settle = (ok: boolean) => {
        if (!mounted.current || id !== attempt.current) return;
        setFailed(!ok);
        setCopied(ok);
      };
      let pending: Promise<void>;
      try {
        pending = Promise.resolve(clipboard.writeText(text));
      } catch {
        settle(false);
        return;
      }
      pending.then(
        () => settle(true),
        () => settle(false),
      );
    },
    [clipboard],
  );
  return { failed, copied, copy };
}

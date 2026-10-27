// domain 목록 읽기와 쓰기 상태. project 창의 Domains 탭과 앱 상세의 Domains 절이 같이 쓴다.
// 만들기·보관 뒤에는 목록을 다시 읽는다(목록은 core가 정본이다).
import { useCallback, useEffect, useState } from "react";

import type {
  DomainActions,
  DomainDraft,
  DomainOpResult,
  DomainOwner,
  DomainView,
} from "../source.ts";

type Loaded<T> =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly domains: readonly T[] };

/** 목록 위에 뜨는 알림 하나. 보관하면 되돌리기를, 거절되면 그 이유를 보인다. */
export type DomainNotice =
  | { readonly kind: "archived"; readonly domain: DomainView }
  | {
      readonly kind: "refused";
      readonly domain: DomainView;
      readonly reason: string;
    };

export function useDomains<T extends DomainView>(
  owner: DomainOwner,
  load: () => Promise<
    { readonly ok: true; readonly value: readonly T[] } | { readonly ok: false }
  >,
  actions: DomainActions,
) {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: "loading" });
  const [notice, setNotice] = useState<DomainNotice | null>(null);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((count) => count + 1), []);

  useEffect(() => {
    let live = true;
    void load().then((read) => {
      if (!live) return;
      setLoaded(
        read.ok ? { state: "ready", domains: read.value } : { state: "failed" },
      );
    });
    return () => {
      live = false;
    };
  }, [owner.kind, owner.id, attempt]);

  async function create(draft: DomainDraft): Promise<DomainOpResult> {
    const result = await actions.createDomain(owner, draft);
    if (result.ok) reload();
    return result;
  }

  async function archive(domain: DomainView): Promise<void> {
    const result = await actions.archiveDomain(domain.id);
    setNotice(
      result.ok
        ? { kind: "archived", domain }
        : { kind: "refused", domain, reason: result.message },
    );
    if (result.ok) reload();
  }

  async function undo(domain: DomainView): Promise<void> {
    setNotice(null);
    await actions.unarchiveDomain(domain.id);
    reload();
  }

  return {
    loaded,
    notice,
    closeNotice: () => setNotice(null),
    reload,
    create,
    archive,
    undo,
  };
}

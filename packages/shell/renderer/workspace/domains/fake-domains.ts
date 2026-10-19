// domain 쓰기의 메모리 구현. fake source들이 같이 쓴다. core와 같은 규칙만 갖는다:
// name은 보관한 것까지 하나이고, keepOne이면(앱) 마지막 active domain은 보관하지 못한다.
import type { DomainActions, DomainOpResult, DomainView } from "../source.ts";

const fail = (code: string, message: string): DomainOpResult => ({
  ok: false,
  code,
  message,
});

export function fakeDomainStore(
  initial: readonly DomainView[],
  keepOne = false,
) {
  let rows: readonly DomainView[] = initial;
  const set = (id: string, status: DomainView["status"]) => {
    rows = rows.map((row) => row.id === id ? { ...row, status } : row);
  };
  const actions: DomainActions = {
    createDomain(_owner, draft) {
      if (rows.some((row) => row.name === draft.name)) {
        return Promise.resolve(fail("conflict", "domain name already exists"));
      }
      rows = [...rows, {
        id: `dom_fake${rows.length + 1}`,
        ...draft,
        status: "active",
      }];
      return Promise.resolve({ ok: true });
    },
    archiveDomain(id) {
      const active = rows.filter((row) => row.status === "active");
      if (keepOne && active.length <= 1) {
        return Promise.resolve(
          fail("conflict", "the last domain of an app cannot be archived"),
        );
      }
      set(id, "archived");
      return Promise.resolve({ ok: true });
    },
    unarchiveDomain(id) {
      set(id, "active");
      return Promise.resolve({ ok: true });
    },
  };
  return {
    active: () => rows.filter((row) => row.status === "active"),
    actions,
  };
}

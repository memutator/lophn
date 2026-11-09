// Browser 항목의 가짜 통로. shell을 부르지 않고 부른 일을 calls에 둔다.
import type { Bookmark } from "../../../../../ipc/browser.ts";
import type {
  BrowserSettingsSource,
  Device,
  LinkValues,
  LoginRow,
  SourceResult,
} from "../source.ts";

interface FakeBrowserSettingsOptions {
  /** 지우기가 거절되는 code. 없으면 지워진다. */
  clearCode?: string;
  /** 처음 목록. 없으면 화면 확인용 대표 셋이다. */
  bookmarks?: Bookmark[];
  /** 파일이 깨진 상태. */
  corrupt?: boolean;
  /** 고치기와 지우기가 거절되는 BookmarkReason. 없으면 된다. */
  writeCode?: string;
  /** 처음 link 열 곳. 없으면 둘 다 Browser tab이다. */
  links?: Partial<LinkValues>;
  /** link 고르기가 거절되는 code. 없으면 저장된다. */
  linkCode?: string;
  /** 처음 기기 목록. 없으면 비어 있다. */
  devices?: Device[];
  /** 처음 login 목록. 없으면 비어 있다. */
  logins?: LoginRow[];
  /** 보호 입력 창을 닫는 결과. 없으면 값을 넣는다. */
  secretResult?: "stored" | "cancelled";
}

const sample = (n: number, title: string, url: string): Bookmark => ({
  id: `bookmark-${n}`,
  title,
  url,
  created_at: "2026-01-01T00:00:00.000Z",
});

export function fakeBrowserSettings(options: FakeBrowserSettingsOptions = {}) {
  const calls: unknown[][] = [];
  let list = options.bookmarks ?? [
    sample(1, "Deno", "https://deno.com/"),
    sample(2, "MDN Web Docs", "https://developer.mozilla.org/"),
    sample(3, "Example", "https://example.com/"),
  ];
  let links: LinkValues = {
    web_links: "browser_tab",
    local_links: "browser_tab",
    ...options.links,
  };
  let devices: readonly Device[] = options.devices ?? [];
  let logins: readonly LoginRow[] = options.logins ?? [];
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((listener) => listener());
  const refused = (code: string): Promise<SourceResult<null>> =>
    Promise.resolve({ ok: false, code });
  const source: BrowserSettingsSource = {
    clearData() {
      calls.push(["clearData"]);
      return Promise.resolve(
        options.clearCode
          ? { ok: false, code: options.clearCode }
          : { ok: true, value: null },
      );
    },
    bookmarks() {
      calls.push(["bookmarks"]);
      return Promise.resolve({
        ok: true,
        value: options.corrupt
          ? { state: "corrupt" }
          : { state: "ok", bookmarks: list },
      });
    },
    updateBookmark(input) {
      calls.push(["updateBookmark", input]);
      if (options.writeCode) return refused(options.writeCode);
      const title = input.title.trim();
      if (title === "") return refused("title");
      if (!/^https?:\/\//.test(input.url)) return refused("url");
      if (list.some((b) => b.id !== input.id && b.url === input.url)) {
        return refused("duplicate");
      }
      list = list.map((b) =>
        b.id === input.id ? { ...b, title, url: input.url } : b,
      );
      changed();
      return Promise.resolve({ ok: true, value: null });
    },
    removeBookmark(id) {
      calls.push(["removeBookmark", id]);
      if (options.writeCode) return refused(options.writeCode);
      list = list.filter((b) => b.id !== id);
      changed();
      return Promise.resolve({ ok: true, value: null });
    },
    links() {
      calls.push(["links"]);
      return Promise.resolve({ ok: true, value: links });
    },
    chooseLink(id, value) {
      calls.push(["chooseLink", id, value]);
      if (options.linkCode) return refused(options.linkCode);
      links = { ...links, [id]: value };
      return Promise.resolve({ ok: true, value: null });
    },
    devices() {
      calls.push(["devices"]);
      return Promise.resolve({ ok: true, value: devices });
    },
    saveDevices(list) {
      calls.push(["saveDevices", list]);
      // core의 선언이 거절하는 것 가운데 이름 겹침만 흉내 낸다.
      if (new Set(list.map((d) => d.name)).size !== list.length) {
        return refused("invalid_value");
      }
      devices = list;
      return Promise.resolve({ ok: true, value: null });
    },
    logins() {
      calls.push(["logins"]);
      return Promise.resolve({ ok: true, value: logins });
    },
    saveLogin(input) {
      calls.push(["saveLogin", input]);
      const { id, ...form } = input;
      logins =
        id === undefined
          ? [
              ...logins,
              {
                ...form,
                id: `lgn_fake${logins.length}`,
                password: false,
                totp: false,
              },
            ]
          : logins.map((l) => (l.id === id ? { ...l, ...form } : l));
      return Promise.resolve({ ok: true, value: null });
    },
    deleteLogin(id) {
      calls.push(["deleteLogin", id]);
      logins = logins.filter((l) => l.id !== id);
      return Promise.resolve({ ok: true, value: null });
    },
    enterLoginSecret(login, field) {
      calls.push(["enterLoginSecret", login.id, field]);
      const result = options.secretResult ?? "stored";
      if (result === "stored") {
        logins = logins.map((l) =>
          l.id === login.id ? { ...l, [field]: true } : l,
        );
      }
      return Promise.resolve({ ok: true, value: result });
    },
    watchBookmarks(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { source, calls };
}

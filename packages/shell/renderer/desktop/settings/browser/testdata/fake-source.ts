// Browser 항목의 가짜 통로. shell을 부르지 않고 부른 일을 calls에 둔다. link 열 곳과 기기는 가짜 core의 설정이고
// browser profile과 login은 가짜 core의 `browser_profiles/list`·`logins/list` 답이다.
import type { Bookmark } from "../../../../../ipc/browser.ts";
import { agentList } from "../../../../../../protocol/lophn-agent/agent-definitions.ts";
import { BROWSER_PROFILES_MAX } from "../../../../../../protocol/shell/browser-profiles.ts";
import {
  BROWSER_SHARE_SETTING,
  browserProfilesList,
} from "../../../../../../protocol/secrets/browser-vault.ts";
import {
  loginSecretName,
  loginsList,
} from "../../../../../../protocol/secrets/logins.ts";
import { fakeAnswer } from "../../../connection/events/fake-source.ts";
import { type FakeCore, fakeCore } from "../../testdata/fake-core.ts";
import { DEVICES_KEY, LINK_ROWS } from "../model.ts";
import type {
  BrowserProfile,
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
  /** 다른 컴퓨터와 나누기. 없으면 켜져 있다. */
  share?: boolean;
  /** 처음 browser profile 목록(기본 profile은 들지 않는다). 없으면 비어 있다. */
  profiles?: BrowserProfile[];
  /** profile을 쓰는 agent. 있으면 `agents/list`가 이 목록으로 답한다(없으면 다른 fake의 답이 그대로다). */
  agents?: { id: string; name: string; profile: string | null }[];
  /** 보호 입력 창을 닫는 결과. 없으면 값을 넣는다. */
  secretResult?: "stored" | "cancelled";
  /** 값을 둘 가짜 core. 없으면 새로 만든다. */
  core?: FakeCore;
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
  const core = options.core ?? fakeCore();
  const links: LinkValues = {
    web_links: "browser_tab",
    local_links: "browser_tab",
    ...options.links,
  };
  for (const row of LINK_ROWS) core.set(row.settingKey, links[row.id]);
  core.set(DEVICES_KEY, options.devices ?? []);
  core.set(BROWSER_SHARE_SETTING, options.share ?? true);
  let profiles: readonly BrowserProfile[] = options.profiles ?? [];
  let logins: readonly LoginRow[] = options.logins ?? [];
  const passwords = () => {
    for (const login of logins) {
      core.secret(loginSecretName(login.id, "password"), login.password);
    }
  };
  passwords();
  core.answers.push(
    fakeAnswer(browserProfilesList, () => ({
      profiles: [...profiles],
      clear: [],
    })),
    fakeAnswer(loginsList, () =>
      logins.map(({ password: _password, ...login }) => login),
    ),
  );
  if (options.agents !== undefined) {
    // 같은 route의 다른 fake 답보다 앞에 둬야 이긴다.
    core.answers.unshift(
      fakeAnswer(agentList, {
        as_of_seq: "0",
        next_cursor: null,
        agents: options.agents.map((agent) => ({
          agent: agent.id,
          name: agent.name,
          browser_profile: agent.profile,
        })),
      } as never),
    );
  }
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((listener) => listener());
  const refused = (code: string): Promise<SourceResult<null>> =>
    Promise.resolve({ ok: false, code });
  const source: BrowserSettingsSource = {
    clearData(profile) {
      calls.push(["clearData", profile]);
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
    chooseLink(id, value) {
      calls.push(["chooseLink", id, value]);
      if (options.linkCode) return refused(options.linkCode);
      core.set(LINK_ROWS.find((row) => row.id === id)!.settingKey, value);
      core.changed("settings");
      return Promise.resolve({ ok: true, value: null });
    },
    saveDevices(list) {
      calls.push(["saveDevices", list]);
      // core의 선언이 거절하는 것 가운데 이름 겹침만 흉내 낸다.
      if (new Set(list.map((d) => d.name)).size !== list.length) {
        return refused("invalid_value");
      }
      core.set(DEVICES_KEY, list);
      core.changed("settings");
      return Promise.resolve({ ok: true, value: null });
    },
    chooseShare(on) {
      calls.push(["chooseShare", on]);
      core.set(BROWSER_SHARE_SETTING, on);
      core.changed("settings");
      return Promise.resolve({ ok: true, value: null });
    },
    saveProfile(input) {
      calls.push(["saveProfile", input]);
      // core가 거절하는 것 가운데 이름 겹침(대소문자 무시)과 개수 상한만 흉내 낸다.
      if (
        (input.id === undefined && profiles.length >= BROWSER_PROFILES_MAX) ||
        profiles.some(
          (p) =>
            p.id !== input.id &&
            p.name.toLowerCase() === input.name.toLowerCase(),
        )
      ) {
        return Promise.resolve({ ok: false, code: "conflict" });
      }
      const id =
        input.id ??
        `bpf_01k0000000000000000000000${profiles.length}`.slice(0, 30);
      profiles =
        input.id === undefined
          ? [...profiles, { id, name: input.name, color: input.color }]
          : profiles.map((p) => (p.id === id ? { ...p, ...input, id } : p));
      core.changed("browser_profiles");
      return Promise.resolve({ ok: true, value: id });
    },
    deleteProfile(id) {
      calls.push(["deleteProfile", id]);
      profiles = profiles.filter((p) => p.id !== id);
      logins = logins.filter((l) => l.profile !== id);
      core.changed("browser_profiles", "logins");
      return Promise.resolve({ ok: true, value: null });
    },
    saveLogin(input) {
      calls.push(["saveLogin", input]);
      const { id, profile, ...form } = input;
      logins =
        id === undefined
          ? [
              ...logins,
              {
                ...form,
                profile: profile ?? null,
                id: `lgn_fake${logins.length}`,
                password: false,
                totp: false,
              },
            ]
          : logins.map((l) => (l.id === id ? { ...l, ...form } : l));
      core.changed("logins");
      return Promise.resolve({ ok: true, value: null });
    },
    deleteLogin(id) {
      calls.push(["deleteLogin", id]);
      logins = logins.filter((l) => l.id !== id);
      core.changed("logins");
      return Promise.resolve({ ok: true, value: null });
    },
    enterLoginSecret(login, field) {
      calls.push(["enterLoginSecret", login.id, field]);
      const result = options.secretResult ?? "stored";
      if (result === "stored") {
        logins = logins.map((l) =>
          l.id === login.id ? { ...l, [field]: true } : l,
        );
        passwords();
        core.changed("logins", "secrets");
      }
      return Promise.resolve({ ok: true, value: result });
    },
    watchBookmarks(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { source, calls, core };
}

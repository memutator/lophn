// What the native widget draws, made from what the computers said. React-free and native-free so Node tests drive it.
// The native side reads `widgets/cache.json` and nothing else: every word on a widget is made here with `t()`, and a widget
// whose computer is gone has no rows left to draw.
import { t } from "@lophn/i18n";
import type {
  AppWidget,
  WidgetNode,
  WidgetTone,
} from "../../../protocol/apps/widget.ts";
import { type OpenTarget, openUrl } from "../open/target.ts";

/** Which computer, app and widget key a placed widget shows. */
export type Binding = { host: string; app: string; key: string };
export type Bindings = { v: 1; widgets: Record<string, Binding> };

export type CacheWidget = {
  state: "ok" | "gone" | "computer_removed";
  /** "<app name> · <widget label>". Empty when the state is not ok. */
  title: string;
  /** "Updated 14:05" or "Offline 14:05". Empty when the state is not ok. */
  footer: string;
  /** The last try failed: the rows are the ones fetched before. */
  stale: boolean;
  open_url: string;
  /** Null unless the state is ok. */
  rows: WidgetNode[] | null;
  tone?: WidgetTone;
  /** Which binding this entry was made for and when (ms), so a later pass keeps it only for the same binding. Native ignores it. */
  from: (Binding & { at: number }) | null;
};

export type Cache = {
  v: 1;
  /** The placeholders native draws for a widget with no entry or no rows. */
  strings: { tap_to_choose: string; gone: string; computer_removed: string };
  widgets: Record<string, CacheWidget>;
};

export type CacheInput = {
  bindings: Bindings;
  /** Public keys of the computers this phone is paired with (not revoked). */
  paired: ReadonlySet<string>;
  /** One computer's widgets as it just said them; null when asking it failed. A computer not in the map was not asked. */
  lists: ReadonlyMap<string, readonly AppWidget[] | null>;
  previous: Cache | null;
  now: number;
  /** The phone's own clock form ("14:05", "2:05 PM"). */
  time: (ms: number) => string;
};

export const EMPTY_BINDINGS: Bindings = { v: 1, widgets: {} };

const sameBinding = (a: Binding, b: Binding) =>
  a.host === b.host && a.app === b.app && a.key === b.key;

const caption = (text: string): WidgetNode => ({
  kind: "text",
  text,
  style: "caption",
});

export function buildCache(input: CacheInput): Cache {
  const { bindings, paired, lists, previous, now, time } = input;
  const widgets: Record<string, CacheWidget> = {};
  for (const [id, binding] of Object.entries(bindings.widgets)) {
    const inbox: OpenTarget = { kind: "inbox", host: binding.host };
    const placeholder = (state: "gone" | "computer_removed"): CacheWidget => ({
      state,
      title: "",
      footer: "",
      stale: false,
      open_url: openUrl(inbox),
      rows: null,
      from: state === "gone" ? { ...binding, at: now } : null,
    });
    if (!paired.has(binding.host)) {
      widgets[id] = placeholder("computer_removed");
      continue;
    }
    const list = lists.get(binding.host);
    const found = list?.find(
      (one) => one.app === binding.app && one.key === binding.key,
    );
    if (list !== undefined && list !== null) {
      if (found === undefined) {
        widgets[id] = placeholder("gone");
        continue;
      }
      widgets[id] = {
        state: "ok",
        title: t("mobile.widget.title", {
          app: found.app_name,
          widget: found.label,
        }),
        footer: t("mobile.widget.updated", { time: time(now) }),
        stale: false,
        open_url: openUrl({
          kind: "app",
          host: binding.host,
          app: binding.app,
          ...(found.screen === null ? {} : { screen: found.screen }),
        }),
        rows: found.value?.rows ?? [caption(t("mobile.widget.empty"))],
        ...(found.value?.tone === undefined ? {} : { tone: found.value.tone }),
        from: { ...binding, at: now },
      };
      continue;
    }
    // Not asked (kept as it was) or the answer failed (stale): the rows fetched before stay, if they were this binding's.
    const before = previous?.widgets[id];
    if (before?.from && sameBinding(before.from, binding)) {
      widgets[id] =
        before.state === "ok" && list === null
          ? {
              ...before,
              stale: true,
              footer: t("mobile.widget.offline", { time: time(before.from.at) }),
            }
          : before;
    } else {
      widgets[id] = {
        state: "ok",
        title: t("mobile.frame.label.brand"),
        footer: t("mobile.widget.offline-never"),
        stale: true,
        open_url: openUrl({ kind: "app", host: binding.host, app: binding.app }),
        rows: [caption(t("mobile.widget.waiting"))],
        from: null,
      };
    }
  }
  return {
    v: 1,
    strings: {
      tap_to_choose: t("mobile.widget.tap-to-choose"),
      gone: t("mobile.widget.gone"),
      computer_removed: t("mobile.widget.computer-removed"),
    },
    widgets,
  };
}

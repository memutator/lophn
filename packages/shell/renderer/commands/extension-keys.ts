// 켜진 extension이 낸 command와 key를 창의 keybinding service에 올린다. 목록은 core의 extension host가 주고, 창을 열 때와
// 설정 `extensions.*`가 바뀌거나 core가 (다시) 붙을 때 다시 읽는다. 다시 읽으면 올린 것을 모두 풀고 새로 올린다.
// `ext.*` command는 contribute(Settings 줄과 기본 key)로, 내장 command에 거는 harness keymap은 bind로 올린다.
import type { ExtensionView } from "../../../protocol/extensions/routes.ts";
import {
  parseChord,
  type Stroke,
  sameStroke,
} from "../../../protocol/shell/keybindings.ts";
import type { EventClient } from "../desktop/connection/events/client.ts";
import type { ExtensionsSource } from "../desktop/settings/extension-packages/core-source.ts";
import type { Disposable } from "./registry.ts";
import type { WindowCommands } from "./window.ts";

type Contributes = NonNullable<ExtensionView["contributes"]>;
type ContributedKey = Contributes["keybindings"][number];

/** Ctrl+글자 하나(Alt·Meta 없이)인가. harness keymap의 Ctrl+글자는 GUI 안에서 CLI가 가진다. */
const isCtrlLetter = (stroke: Stroke) =>
  stroke.ctrl && !stroke.alt && !stroke.meta && stroke.letter !== null;

export function mountExtensionKeys(deps: {
  commands: WindowCommands;
  extensions: Pick<ExtensionsSource, "list" | "run">;
  events: EventClient | null;
  log: (message: string, error: unknown) => void;
}): () => void {
  const { commands } = deps;
  let mounted: Disposable[] = [];
  let latest = 0;
  let alive = true;

  const chordOf = (item: ContributedKey) =>
    commands.platform === "mac"
      ? (item.key.mac ?? item.key.other)
      : item.key.other;

  function run(id: string) {
    void deps.extensions.run(id).then((done) => {
      if (!done.ok) deps.log(`command ${id} failed`, done.error);
    });
  }

  function mountView(
    view: ExtensionView,
    contributes: Contributes,
  ): Disposable[] {
    const out: Disposable[] = [];
    const prefix = `ext.${view.id}.`;
    const declared = new Set(
      contributes.commands.map((command) => `${prefix}${command.name}`),
    );
    for (const command of contributes.commands) {
      const id = `${prefix}${command.name}`;
      const keys = contributes.keybindings.filter(
        (item) => item.command === id,
      );
      const context = keys[0]?.context;
      out.push(commands.registry.register(id, () => run(id)));
      out.push(
        commands.contribute({
          id,
          title: command.title,
          other: keys.map((item) => item.key.other),
          mac: keys.map((item) => item.key.mac ?? item.key.other),
          ...(context === undefined ? {} : { context }),
          source: `Extension: ${view.id}`,
        }),
      );
    }
    for (const item of contributes.keybindings) {
      if (declared.has(item.command)) continue;
      out.push(
        commands.bind({
          command: item.command,
          ...(item.context === undefined ? {} : { context: item.context }),
          other: [item.key.other],
          mac: [item.key.mac ?? item.key.other],
        }),
      );
    }
    // context마다 자기 Ctrl+글자 key의 머리를 가진다. GUI 안에서 CLI key가 lophn의 탭·창 key보다 먼저 듣는다.
    const contexts = new Set(
      contributes.keybindings.flatMap((item) =>
        item.context === undefined ? [] : [item.context],
      ),
    );
    for (const name of contexts) {
      const heads = contributes.keybindings
        .filter((item) => item.context === name)
        .map((item) => parseChord(chordOf(item)).strokes[0])
        .filter(
          (stroke): stroke is Stroke =>
            stroke !== undefined && isCtrlLetter(stroke),
        );
      out.push(
        commands.keybindings.defineContext(name, {
          owns: (chord) => {
            const stroke = chord.strokes[0];
            return (
              stroke !== undefined &&
              heads.some((head) => sameStroke(head, stroke))
            );
          },
        }),
      );
    }
    return out;
  }

  async function load(): Promise<void> {
    const seq = ++latest;
    const done = await deps.extensions.list();
    if (!alive || seq !== latest || !done.ok) return;
    for (const one of mounted) one.dispose();
    mounted = done.value.flatMap((view) =>
      view.status === "on" && view.contributes !== undefined
        ? mountView(view, view.contributes)
        : [],
    );
  }

  void load();
  const stop = deps.events?.subscribe(
    { types: ["StateChanged"] },
    (message) => {
      if (
        message.kind === "ready" ||
        (message.kind === "event" &&
          message.event.type === "StateChanged" &&
          message.event.payload.changes.some(
            (change) =>
              change.name === "settings" &&
              (change.id === null || change.id.startsWith("extensions.")),
          ))
      ) {
        void load();
      }
    },
  );
  return () => {
    alive = false;
    stop?.();
    for (const one of mounted) one.dispose();
    mounted = [];
  };
}

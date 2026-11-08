// 앱 view의 key. 앱이 선언한 key는 `app.<app>.<name>` command로 창에 올려 Settings › Keyboard에 보이게 하고 사람이
// 바꿀 수 있게 한다. handler는 앱 page에 있으므로 registry에는 올리지 않는다. 앱 page에는 지금 듣는 key 글과 shell로
// 넘길 key 글을 보내고(webview-host가 element마다 부른다), page가 넘긴 shell key는 창의 keybinding service로 돌린다.
import { useEffect, useMemo, useState } from "react";

import type { AppKeyDeclaration } from "../../../protocol/apps/declaration/mod.ts";
import type { AppKeysPayload } from "../../ipc/app-keys.ts";
import {
  parseChord,
  resolveBindings,
  type Stroke,
} from "../../ipc/keybindings.ts";
import {
  type AppScreens,
  type ScreensRead,
  useAppViews,
} from "../app-frame/app-views.tsx";
import { useOptionalEventClient } from "../desktop/connection/events/hooks.tsx";
import type { KeyEventLike } from "./keybinding-service.ts";
import { useWindowCommands } from "./react.tsx";
import type { ContributedCommand, WindowCommands } from "./window.ts";

/** 앱 key 하나의 command id. */
export function appKeyCommand(app: string, name: string): string {
  return `app.${app}.${name}`;
}

/** webview element마다 쓰는 key 통로. 창의 command 표를 감싼다. */
export interface AppKeysBridge {
  /** 이 앱 page에 보낼 글. */
  payload(app: string): AppKeysPayload;
  /** page가 넘긴 shell key 글을 창의 service로 돌린다. target은 그 webview element다(context가 거기서 정해진다). */
  run(chord: string, target: Element): void;
  subscribe(listener: () => void): () => void;
}

function contributionOf(
  app: AppScreens,
  key: AppKeyDeclaration,
): ContributedCommand {
  return {
    id: appKeyCommand(app.app, key.id),
    title: key.title,
    other: [key.key.other],
    mac: [key.key.mac ?? key.key.other],
    context: key.context ?? `app:${app.app}`,
    source: `App: ${app.name}`,
  };
}

/** 이 앱의 key 글. 사람이 바꾼 키가 있으면 그것이다. */
function ownKeys(
  commands: WindowCommands,
  app: string,
): Record<string, string[]> {
  const prefix = `app.${app}.`;
  const overrides = commands.overrides();
  const keys: Record<string, string[]> = {};
  for (const command of commands.contributions()) {
    if (!command.id.startsWith(prefix)) continue;
    keys[command.id.slice(prefix.length)] = [
      ...(overrides[command.id] ?? command[commands.platform]),
    ];
  }
  return keys;
}

/**
 * page가 맞으면 삼키고 shell로 넘길 홑 타 글. 표의 줄과 기여 command 가운데 context가 없는 것(앱 view의 context
 * stack에서도 맞는다)이고 지금 부를 수 있는 것만 든다. 앱 자기 key는 registry에 없어 빠진다.
 */
function forwardChords(commands: WindowCommands): string[] {
  const overrides = commands.overrides();
  const entries = [
    ...resolveBindings(commands.platform, overrides).map((binding) => ({
      command: binding.command,
      context: binding.context,
      chords: binding[commands.platform],
    })),
    ...commands.contributions().map((command) => ({
      command: command.id,
      context: command.context,
      chords: overrides[command.id] ?? command[commands.platform],
    })),
  ];
  const chords = new Set<string>();
  for (const entry of entries) {
    if (
      entry.context !== undefined ||
      !commands.registry.canRun(entry.command)
    ) {
      continue;
    }
    for (const text of entry.chords) {
      if (parseChord(text).strokes.length === 1) chords.add(text);
    }
  }
  return [...chords];
}

/** 넘겨받은 글을 keydown처럼 창의 service에 넘길 event. target이 webview라 context는 그 앱 것이다. */
function eventOf(chord: string, target: Element): KeyEventLike {
  const stroke: Stroke = parseChord(chord).strokes[0]!;
  return {
    key: stroke.letter ?? stroke.code,
    code: stroke.code,
    ctrlKey: stroke.ctrl,
    metaKey: stroke.meta,
    altKey: stroke.alt,
    shiftKey: stroke.shift,
    repeat: false,
    isComposing: false,
    target,
    preventDefault() {},
    stopPropagation() {},
  };
}

export function createAppKeysBridge(commands: WindowCommands): AppKeysBridge {
  return {
    payload: (app) => ({
      keys: ownKeys(commands, app),
      forward: forwardChords(commands),
    }),
    run(chord, target) {
      // page가 보낸 글이라도 지금 넘기기로 보낸 것만 돌린다.
      if (!forwardChords(commands).includes(chord)) return;
      commands.keybindings.handle(eventOf(chord, target));
    },
    subscribe: (listener) => commands.subscribe(listener),
  };
}

/** 창의 key 통로. 창이 없으면(gallery, mock) null이다. */
export function useAppKeysBridge(): AppKeysBridge | null {
  const commands = useWindowCommands();
  return useMemo(
    () => (commands === null ? null : createAppKeysBridge(commands)),
    [commands],
  );
}

/**
 * 활성 앱의 key를 창에 올린다. 창의 command 표 아래 한 번 놓는다. 활성 앱이 바뀌면(AppViewChanged activation,
 * core 준비) 목록을 다시 읽어 올린 것을 바꾼다. 그리는 것은 없다.
 */
export function AppKeyContributions(): null {
  const commands = useWindowCommands();
  const deps = useAppViews();
  const events = useOptionalEventClient();
  const [read, setRead] = useState<ScreensRead | null>(null);
  const [changes, setChanges] = useState(0);
  useEffect(() => {
    if (events === null) return;
    return events.subscribe({ types: ["AppViewChanged"] }, (message) => {
      if (
        message.kind === "ready" ||
        (message.kind === "event" &&
          message.event.type === "AppViewChanged" &&
          message.event.payload.reason === "activation")
      ) {
        setChanges((count) => count + 1);
      }
    });
  }, [events]);
  useEffect(() => {
    if (deps?.screens === undefined) return;
    let live = true;
    void deps.screens().then((value) => {
      if (live) setRead(value);
    });
    return () => {
      live = false;
    };
  }, [deps, changes]);
  useEffect(() => {
    if (commands === null || read === null || !read.ok) return;
    const contributed = read.value.flatMap((app) =>
      (app.keys ?? []).map((key) =>
        commands.contribute(contributionOf(app, key)),
      ),
    );
    return () => {
      for (const one of contributed) one.dispose();
    };
  }, [commands, read]);
  return null;
}

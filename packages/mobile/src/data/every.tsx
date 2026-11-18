// The one list (sidebar, Home): every paired computer's lines. Each computer is read in its own `ComputerScope` by the same
// hooks a screen of that computer reads, and it keeps that computer's lists and icons and its phone apps in step. The
// filter (every computer, or one) is this phone's own setting, in the app's files folder.
import { File, Paths } from "expo-file-system";
import {
  createContext,
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CodingSession } from "../../../protocol/coding-agent/relay.ts";
import { useWaiting } from "../../../shell/renderer/desktop/connection/events/hooks.tsx";
import type { WaitingEntry } from "../../../shell/renderer/desktop/connection/events/waiting-store.ts";
import type { ComputerItem } from "../../../remote-client/mod.ts";
import { previewOnly, usePhoneApps } from "./apps.ts";
import {
  ComputerScope,
  useCodingSessions,
  useComputers,
  useWorkspaces,
} from "./hooks.tsx";
import { useKeepLists, useWithSavedLists } from "./lists.ts";
import { installedOf, useLocalApps, withLocalApps } from "./local-apps.ts";
import type { WorkspaceView } from "./workspaces.ts";

/** What an app's line opens: its phone screen, or the running preview when only the preview has a phone screen. */
export type PhoneLine = "screen" | "preview";

interface Read {
  /** Home, every project and every app, with the kept ones and the apps on this phone while the computer is away. */
  readonly workspaces: readonly WorkspaceView[];
  /** The running coding sessions. */
  readonly coding: readonly CodingSession[];
  /** The apps with a phone screen or on this phone, by app id. */
  readonly phone: ReadonlyMap<string, PhoneLine>;
  /** The apps installed on this phone: they open while the computer is away. */
  readonly installed: ReadonlySet<string>;
  /** What waits on the person there. */
  readonly inbox: readonly WaitingEntry[];
}

export interface ComputerLines extends Read {
  readonly computer: ComputerItem;
}

const NOTHING: Read = {
  workspaces: [],
  coding: [],
  phone: new Map(),
  installed: new Set(),
  inbox: [],
};

interface Every {
  /** Every paired computer in the computer list's order. */
  readonly lines: readonly ComputerLines[];
  /** The computer the list shows; null shows every computer. */
  readonly filter: string | null;
  /** Shows one computer (it becomes the computer on screen too) or, with null, every one. */
  setFilter(key: string | null): void;
}

const EveryContext = createContext<Every>({
  lines: [],
  filter: null,
  setFilter: () => {},
});

const filterFile = () => new File(Paths.document, "computer-filter.json");

function readFilter(): string | null {
  const file = filterFile();
  if (!file.exists) return null;
  const { computer } = JSON.parse(file.textSync()) as { computer?: unknown };
  return typeof computer === "string" ? computer : null;
}

function writeFilter(computer: string | null): void {
  filterFile().write(JSON.stringify({ computer }));
}

/**
 * Mount once where it stays (the frame). Keeps the filter and the computer on screen together: with one computer shown it
 * is the computer on screen, so the Inbox and Jobs lines are of the computer listed. When something else (a notification)
 * switches to another computer, the list shows every computer again; so does a computer leaving the list.
 */
export function EveryComputer({ children }: { children: ReactNode }) {
  const { ready, computers, current, select } = useComputers();
  const [read, setRead] = useState<ReadonlyMap<string, Read>>(new Map());
  const [filter, setFilterState] = useState(readFilter);
  const change = useCallback((key: string | null) => {
    setFilterState(key);
    writeFilter(key);
  }, []);
  const keys = computers.map((one) => one.key);
  const listed = filter === null || keys.includes(filter);
  // The computer on screen when this last looked; undefined before the first look, which puts the saved filter on screen.
  const seen = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!ready) return;
    if (!listed) return change(null);
    const first = seen.current === undefined;
    const moved = !first && seen.current !== current;
    seen.current = current;
    if (first && filter !== null && current !== filter) select(filter);
    // Only a switch resets it: picking a filter switches too, and may be seen before the switch is.
    if (moved && filter !== null && current !== filter) change(null);
  }, [ready, listed, filter, current]);

  const onRead = useCallback((key: string, one: Read | null) => {
    setRead((before) => {
      const next = new Map(before);
      if (one === null) next.delete(key);
      else next.set(key, one);
      return next;
    });
  }, []);
  const lines = useMemo(
    () => computers.map((computer) => ({ computer, ...(read.get(computer.key) ?? NOTHING) })),
    [computers, read],
  );
  const value = useMemo<Every>(
    () => ({
      lines,
      filter: listed ? filter : null,
      setFilter(key) {
        change(key);
        if (key !== null && key !== current) select(key);
      },
    }),
    [lines, listed, filter, current, select],
  );
  return (
    <EveryContext value={value}>
      {keys.map((key) => (
        <ComputerScope key={key} computer={key}>
          <Collect computer={key} onRead={onRead} />
        </ComputerScope>
      ))}
      {children}
    </EveryContext>
  );
}

/** Reads one computer's lines in its scope and hands them up. */
const Collect = memo(function Collect({
  computer,
  onRead,
}: {
  computer: string;
  onRead: (key: string, one: Read | null) => void;
}) {
  useKeepLists();
  const local = useLocalApps();
  const installed = useMemo(() => installedOf(local), [local]);
  const saved = useWithSavedLists(useWorkspaces());
  const workspaces = useMemo(() => withLocalApps(saved, installed), [saved, installed]);
  const coding = useCodingSessions().sessions;
  const phoneApps = usePhoneApps().apps;
  const { entries } = useWaiting();
  // An app on this phone opens its screen even when the computer lists only its preview.
  const phone = useMemo(
    () =>
      new Map<string, PhoneLine>([
        ...phoneApps.map((one): [string, PhoneLine] => [one.app, previewOnly(one) ? "preview" : "screen"]),
        ...installed.map((one): [string, PhoneLine] => [one.app, "screen"]),
      ]),
    [phoneApps, installed],
  );
  useEffect(
    () =>
      onRead(computer, {
        workspaces,
        coding,
        phone,
        installed: new Set(installed.map((one) => one.app)),
        inbox: entries,
      }),
    [computer, workspaces, coding, phone, installed, entries],
  );
  useEffect(() => () => onRead(computer, null), [computer]);
  return null;
});

/**
 * The computers the list shows (every one, or the filter's) with their lines, and whether more than one shows: then each
 * line says its computer.
 */
export function useEveryComputer(): Every & {
  readonly shown: readonly ComputerLines[];
  readonly many: boolean;
} {
  const every = useContext(EveryContext);
  const shown =
    every.filter === null
      ? every.lines
      : every.lines.filter((one) => one.computer.key === every.filter);
  return { ...every, shown, many: shown.length > 1 };
}

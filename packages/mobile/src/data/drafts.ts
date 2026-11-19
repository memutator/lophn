// In-memory per-session draft store for the phone: keeps typed chat text, pending attachments, and terminal input
// across view swaps (chat <-> terminal) and screen unmounts. Never persisted to disk.
import type { Attached } from "./attach.ts";

export interface SessionDraft {
  readonly text: string;
  readonly attachments: readonly Attached[];
  readonly terminalText: string;
}

const EMPTY_DRAFT: SessionDraft = {
  text: "",
  attachments: [],
  terminalText: "",
};

export interface PhoneDraftStore {
  get(key: string): SessionDraft;
  save(key: string, patch: Partial<SessionDraft>): void;
  update(key: string, fn: (current: SessionDraft) => Partial<SessionDraft>): void;
  subscribe(key: string, listener: () => void): () => void;
}

export function createPhoneDraftStore(): PhoneDraftStore {
  const drafts = new Map<string, SessionDraft>();
  const listeners = new Map<string, Set<() => void>>();

  const get = (key: string): SessionDraft => drafts.get(key) ?? EMPTY_DRAFT;

  const notify = (key: string) => {
    for (const listener of [...(listeners.get(key) ?? [])]) listener();
  };

  const save = (key: string, patch: Partial<SessionDraft>) => {
    const current = get(key);
    const next: SessionDraft = { ...current, ...patch };
    if (
      next.text === current.text &&
      next.attachments === current.attachments &&
      next.terminalText === current.terminalText
    ) {
      return;
    }
    if (
      next.text === "" &&
      next.attachments.length === 0 &&
      next.terminalText === ""
    ) {
      drafts.delete(key);
    } else {
      drafts.set(key, next);
    }
    notify(key);
  };

  return {
    get,
    save,
    update(key, fn) {
      save(key, fn(get(key)));
    },
    subscribe(key, listener) {
      const set = listeners.get(key) ?? new Set<() => void>();
      listeners.set(key, set);
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(key);
      };
    },
  };
}

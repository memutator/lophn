// The phone's home screen, Android only: widget files and drawing, placing a widget, and app icons (pinned shortcuts).
// Kotlin in android/; the widgets draw from `widgets/cache.json` without JS.
import { requireNativeModule } from "expo";

type Native = {
  readText(name: string): Promise<string | null>;
  writeText(name: string, text: string): Promise<void>;
  bindWidget(id: number, bind: string): Promise<void>;
  dropUnplacedBindings(): Promise<string>;
  redraw(ids: number[] | null): Promise<void>;
  isPinSupported(): boolean;
  requestPin(size: "small" | "wide", bind: string): boolean;
  finishConfigure(id: number, ok: boolean): boolean;
  isShortcutPinSupported(): boolean;
  pinShortcut(id: string, label: string, pngBase64: string, url: string, picture: string): boolean;
  pinnedShortcuts(): PinnedShortcut[];
  updateShortcuts(list: { id: string; label: string; png: string; url: string; picture: string }[]): boolean;
  disableShortcuts(ids: string[], message: string): void;
  enableShortcuts(ids: string[]): void;
};

const native = requireNativeModule<Native>("LophnWidgets");

/**
 * The widget files (`name` like "widgets/cache.json"; nothing outside `widgets/`) and drawing. The bindings file is only
 * read here: native changes it in one step under the lock its pin callback takes too.
 */
export const widgetFiles = {
  readText: (name: string) => native.readText(name),
  writeText: (name: string, text: string) => native.writeText(name, text),
  bind: (id: number, binding: string) => native.bindWidget(id, binding),
  dropUnplaced: () => native.dropUnplacedBindings(),
  redraw: (ids?: number[]) => native.redraw(ids ?? null),
};

/** Whether the launcher can place a widget the app asks for (`requestPin`). */
export const isPinSupported = (): boolean => native.isPinSupported();

/**
 * Asks the launcher to place a widget bound to one app widget. True when the launcher showed its sheet. If the person
 * adds it, native writes the binding and refreshes; a cancel sends nothing, so there is no id to wait for.
 */
export const requestPin = (
  size: "small" | "wide",
  bind: { host: string; app: string; key: string },
): boolean => native.requestPin(size, JSON.stringify(bind));

/**
 * Answers the launcher's configure step after "Choose a widget" opened with `from=configure`: `ok` keeps the widget,
 * otherwise the launcher removes it. Then the home screen comes back. False when no configure step waits for `id`.
 */
export const finishConfigure = (id: number, ok: boolean): boolean =>
  native.finishConfigure(id, ok);

/** A pinned app icon: its name, and `picture`, what its picture was drawn from ("" when not known). */
export type PinnedShortcut = { id: string; label: string; picture: string };

/** App icons on the home screen (pinned shortcuts). */
export const shortcuts = {
  isPinSupported: (): boolean => native.isShortcutPinSupported(),
  /** True when the launcher showed its sheet, or at once with no sheet when `id` is already pinned. */
  pin: (one: { id: string; label: string; iconPng: string; url: string; picture: string }): boolean =>
    native.pinShortcut(one.id, one.label, one.iconPng, one.url, one.picture),
  pinned: (): PinnedShortcut[] => native.pinnedShortcuts(),
  pinnedIds: (): string[] => native.pinnedShortcuts().map((one) => one.id),
  /** Changes placed icons' names and pictures; an empty `iconPng` keeps the picture. False when Android refused for now. */
  update: (list: { id: string; label: string; iconPng: string; url: string; picture: string }[]): boolean =>
    native.updateShortcuts(list.map(({ iconPng, ...one }) => ({ ...one, png: iconPng }))),
  disable: (ids: string[], message: string): void => native.disableShortcuts(ids, message),
  enable: (ids: string[]): void => native.enableShortcuts(ids),
};

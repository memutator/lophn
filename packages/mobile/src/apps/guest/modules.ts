// Native modules a guest may reach besides the sandbox's own list (the patched SANDBOX_TURBOMODULES_WHITELIST, which has
// no network module). Only what the kit needs to run: safe area insets, and the keyboard provider with the reanimated
// and worklets runtimes it is built on. Each one is a fresh instance inside the guest, never the host's; nothing that
// holds a secret, a file or the network belongs here. Left out on purpose: StatusBarManager (the sandbox patch takes it
// off its own list too; a screen would set the whole app's status bar, and the guest's base stubs RN's StatusBar).
export const GUEST_MODULES = [
  "RNCSafeAreaContext",
  "KeyboardController",
  "ReanimatedModule",
  "WorkletsModule",
];

// Native view managers omitted from a guest runtime (enforced in the sandbox patch's FilteredReactPackage).
// RCTModalHostView opens an OS window over the whole host app, where a guest could cover lophn's own UI.
export const GUEST_BLOCKED_VIEWS = ["RCTModalHostView"] as const;

// React Native JS exports omitted from the `react-native` module served to guest screens.
export const GUEST_BLOCKED_RN_EXPORTS = ["Modal"] as const;

const BLOCKED_RN = new Set<PropertyKey>(GUEST_BLOCKED_RN_EXPORTS);

/**
 * Wraps the `react-native` namespace exposed to guest screens so blocked exports (such as `Modal`) are omitted without
 * eagerly touching React Native's lazy getters (which include network modules absent from a guest runtime).
 */
export function guestReactNative<T extends object>(rn: T): T {
  return new Proxy(Object.create(null) as T, {
    get(_target, prop) {
      if (BLOCKED_RN.has(prop)) return undefined;
      return Reflect.get(rn, prop, rn);
    },
    has(_target, prop) {
      if (BLOCKED_RN.has(prop)) return false;
      return Reflect.has(rn, prop);
    },
    ownKeys() {
      return Reflect.ownKeys(rn).filter((prop) => !BLOCKED_RN.has(prop));
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (BLOCKED_RN.has(prop)) return undefined;
      const desc = Reflect.getOwnPropertyDescriptor(rn, prop);
      if (desc === undefined) return undefined;
      // Delegate lazily so inspecting descriptors never evaluates RN's lazy module getters.
      return {
        configurable: true,
        enumerable: desc.enumerable ?? true,
        get: () => Reflect.get(rn, prop, rn),
      };
    },
  });
}

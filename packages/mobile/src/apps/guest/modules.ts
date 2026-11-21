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
// RNSVGImage loads its picture through Fresco's pipeline directly, not through the guarded image view, so a guest could draw any
// `file:`, `content:` or network image with it: it is not given to a guest.
export const GUEST_BLOCKED_VIEWS = ["RCTModalHostView", "RNSVGImage"] as const;

// React Native JS exports omitted from the `react-native` module served to guest screens.
export const GUEST_BLOCKED_RN_EXPORTS = ["Modal"] as const;

// And from `react-native-svg`: its `Image` (and the filter `FeImage`) is what draws a picture by URI, so a screen that uses it
// fails where it is written (`undefined is not a component`) instead of silently drawing nothing.
export const GUEST_BLOCKED_SVG_EXPORTS = ["Image", "FeImage"] as const;

const BLOCKED_RN = new Set<PropertyKey>(GUEST_BLOCKED_RN_EXPORTS);
const BLOCKED_SVG = new Set<PropertyKey>(GUEST_BLOCKED_SVG_EXPORTS);

/**
 * Wraps the `react-native` namespace exposed to guest screens so blocked exports (such as `Modal`) are omitted without
 * eagerly touching React Native's lazy getters (which include network modules absent from a guest runtime).
 */
export const guestReactNative = <T extends object>(rn: T): T => withoutExports(rn, BLOCKED_RN);

/**
 * The `react-native-svg` module served to guest screens, without the exports that draw a picture by URI: a view over the real
 * module, as for `react-native` (named imports draw on a device with it).
 *
 * Only named imports are supported: `import { Svg, Circle } from "react-native-svg"`. A default import is refused when the
 * release is prepared (`source-checks.ts`), because a screen built as an ES module (the app's package.json says
 * `"type": "module"`, as the template's does) gets the module object itself as the default under the bundler's Node-style interop.
 * A wrapper that made the default a component was tried and a `<Svg>` then failed on a device (cause not found), so this stays a
 * plain view.
 */
export const guestSvg = <T extends object>(svg: T): T => withoutExports(svg, BLOCKED_SVG);

function withoutExports<T extends object>(rn: T, blocked: ReadonlySet<PropertyKey>): T {
  return new Proxy(Object.create(null) as T, {
    get(_target, prop) {
      if (blocked.has(prop)) return undefined;
      return Reflect.get(rn, prop, rn);
    },
    has(_target, prop) {
      if (blocked.has(prop)) return false;
      return Reflect.has(rn, prop);
    },
    ownKeys() {
      return Reflect.ownKeys(rn).filter((prop) => !blocked.has(prop));
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (blocked.has(prop)) return undefined;
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

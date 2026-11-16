// Native modules a guest may reach besides the sandbox's own list (the patched SANDBOX_TURBOMODULES_WHITELIST, which has
// no network module). Only what the kit needs to run: safe area insets, and the keyboard provider with the reanimated
// and worklets runtimes it is built on. Each one is a fresh instance inside the guest, never the host's; nothing that
// holds a secret, a file or the network belongs here. Left out on purpose: StatusBarManagerCompat (a screen would set
// the whole app's status bar; the kit does not use it).
export const GUEST_MODULES = [
  "RNCSafeAreaContext",
  "KeyboardController",
  "ReanimatedModule",
  "WorkletsModule",
];

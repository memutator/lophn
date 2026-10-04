import { blueprint, command, screen } from "./fixture.ts";
import type {
  AutomationDeclaration,
  Blueprint,
  CommandDeclaration,
  CommandEffect,
  ScreenDeclaration,
} from "./mod.ts";

const authored: Blueprint = {
  name: "Calendar",
  description: "Keeps one calendar",
  screens: [{ key: "home", label: "Home", path: "/home", sizes: ["full"] }],
  commands: [command("lookup", "read")],
  automatic_tasks: [],
  permissions: [],
  problem_codes: [],
  documents: [],
  agent_context: [],
  app_connections: [],
  sdk_dependencies: [],
};

// 컴파일만 확인한다. 틀린 작성형은 실행하지 않는다.
void authored;

// @ts-expect-error permissions가 빠졌다
const missing: Blueprint = {
  name: "Calendar",
  description: "Keeps one calendar",
  screens: [],
  commands: [],
  automatic_tasks: [],
  problem_codes: [],
  documents: [],
  agent_context: [],
  app_connections: [],
  sdk_dependencies: [],
};
void missing;

const typo: Blueprint = {
  ...authored,
  // @ts-expect-error command 철자가 틀렸다
  command: [],
};
void typo;

const effect: CommandDeclaration = {
  key: "lookup",
  label: "lookup",
  description: "lookup purpose",
  // @ts-expect-error effect는 read·write·external만이다
  effect: "fetch",
  confirm: false,
  input: null,
  revert: { supported: false },
};
void effect;

const many: CommandDeclaration = {
  key: "send",
  label: "send",
  description: "send purpose",
  // @ts-expect-error effect는 하나다
  effect: ["external", "write"],
  confirm: false,
  input: null,
  revert: { supported: false },
};
void many;

const confirm: CommandDeclaration = {
  key: "send",
  label: "send",
  description: "send purpose",
  effect: "external",
  // @ts-expect-error confirm은 boolean이다
  confirm: "yes",
  input: null,
  revert: { supported: false },
};
void confirm;

// @ts-expect-error confirm이 빠졌다
const dropped: CommandDeclaration = {
  key: "send",
  label: "send",
  description: "send purpose",
  effect: "external",
  input: null,
  revert: { supported: false },
};
void dropped;

const legacy: Blueprint = {
  ...authored,
  // @ts-expect-error 옛 context 필드는 Blueprint에 없다
  context: [],
};
void legacy;

const wide: ScreenDeclaration = {
  key: "home",
  label: "Home",
  path: "/home",
  // @ts-expect-error size는 full·panel·card만이다
  sizes: ["wide"],
};
void wide;

const badEffect = command(
  "lookup",
  // @ts-expect-error effect는 read·write·external만이다
  "fetch",
);
void badEffect;

const badConfirm = command("send", "external", {
  // @ts-expect-error confirm은 boolean이다
  confirm: "yes",
});
void badConfirm;

const manyEffects = command("send", "external", {
  // @ts-expect-error effect는 하나다
  effect: ["external", "write"],
});
void manyEffects;

const badScreen = screen({
  // @ts-expect-error size는 full·panel·card만이다
  sizes: ["wide"],
});
void badScreen;

const badBlueprint = blueprint({
  // @ts-expect-error 옛 context 필드는 Blueprint에 없다
  context: [],
});
void badBlueprint;

const wrongWhen: AutomationDeclaration = {
  key: "sync",
  label: "Sync",
  // @ts-expect-error automation when은 interval 또는 on_start다
  when: { kind: "cron" },
  command: "lookup",
};
void wrongWhen;

const effectSlot: CommandEffect = "read";
void effectSlot;
const badEffectSlot =
  // @ts-expect-error CommandEffect에 fetch는 없다
  "fetch" satisfies CommandEffect;
void badEffectSlot;

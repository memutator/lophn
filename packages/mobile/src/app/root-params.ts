import type { RosterInviteText } from "../remote.ts";

/** The root stack: the frame (sidebar and its stack) and the start flow that joins this phone to the person's devices. */
export type RootParams = {
  frame: undefined;
  welcome: undefined;
  scan: undefined;
  pairing: { invite: RosterInviteText };
  paired: { key: string };
  "pair-failed":
    | { why: "expired" | "unreachable"; invite: RosterInviteText }
    // The computer answered but one side must update first; `name` is what it called itself.
    | {
        why: "update";
        update: "client" | "host";
        name: string;
        invite: RosterInviteText;
      };
};

/** What the inviting computer goes by: its name in the roster, else the first address it is reached at. */
export function nameOf(invite: RosterInviteText): string {
  const { body } = invite.issuer;
  if (body.type === "entry") return body.name;
  return invite.reach.addresses[0] ?? body.key.slice(0, 8);
}

import type { Place, Role } from "../../../protocol/lophn-agent/places.ts";

// Project Manager는 자기 project의 Operator만 만들고 고친다.
// 다른 role은 이 tool이 없다. ownPlace는 `ToolContext.place`다.
export function operatorPlaceAllowed(
  role: Role,
  ownPlace: Place | null,
  target: Place,
): boolean {
  if (ownPlace === null || ownPlace.kind !== target.kind) return false;
  return role === "project_manager" && ownPlace.kind === "project" &&
    ownPlace.id === target.id;
}

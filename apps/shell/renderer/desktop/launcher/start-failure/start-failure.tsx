// shell#T57 start failure screen showing distinct launcher failure states.
// Shows start, sandbox, or schema failure without normal launcher appearance.

import React from "react";
import { type StartFailure } from "./model.ts";

export interface StartFailureProps {
  failure: StartFailure;
}

/** 시작 실패·sandbox 실패·schema 비호환을 구별하여 보이고 다음 행동 하나를 준다. */
export function StartFailureScreen({ failure }: StartFailureProps): React.ReactElement {
  return (
    <div className="start-failure-container">
      <div className="start-failure-content">
        <div className="start-failure-kind" data-kind={failure.kind}>
          {failure.kind === "start" && "Start Failed"}
          {failure.kind === "sandbox" && "Sandbox Failed"}
          {failure.kind === "schema" && "Incompatible Version"}
        </div>

        <p className="start-failure-message">{failure.message}</p>

        <button className="start-failure-action">
          {failure.nextAction}
        </button>
      </div>
    </div>
  );
}

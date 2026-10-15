// session rewind panel. 확인 창이 아니라 대화 화면 안에 열린다. 고른 내 메시지 시점으로 대화를 되돌리고, file tool로 바꾼 파일은
// 기본으로 함께 되돌린다. 그 시점 뒤 이 session이 write한 앱은 앱마다 고른다: write 목록과, 함께 되돌아갈 다른 변경, 되돌아가지
// 않는 external 효과, 되돌릴 수 없는 write를 고르기 전에 보인다.
import { useState } from "react";
import { Button, Checkbox, IconButton } from "@lophn/design/components";
import { workspaceIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";

import {
  REWIND_APPS,
  REWIND_FILES,
  REWIND_POINT,
  type RewindApp,
} from "./data.ts";
import t from "./agent-tab.module.css";

function AppChoice(
  { app, checked, onChange }: {
    app: RewindApp;
    checked: boolean;
    onChange: (checked: boolean) => void;
  },
) {
  const unknown = app.writes.filter((write) => write.unknown).length;
  return (
    <div className={t.rewindApp} data-on={checked ? "" : undefined}>
      <Checkbox
        label={`Also rewind ${app.name}`}
        checked={checked}
        onCheckedChange={onChange}
      />
      <p className={t.rewindSub}>
        {app.writes.length} writes by this session after this message
        {unknown === 0 ? null : (
          <span className={t.rewindWarn}>
            {unknown} with an unknown result, cannot be undone
          </span>
        )}
      </p>
      {checked
        ? (
          <>
            <ul className={t.rewindList}>
              {app.writes.map((write) => (
                <li key={write.text}>
                  <span className={t.rewindTime}>{write.time}</span>
                  {write.text}
                  {write.unknown
                    ? <span className={t.rewindWarn}>Result unknown</span>
                    : null}
                </li>
              ))}
            </ul>
            {app.others.length === 0 ? null : (
              <>
                <p className={t.rewindSub}>
                  Also goes back, though this session did not do it
                </p>
                <ul className={t.rewindList}>
                  {app.others.map((other) => (
                    <li key={other.text}>
                      <span className={t.rewindWho}>{other.by}</span>
                      {other.text}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {app.outside.length === 0 ? null : (
              <>
                <p className={t.rewindSub}>Stays as it is, outside lophn</p>
                <ul className={t.rewindList}>
                  {app.outside.map((text) => <li key={text}>{text}</li>)}
                </ul>
              </>
            )}
          </>
        )
        : null}
    </div>
  );
}

export function RewindPanel(
  { initialApps = [], onClose }: {
    /** page가 미리 켜 둔 앱. */
    initialApps?: readonly string[];
    onClose?: () => void;
  },
) {
  const [files, setFiles] = useState(true);
  const [apps, setApps] = useState<readonly string[]>(initialApps);
  const setApp = (name: string, on: boolean) =>
    setApps((now) => on ? [...now, name] : now.filter((item) => item !== name));
  return (
    <section
      className={`${t.panel} ${t.panelWide}`}
      aria-label="Rewind to here"
    >
      <header className={t.panelHead}>
        <span className={t.panelTitle}>Rewind to here</span>
        <IconButton
          icon={workspaceIcons.close}
          label="Close rewind"
          size="sm"
          onClick={onClose}
        />
      </header>
      <div className={t.panelCols}>
        <div className={t.panelBody}>
          <blockquote className={t.point}>{REWIND_POINT}</blockquote>
          <div className={t.rewindGroup}>
            <p className={t.rewindHead}>Conversation</p>
            <p className={t.rewindText}>
              Messages after this one are removed from the conversation.
            </p>
            <Checkbox
              label="Also restore files changed with file tools"
              checked={files}
              onCheckedChange={setFiles}
            />
            <ul className={t.rewindList}>
              {REWIND_FILES.map((path) => <li key={path}>{path}</li>)}
            </ul>
            <p className={t.rewindMuted}>
              Files changed through the shell are not restored.
            </p>
          </div>
          <p className={t.rewindMuted}>
            Messages you sent while the agent was working (steer) are not rewind
            points. Rewinding past one removes only the message.
          </p>
        </div>
        <div className={t.panelBody}>
          <div className={t.rewindGroup}>
            <p className={t.rewindHead}>
              Apps this session wrote to after this message
            </p>
            <p className={t.rewindText}>
              A checked app goes back to this message, including changes others
              made since. Unchecked apps stay as they are.
            </p>
            {REWIND_APPS.map((app) => (
              <AppChoice
                key={app.name}
                app={app}
                checked={apps.includes(app.name)}
                onChange={(on) => setApp(app.name, on)}
              />
            ))}
          </div>
        </div>
      </div>
      <footer className={t.panelFoot}>
        <span className={t.cardNote}>
          {apps.length === 0
            ? "Conversation and files only"
            : `Conversation, files and ${apps.join(" and ")}`}
        </span>
        <Button size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={onClose}>
          Rewind
        </Button>
      </footer>
    </section>
  );
}

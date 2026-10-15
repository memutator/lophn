// 용어집: 사람과 Project Manager가 용어의 뜻을 정하고 고친다. 사람은 여기서 줄 자리에서 바로 더하고, 고치고, 지운다.
import { useState } from "react";
import { Button, Dialog, IconButton } from "@lophn/design/components";
import { conversationIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";

import { GLOSSARY, type GlossaryTerm } from "./contexts-data.ts";
import c from "./contexts.module.css";

export type GlossaryDemo = "add" | "edit" | "delete";

// 시연 상태가 가리키는 줄.
const DEMO_ROW = "baseline";

/**
 * 줄 자리에서 바로 고치는 줄. 용어와 뜻이 읽을 때와 같은 칸에 글자 칸으로 놓인다.
 * Enter나 ✓로 저장하고 Esc나 ×로 취소한다.
 */
function InlineRow(
  { initial, onSave, onCancel }: {
    initial: GlossaryTerm;
    onSave: (term: GlossaryTerm) => void;
    onCancel: () => void;
  },
) {
  const [term, setTerm] = useState(initial.term);
  const [meaning, setMeaning] = useState(initial.meaning);
  const ready = term.trim() !== "" && meaning.trim() !== "";
  const save = () => {
    if (ready) onSave({ term: term.trim(), meaning: meaning.trim() });
  };
  const keys = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") save();
    if (event.key === "Escape") onCancel();
  };
  return (
    <li className={c.termRow} data-editing="">
      <input
        className={`${c.inlineInput} ${c.termInput}`}
        aria-label="Term"
        placeholder="Term"
        value={term}
        autoFocus={initial.term === ""}
        onChange={(event) => setTerm(event.target.value)}
        onKeyDown={keys}
      />
      <input
        className={c.inlineInput}
        aria-label="Meaning"
        placeholder="Meaning"
        value={meaning}
        autoFocus={initial.term !== ""}
        onChange={(event) => setMeaning(event.target.value)}
        onKeyDown={keys}
      />
      <div className={c.rowActions}>
        <IconButton
          icon={conversationIcons.current}
          label="Save term"
          disabled={!ready}
          onClick={save}
        />
        <IconButton
          icon={conversationIcons.removeContext}
          label="Cancel"
          onClick={onCancel}
        />
      </div>
    </li>
  );
}

export function Glossary({ demo }: { demo?: GlossaryDemo }) {
  const [terms, setTerms] = useState<readonly GlossaryTerm[]>(GLOSSARY);
  const [adding, setAdding] = useState(demo === "add");
  const [editing, setEditing] = useState<string | null>(
    demo === "edit" ? DEMO_ROW : null,
  );
  const [deleting, setDeleting] = useState<string | null>(
    demo === "delete" ? DEMO_ROW : null,
  );
  return (
    <section>
      <div className={c.glossaryHead}>
        <h2>
          Glossary <span className={c.count}>{terms.length} terms</span>
        </h2>
        <Button
          variant="primary"
          disabled={adding}
          onClick={() => {
            setEditing(null);
            setAdding(true);
          }}
        >
          Add term
        </Button>
      </div>
      <ul className={c.termList}>
        {adding
          ? (
            <InlineRow
              initial={{ term: "", meaning: "" }}
              onCancel={() => setAdding(false)}
              onSave={(term) => {
                setTerms([term, ...terms]);
                setAdding(false);
              }}
            />
          )
          : null}
        {terms.map((entry) =>
          editing === entry.term
            ? (
              <InlineRow
                key={entry.term}
                initial={entry}
                onCancel={() => setEditing(null)}
                onSave={(next) => {
                  setTerms(terms.map((item) => item === entry ? next : item));
                  setEditing(null);
                }}
              />
            )
            : (
              <li key={entry.term} className={c.termRow}>
                <span className={c.termName}>{entry.term}</span>
                <span className={c.termMeaning}>{entry.meaning}</span>
                <div className={c.rowActions}>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setAdding(false);
                      setEditing(entry.term);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDeleting(entry.term)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            )
        )}
      </ul>
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete “${deleting ?? ""}”?`}
        actions={
          <>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setTerms(terms.filter((item) => item.term !== deleting));
                setDeleting(null);
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className={c.note}>
          The term and its meaning leave this context's glossary. Project
          Manager can add it again later.
        </p>
      </Dialog>
    </section>
  );
}

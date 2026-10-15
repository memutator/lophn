// 용어집: 사람과 Project Manager가 용어의 뜻을 정하고 고친다. 사람은 여기서 더하고, 고치고, 지운다.
import { useState } from "react";
import {
  Button,
  Dialog,
  Field,
  Input,
  Textarea,
} from "@lophn/design/components";

import { GLOSSARY, type GlossaryTerm } from "./contexts-data.ts";
import c from "./contexts.module.css";

export type GlossaryDemo = "add" | "edit" | "delete";

// 시연 상태가 가리키는 줄.
const DEMO_ROW = "baseline";

function TermForm(
  { initial, onSave, onCancel }: {
    initial: GlossaryTerm;
    onSave: (term: GlossaryTerm) => void;
    onCancel: () => void;
  },
) {
  const [term, setTerm] = useState(initial.term);
  const [meaning, setMeaning] = useState(initial.meaning);
  const ready = term.trim() !== "" && meaning.trim() !== "";
  return (
    <div className={c.termForm}>
      <Field label="Term">
        <Input value={term} onChange={(event) => setTerm(event.target.value)} />
      </Field>
      <Field label="Meaning">
        <Textarea
          rows={2}
          value={meaning}
          onChange={(event) => setMeaning(event.target.value)}
        />
      </Field>
      <div className={c.actions}>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!ready}
          onClick={() => onSave({ term: term.trim(), meaning: meaning.trim() })}
        >
          Save
        </Button>
      </div>
    </div>
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
      {adding
        ? (
          <TermForm
            initial={{ term: "", meaning: "" }}
            onCancel={() => setAdding(false)}
            onSave={(term) => {
              setTerms([...terms, term]);
              setAdding(false);
            }}
          />
        )
        : null}
      <ul className={c.entries}>
        {terms.map((entry) =>
          editing === entry.term
            ? (
              <li key={entry.term} className={c.entry}>
                <TermForm
                  initial={entry}
                  onCancel={() => setEditing(null)}
                  onSave={(next) => {
                    setTerms(terms.map((item) => item === entry ? next : item));
                    setEditing(null);
                  }}
                />
              </li>
            )
            : (
              <li key={entry.term} className={c.entry}>
                <div className={c.term}>
                  <span className={c.termName}>{entry.term}</span>
                  <span className={c.termMeaning}>{entry.meaning}</span>
                </div>
                <div className={c.rowActions}>
                  <Button
                    size="sm"
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

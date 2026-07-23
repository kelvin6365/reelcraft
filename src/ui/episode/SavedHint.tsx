"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";

// The workspace had three different save models and only one of them told you
// anything: the script station has an explicit 儲存 button with a dirty state,
// while asset prompts and shot prompts save silently on blur — the shot prompt
// even passes `refetch: false`, so nothing on screen moves at all. Users could
// not tell an edit had persisted, which is the worst of the three (Toonflow
// #149: 「manual edits are lost after switching to another tab」).
//
// This keeps autosave (it is the right default for a text field you tab out of)
// and adds the missing half: a brief confirmation.

const FLASH_MS = 1800;

export function useSavedFlash(): { saved: boolean; flash: () => void } {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback(() => {
    setSaved(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), FLASH_MS);
  }, []);

  // A field that unmounts mid-flash (station switch, filter change) must not
  // leave a timer writing to a dead component.
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return { saved, flash };
}

// Autosave-on-blur for one text field, sync-safe.
//
// The naive version (local state + `useEffect` re-syncing from the server prop
// when a `dirty` flag is false) reverts the field to a STALE prop right after a
// save, because saves pass `refetch: false` — the server prop never updates, and
// toggling `dirty` re-runs the sync which writes the old value back over the text
// the user just persisted. Here the baseline is tracked in a ref and advanced on
// save, and the sync effect keys ONLY on the server value changing (never on
// dirty), so a genuine server push (e.g. IMAGE_SHOT writing the rendered prompt
// back) still adopts, but a local save never reverts. Each field owns its own
// dirty ref, so two fields in one row can't wipe each other's unsaved text.
export function useAutosaveField(serverValue: string, save: (v: string) => Promise<boolean>) {
  const [text, setText] = useState(serverValue);
  const dirtyRef = useRef(false);
  const baselineRef = useRef(serverValue);
  const { saved, flash } = useSavedFlash();

  useEffect(() => {
    if (serverValue === baselineRef.current) return; // no real server change
    baselineRef.current = serverValue;
    if (!dirtyRef.current) setText(serverValue); // don't stomp an in-progress edit
  }, [serverValue]);

  const onChange = (v: string) => {
    setText(v);
    dirtyRef.current = true;
  };
  const onBlur = async () => {
    if (text === baselineRef.current) {
      dirtyRef.current = false;
      return;
    }
    if (await save(text)) {
      baselineRef.current = text; // refetch:false → prop won't move; adopt what we saved
      dirtyRef.current = false;
      flash();
    }
  };

  return { text, onChange, onBlur, saved };
}

export function SavedHint({ saved }: { saved: boolean }) {
  return (
    <span
      aria-live="polite"
      className={`inline-flex items-center gap-1 text-xs text-muted-foreground transition-opacity ${
        saved ? "opacity-100" : "opacity-0"
      }`}
    >
      <Check className="size-3 text-green-600 dark:text-green-400" />
      已儲存
    </span>
  );
}

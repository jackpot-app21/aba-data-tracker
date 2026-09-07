"use client";

import { useState, type FormEvent } from "react";

export default function AddInline({
  label,
  onAdd,
}: {
  label: string;
  onAdd: (name: string) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await onAdd(trimmed);
      setValue("");
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="whitespace-nowrap rounded-full border border-dashed border-line px-4 py-2 text-sm font-medium text-ink-faint hover:border-mint-200 hover:text-ink-soft"
      >
        + {label}
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={label}
        className="rounded-full border border-line px-4 py-2 text-sm focus:border-mint-500 focus:outline-none"
      />
      <button
        type="submit"
        disabled={saving}
        className="rounded-full bg-ink px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        OK
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setValue("");
        }}
        className="rounded-full px-3 py-2 text-sm text-ink-faint"
      >
        Annulla
      </button>
    </form>
  );
}

"use client";

import DeleteMenu from "@/components/DeleteMenu";
import type { Avatar, Child } from "@/lib/types";

export default function ChildPicker({
  kids,
  avatars,
  selectedChildId,
  onSelect,
  onCreate,
  onDeleteChild,
  creating,
}: {
  kids: Child[];
  avatars: Avatar[];
  selectedChildId: string | null;
  onSelect: (childId: string) => void;
  onCreate: () => void;
  onDeleteChild: (childId: string) => Promise<void> | void;
  creating: boolean;
}) {
  const avatarById = new Map(avatars.map((a) => [a.id, a]));

  return (
    <div className="flex flex-wrap items-center gap-3">
      {kids.map((child) => {
        const avatar = child.avatar_id ? avatarById.get(child.avatar_id) : null;
        const selected = child.id === selectedChildId;
        return (
          <DeleteMenu
            key={child.id}
            confirmLabel={`Eliminare ${child.code}? Non comparira' piu' nella lista bambini (lo storico delle sessioni resta salvato).`}
            onDelete={() => onDeleteChild(child.id)}
          >
            <button
              type="button"
              onClick={() => onSelect(child.id)}
              className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${
                selected
                  ? "border-mint-500 bg-mint-500 text-white"
                  : "border-line bg-white text-ink-soft hover:border-mint-200"
              }`}
            >
              <span className="text-lg">{avatar?.emoji ?? "❓"}</span>
              {child.code}
            </button>
          </DeleteMenu>
        );
      })}

      <button
        type="button"
        onClick={onCreate}
        disabled={creating}
        className="whitespace-nowrap rounded-full border border-dashed border-line px-4 py-2 text-sm font-medium text-ink-faint hover:border-mint-200 hover:text-ink-soft disabled:opacity-50"
      >
        {creating ? "Creazione..." : "+ Nuovo bambino"}
      </button>
    </div>
  );
}

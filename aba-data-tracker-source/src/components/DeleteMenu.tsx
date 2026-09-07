"use client";

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";

const LONG_PRESS_MS = 500;
const MENU_WIDTH = 240;
const MENU_HEIGHT_ESTIMATE = 110;

type MenuState = {
  x: number;
  y: number;
  confirming: boolean;
  deleting: boolean;
  error: string | null;
};

// Aggiunge "elimina" a qualsiasi elemento avvolto: tasto destro su desktop,
// pressione prolungata su mobile/tablet. "Elimina" qui non cancella mai i
// dati storici dal database (le sessioni gia' registrate restano intatte):
// significa sempre "nascondi da questa lista, per tutti i terapisti" —
// il chiamante decide cosa succede davvero (active=false per un bambino,
// archived=true per un obiettivo/item/task) tramite onDelete.
export default function DeleteMenu({
  children,
  confirmLabel,
  onDelete,
  className,
}: {
  children: ReactNode;
  confirmLabel: string;
  onDelete: () => Promise<void> | void;
  className?: string;
}) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const movedRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;

    // Eventi nativi del DOM (non i tipi sintetici di React, che qui
    // sarebbero incompatibili con addEventListener su document).
    function handleOutside(e: MouseEvent | TouchEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setMenu(null);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(null);
    }

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menu]);

  function openAt(clientX: number, clientY: number) {
    const x = Math.min(Math.max(8, clientX), window.innerWidth - MENU_WIDTH - 8);
    const y = Math.min(Math.max(8, clientY), window.innerHeight - MENU_HEIGHT_ESTIMATE - 8);
    setMenu({ x, y, confirming: false, deleting: false, error: null });
  }

  function handleContextMenu(e: ReactMouseEvent<HTMLDivElement>) {
    e.preventDefault();
    openAt(e.clientX, e.clientY);
  }

  function handleTouchStart(e: ReactTouchEvent<HTMLDivElement>) {
    movedRef.current = false;
    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;
    timerRef.current = setTimeout(() => {
      if (!movedRef.current) openAt(x, y);
    }, LONG_PRESS_MS);
  }
  function cancelLongPress() {
    movedRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  async function handleConfirm() {
    setMenu((m) => (m ? { ...m, deleting: true, error: null } : m));
    try {
      await onDelete();
      setMenu(null);
    } catch (err) {
      setMenu((m) =>
        m
          ? {
              ...m,
              deleting: false,
              error: err instanceof Error ? err.message : "Errore imprevisto.",
            }
          : m
      );
    }
  }

  return (
    <div
      className={`no-callout select-none ${className ?? ""}`}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchMove={cancelLongPress}
      onTouchEnd={cancelLongPress}
      onTouchCancel={cancelLongPress}
    >
      {children}

      {menu && (
        <div
          ref={panelRef}
          style={{ position: "fixed", left: menu.x, top: menu.y, zIndex: 50 }}
          className="w-60 rounded-xl border border-line bg-white p-2 shadow-lg"
        >
          {!menu.confirming ? (
            <button
              type="button"
              onClick={() => setMenu((m) => (m ? { ...m, confirming: true } : m))}
              className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-prompted hover:bg-mint-50"
            >
              Elimina
            </button>
          ) : (
            <div className="flex flex-col gap-2 p-1">
              <p className="text-xs text-ink-soft">{confirmLabel}</p>
              {menu.error && <p className="text-xs text-prompted">{menu.error}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={menu.deleting}
                  className="flex-1 rounded-lg bg-prompted px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {menu.deleting ? "Eliminazione..." : "Elimina"}
                </button>
                <button
                  type="button"
                  onClick={() => setMenu(null)}
                  disabled={menu.deleting}
                  className="flex-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft disabled:opacity-50"
                >
                  Annulla
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

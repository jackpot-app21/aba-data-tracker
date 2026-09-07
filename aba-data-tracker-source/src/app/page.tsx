"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import Logo from "@/components/Logo";
import ChildPicker from "@/components/ChildPicker";
import ProgramTracker from "@/components/ProgramTracker";
import ReportView from "@/components/ReportView";
import PhotoImport from "@/components/PhotoImport";
import { generateChildCode } from "@/lib/codes";
import type { Avatar, Child } from "@/lib/types";

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<User | null | "loading">("loading");
  const [kids, setKids] = useState<Child[]>([]);
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [creatingChild, setCreatingChild] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"registra" | "andamento" | "foto">(
    "registra"
  );

  useEffect(() => {
    if (!supabase) {
      setUser(null);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user === "loading") return;
    if (!user) router.replace("/login");
  }, [user, router]);

  useEffect(() => {
    if (!supabase || user === "loading" || !user) return;
    const currentUser = user;

    async function ensureProfile() {
      const { data: existing } = await supabase!
        .from("therapist_profiles")
        .select("id")
        .eq("id", currentUser.id)
        .maybeSingle();

      if (!existing) {
        await supabase!.from("therapist_profiles").insert({
          id: currentUser.id,
          full_name:
            (currentUser.user_metadata?.full_name as string | undefined) ||
            currentUser.email?.split("@")[0] ||
            "Terapista",
        });
      }
    }

    ensureProfile();
  }, [user]);

  const loadData = useCallback(async () => {
    if (!supabase) return;
    const [{ data: childRows }, { data: avatarRows }] = await Promise.all([
      supabase.from("children").select("*").eq("active", true).order("created_at"),
      supabase.from("avatars").select("*").order("id"),
    ]);
    setKids((childRows ?? []) as Child[]);
    setAvatars((avatarRows ?? []) as Avatar[]);
  }, []);

  useEffect(() => {
    if (user === "loading" || !user) return;
    loadData();
  }, [user, loadData]);

  async function handleCreateChild() {
    if (!supabase || avatars.length === 0) return;
    setCreatingChild(true);
    setError(null);
    try {
      const randomAvatar = avatars[Math.floor(Math.random() * avatars.length)];
      let lastError: string | null = null;

      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateChildCode();
        const { data, error: insertError } = await supabase
          .from("children")
          .insert({ code, avatar_id: randomAvatar.id })
          .select()
          .single();

        if (!insertError && data) {
          const newChild = data as Child;
          setKids((prev) => [...prev, newChild]);
          setView("registra");
          setSelectedChildId(newChild.id);
          lastError = null;
          break;
        }
        lastError = insertError?.message ?? "Errore sconosciuto";
      }

      if (lastError) setError(lastError);
    } finally {
      setCreatingChild(false);
    }
  }

  async function handleDeleteChild(childId: string) {
    if (!supabase) return;
    const { error: updateError } = await supabase
      .from("children")
      .update({ active: false })
      .eq("id", childId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setKids((prev) => prev.filter((k) => k.id !== childId));
    setSelectedChildId((prev) => (prev === childId ? null : prev));
  }

  async function handleLogout() {
    if (!supabase) return;
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (user === "loading" || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-ink-faint">Caricamento...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Logo className="h-7 w-7 flex-shrink-0" />
          <h1 className="font-display text-xl font-extrabold tracking-tight">
            ABA Data Tracker
          </h1>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="text-sm text-ink-faint underline"
        >
          Esci
        </button>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Bambino
        </h2>
        <ChildPicker
          kids={kids}
          avatars={avatars}
          selectedChildId={selectedChildId}
          onSelect={(id) => {
            setView("registra");
            setSelectedChildId(id);
          }}
          onCreate={handleCreateChild}
          onDeleteChild={handleDeleteChild}
          creating={creatingChild}
        />
      </section>

      {error && <p className="text-sm text-prompted">{error}</p>}

      {selectedChildId ? (
        <div className="flex flex-col gap-4">
          <div className="flex gap-2 border-b border-line">
            <TabButton
              label="Registra"
              active={view === "registra"}
              onClick={() => setView("registra")}
            />
            <TabButton
              label="Andamento"
              active={view === "andamento"}
              onClick={() => setView("andamento")}
            />
            <TabButton
              label="Da foto"
              active={view === "foto"}
              onClick={() => setView("foto")}
            />
          </div>

          {view === "registra" && (
            <ProgramTracker childId={selectedChildId} therapistId={user.id} />
          )}
          {view === "andamento" && (
            <ReportView
              childId={selectedChildId}
              childLabel={
                kids.find((k) => k.id === selectedChildId)?.code ?? "Bambino"
              }
            />
          )}
          {view === "foto" && (
            <PhotoImport childId={selectedChildId} therapistId={user.id} />
          )}
        </div>
      ) : (
        <p className="text-center text-ink-faint">
          Seleziona o crea un bambino per iniziare la sessione di oggi.
        </p>
      )}
    </main>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
        active
          ? "border-mint-500 text-ink"
          : "border-transparent text-ink-faint hover:text-ink-soft"
      }`}
    >
      {label}
    </button>
  );
}

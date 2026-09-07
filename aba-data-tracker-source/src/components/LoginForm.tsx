"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import Logo from "@/components/Logo";

export default function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setError("Database non configurato (variabili Supabase mancanti).");
      return;
    }

    setError(null);
    setInfo(null);
    setLoading(true);

    try {
      if (mode === "signin") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        router.replace("/");
        router.refresh();
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName || email.split("@")[0] } },
        });
        if (signUpError) throw signUpError;

        if (data.session) {
          // Conferma email disattivata: sessione gia' attiva.
          router.replace("/");
          router.refresh();
        } else {
          setInfo(
            "Account creato. Controlla la tua email per confermare, poi accedi qui sotto."
          );
          setMode("signin");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore imprevisto.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
      <Logo className="mx-auto mb-3 h-12 w-12" />
      <h1 className="font-display mb-1 text-center text-2xl font-extrabold tracking-tight">
        ABA Data Tracker
      </h1>
      <p className="mb-8 text-center text-sm text-ink-soft">
        {mode === "signin" ? "Accedi per iniziare" : "Crea il tuo account"}
      </p>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-6 shadow-sm"
      >
        {mode === "signup" && (
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            Nome
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="rounded-lg border border-line px-3 py-2 text-base focus:border-mint-500 focus:outline-none focus:ring-2 focus:ring-mint-100"
              placeholder="Il tuo nome"
            />
          </label>
        )}

        <label className="flex flex-col gap-1 text-sm font-medium text-ink">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-line px-3 py-2 text-base focus:border-mint-500 focus:outline-none focus:ring-2 focus:ring-mint-100"
            placeholder="nome@esempio.it"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-ink">
          Password
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-line px-3 py-2 text-base focus:border-mint-500 focus:outline-none focus:ring-2 focus:ring-mint-100"
            placeholder="Almeno 6 caratteri"
          />
        </label>

        {error && <p className="text-sm text-prompted">{error}</p>}
        {info && <p className="text-sm text-mint-600">{info}</p>}

        <button
          type="submit"
          disabled={loading}
          className="font-display rounded-lg bg-ink px-4 py-3 text-base font-bold text-white disabled:opacity-50"
        >
          {loading
            ? "Attendi..."
            : mode === "signin"
              ? "Accedi"
              : "Crea account"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError(null);
          setInfo(null);
        }}
        className="mt-4 text-sm text-ink-soft underline"
      >
        {mode === "signin"
          ? "Non hai un account? Registrati"
          : "Hai gia' un account? Accedi"}
      </button>
    </main>
  );
}

import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Verde/rosso ricalibrati (validati per separazione cromatica in
        // caso di daltonismo, deltaE ~10 su scala OKLab) — restano comunque
        // doppiamente codificati con lettera S/P e simbolo +/-.
        correct: "#0b8f76",
        prompted: "#e2483f",
        // Palette "menta" per sfondi, superfici e stati selezionati.
        mint: {
          50: "#eafbf5",
          100: "#dff6ec",
          200: "#b9f0dc",
          500: "#3fae8a",
          600: "#227a5e",
        },
        ink: {
          DEFAULT: "#163832",
          soft: "#5a7871",
          faint: "#8aa39c",
        },
        line: "#cdeee0",
      },
      fontFamily: {
        // Testo corrente e dati: grottesco ad alta leggibilita' anche a
        // dimensioni piccole (numeri, sigle S/P).
        sans: ["var(--font-plex)", "system-ui", "-apple-system", "sans-serif"],
        // Titoli e pulsanti principali: piu' caldo e arrotondato.
        display: ["var(--font-nunito)", "system-ui", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;

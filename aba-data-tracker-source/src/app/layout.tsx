import type { Metadata } from "next";
import { Nunito, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-nunito",
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ABA Data Tracker",
  description: "Presa dati veloce per sessioni di terapia ABA",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" className={`${nunito.variable} ${plexSans.variable}`}>
      <body className="min-h-screen bg-mint-50 text-ink antialiased">
        {children}
      </body>
    </html>
  );
}

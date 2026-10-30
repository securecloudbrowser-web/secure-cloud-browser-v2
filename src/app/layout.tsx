import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Stitch design system (Aether Browser Engine board): Inter for headline /
// body, JetBrains Mono for labels and stats.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: "Secure Cloud Browser",
  description: "Persistent cloud browser on an RDP host — always logged in, shareable without passwords."
};

// Root layout is intentionally chrome-free: the landing page brings its
// own header/footer, auth pages are centered glass cards, and everything
// under /dashboard renders inside the Stitch app shell (sidebar + top
// bar) from src/app/dashboard/layout.tsx.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="relative min-h-screen overflow-x-hidden bg-[#0B0F1A] font-sans text-zinc-100 antialiased">
        {/* Ambient background glows — Stitch palette */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-40 left-1/2 h-96 w-[52rem] -translate-x-1/2 rounded-full bg-indigo-600/20 blur-3xl" />
          <div className="absolute right-[-10rem] top-64 h-80 w-80 rounded-full bg-cyan-500/10 blur-3xl" />
          <div className="absolute left-[-8rem] top-[36rem] h-80 w-80 rounded-full bg-violet-600/10 blur-3xl" />
        </div>
        {children}
      </body>
    </html>
  );
}

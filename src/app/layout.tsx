import type { Metadata } from "next";
import { DM_Sans, Instrument_Serif } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

const sans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const display = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Crossfire — a room for hard questions",
  description:
    "Three AI voices, one table, and a judge at the far end. Watch the argument, cut in, and read the verdict.",
};

const themeScript = `
(function () {
  try {
    if (localStorage.getItem("crossfire-theme") === "dark") {
      document.documentElement.dataset.theme = "dark";
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${sans.variable} ${display.variable}`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brain, Home, KeyRound, Moon, Plus, Settings, Sun } from "lucide-react";

const NAV = [
  { href: "/", label: "Debates", icon: Home },
  { href: "/new", label: "New debate", icon: Plus },
  { href: "/beliefs", label: "Belief map", icon: Brain },
  { href: "/pool", label: "Pool", icon: KeyRound },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/debate/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

function BrandMark() {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" focusable="false">
      <circle cx="20" cy="23" r="8.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="32" r="2.7" fill="var(--accent)" />
      <circle cx="20" cy="35" r="2.7" fill="var(--accent)" />
      <circle cx="30" cy="32" r="2.7" fill="var(--accent)" />
      <circle cx="20" cy="5" r="1.8" fill="currentColor" />
      <path
        d="M20 8v4.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeDasharray="1.4 2.2"
      />
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    if (document.documentElement.dataset.theme === "dark") setTheme("dark");
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("crossfire-theme", next);
    } catch {
      // Local storage may be unavailable.
    }
  }

  const themeButton = (
    <button
      className="icon-button theme-button"
      onClick={toggleTheme}
      type="button"
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
      title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
    >
      {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
    </button>
  );

  return (
    <div className="site-shell">
      <header className="site-header">
        <Link href="/" className="brand" aria-label="Crossfire home">
          <span className="brand-mark" aria-hidden="true">
            <BrandMark />
          </span>
          <span>
            <span className="brand-word">CROSSFIRE</span>
            <span className="brand-sub">a room for hard questions</span>
          </span>
        </Link>

        <nav className="top-nav" aria-label="Main navigation">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="nav-link"
                data-active={isActive(pathname, item.href)}
              >
                <Icon />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="header-actions">
          <span className="header-note">Live · free models</span>
          {themeButton}
        </div>
      </header>

      <div className="main">{children}</div>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="nav-link"
              data-active={isActive(pathname, item.href)}
            >
              <Icon />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

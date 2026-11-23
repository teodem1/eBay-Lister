import Link from "next/link";
import type { ReactNode } from "react";
import ToListCount from "./ToListCount";

/** The app's price-tag mark, same shape as the launcher icon. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden className="shrink-0">
      <rect width="512" height="512" rx="128" fill="var(--brand)" />
      <g transform="translate(256 256) rotate(-30) translate(-256 -256)">
        <path
          d="M150 170 h170 l70 86 -70 86 h-170 a20 20 0 0 1 -20 -20 v-132 a20 20 0 0 1 20 -20z"
          fill="var(--brand-fg)"
        />
        <circle cx="318" cy="256" r="20" fill="var(--brand)" />
        <path d="M170 226h16v60h-16zM196 226h8v60h-8zM214 226h16v60h-16zM240 226h8v60h-8zM258 226h12v60h-12z" fill="var(--brand)" />
      </g>
    </svg>
  );
}

/**
 * Sticky top bar. With `back`, shows a back arrow to that page instead of the
 * logo. Pads for the status bar when the app draws edge to edge.
 */
export function AppBar({ title, back, action }: { title: string; back?: { href: string; label: string }; action?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-background/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-lg items-center gap-3 px-4">
        {back ? (
          <Link
            href={back.href}
            aria-label={back.label}
            className="icon-btn -ml-3 text-foreground"
          >
            <Icon name="back" size={24} />
          </Link>
        ) : (
          <Logo size={30} />
        )}
        <span className="t-headline flex-1 truncate">{title}</span>
        {action}
      </div>
    </header>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`spinner ${className}`} aria-hidden />;
}

/**
 * Numbered section heading used on the listing screen. Sits above its card,
 * with an optional action (e.g. Refresh) on the right.
 */
export function StepHeading({ n, title, hint, action }: { n: number; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-1">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-xs font-semibold text-foreground">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="t-headline">{title}</h2>
        {hint && <p className="t-small text-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

const ICONS = {
  back: <path d="M20 12H4m0 0 6-6m-6 6 6 6" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  camera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  stack: (
    <>
      <rect x="4" y="9" width="16" height="11" rx="2" />
      <path d="M6.5 6h11M9 3h6" />
    </>
  ),
  barcode: <path d="M4 6v12M7 6v12M10 6v12M14 6v12M16 6v12M20 6v12" />,
  scan: <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 9v6M11 9v6M14 9v6M17 9v6" />,
  disc: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  discAdd: (
    <>
      <path d="M20.4 13A8.5 8.5 0 1 1 11 3.55" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M18 3v6M15 6h6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  alert: <path d="M12 9v4m0 3.5v.01M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
} as const;

export type IconName = keyof typeof ICONS;

/** Stroke icon set used across the app (one style, 24px grid). */
export function Icon({ name, size = 20, className = "", strokeWidth = 2 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      {ICONS[name]}
    </svg>
  );
}

/** Bottom tabs: Scan (/), To list and Collection. Pages using it add the `page-tabs` class. */
export function TabBar({ active }: { active: "scan" | "tolist" | "collection" }) {
  const tabs = [
    { key: "scan", href: "/", label: "Scan", icon: "scan" },
    { key: "tolist", href: "/to-list", label: "To list", icon: "stack" },
    { key: "collection", href: "/collection", label: "Collection", icon: "disc" },
  ] as const;
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl"
    >
      <ul className="mx-auto grid h-20 max-w-lg grid-cols-3">
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <li key={t.key}>
              <Link
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={`flex h-full flex-col items-center justify-center gap-1 text-xs ${on ? "font-bold text-brand-ink" : "font-medium text-muted"}`}
              >
                <span className={`relative flex h-8 w-16 items-center justify-center rounded-full transition-colors ${on ? "bg-brand-soft" : ""}`}>
                  <Icon name={t.icon} size={22} strokeWidth={on ? 2.2 : 1.8} />
                  {t.key === "tolist" && <ToListCount />}
                </span>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

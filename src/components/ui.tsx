import Link from "next/link";
import type { ReactNode } from "react";
import ToListCount from "./ToListCount";
import SoldLimitBanner from "./SoldLimitBanner";

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
 * Top of a screen. A tab screen (no `back`) gets a large title with an
 * optional one-line `subtitle`; a pushed screen (`back`) gets a sticky bar
 * with a back arrow. Pads for the status bar when the app draws edge to edge.
 */
export function AppBar({
  title,
  subtitle,
  back,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  back?: { href: string; label: string };
  action?: ReactNode;
}) {
  if (!back) {
    return (
      <header className="bg-background pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex w-full max-w-lg items-start gap-3 px-4 pb-1 pt-6">
          <div className="min-w-0 flex-1">
            <h1 className="t-display">{title}</h1>
            {subtitle && <p className="t-caption mt-1 text-muted">{subtitle}</p>}
          </div>
          {action}
        </div>
        <SoldLimitBanner />
      </header>
    );
  }
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-background pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-14 w-full max-w-lg items-center gap-2 px-4">
        <Link href={back.href} aria-label={back.label} className="icon-btn -ml-3 text-foreground">
          <Icon name="back" size={24} />
        </Link>
        <span className="t-title flex-1 truncate">{title}</span>
        {action}
      </div>
      <SoldLimitBanner />
    </header>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`spinner ${className}`} aria-hidden />;
}

/**
 * Section heading used on the listing screen. Sits above its card, with an
 * optional action (e.g. Refresh) on the right. `n` is the step's place in the
 * flow; the steps read top to bottom, so it isn't drawn.
 */
export function StepHeading({ title, hint, action }: { n: number; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex items-end gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="t-title">{title}</h2>
        {hint && <p className="t-caption mt-0.5 text-muted">{hint}</p>}
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
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  bolt: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  list: <path d="M5 7h14M5 12h14M5 17h9" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  keyboard: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M7 10h.01M10 10h.01M13 10h.01M16 10h.01M8 14h8" />
    </>
  ),
  layers: <path d="m12 4 9 4.5-9 4.5-9-4.5zM3 12.5l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  hourglass: <path d="M7 4h10M7 20h10M8 4c0 4 8 4 8 8s-8 4-8 8M16 4c0 4-8 4-8 8s8 4 8 8" />,
  pause: <path d="M9 6v12M15 6v12" />,
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

/** Bottom tabs: Scan (/), To list, Auto, Review and Collection. Pages using it add the `page-tabs` class. */
export function TabBar({ active }: { active: "scan" | "tolist" | "auto" | "review" | "collection" }) {
  const tabs = [
    { key: "scan", href: "/", label: "Scan", icon: "scan" },
    { key: "tolist", href: "/to-list", label: "To list", icon: "list" },
    { key: "auto", href: "/auto", label: "Auto", icon: "stack" },
    { key: "review", href: "/review", label: "Review", icon: "eye" },
    { key: "collection", href: "/collection", label: "Collection", icon: "disc" },
  ] as const;
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid h-[4.5rem] max-w-lg grid-cols-5">
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <li key={t.key}>
              <Link
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={`flex h-full flex-col items-center justify-center gap-1 text-xs ${on ? "font-semibold text-foreground" : "font-medium text-muted"}`}
              >
                <span
                  className={`relative flex h-8 w-14 items-center justify-center rounded-full border transition-colors ${on ? "border-accent bg-brand" : "border-transparent"}`}
                >
                  <Icon name={t.icon} size={22} strokeWidth={on ? 2 : 1.7} />
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

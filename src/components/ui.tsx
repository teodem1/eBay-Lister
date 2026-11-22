import Link from "next/link";
import type { ReactNode } from "react";

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
            className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-foreground active:bg-surface-2"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </Link>
        ) : (
          <Logo size={30} />
        )}
        <span className="flex-1 truncate text-[1.0625rem] font-semibold tracking-tight">{title}</span>
        {action}
      </div>
    </header>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`spinner ${className}`} aria-hidden />;
}

/** Numbered section heading used on the listing screen. */
export function StepHeading({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-ink">
        {n}
      </span>
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {hint && <p className="text-sm text-muted">{hint}</p>}
      </div>
    </div>
  );
}

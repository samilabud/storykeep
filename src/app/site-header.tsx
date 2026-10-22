import Link from "next/link";
import { logout } from "@/app/(auth)/actions";

const navLink =
  "rounded-md px-2 py-1 text-sm text-muted transition hover:text-ink focus-visible:outline-2 focus-visible:outline-accent";

/**
 * The bar at the top of every page. "app" is for signed-in pages; those pages
 * check the session themselves, so this header reads nothing and stays static.
 */
export function SiteHeader({ variant }: { variant: "app" | "public" }) {
  return (
    <header className="border-b border-line bg-surface/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link
          href={variant === "app" ? "/stories" : "/"}
          className="font-display text-xl font-semibold tracking-tight"
        >
          Story<span className="text-accent">Keep</span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
          {variant === "app" ? (
            <>
              <Link href="/stories" className={navLink}>
                My stories
              </Link>
              <Link href="/billing" className={navLink}>
                Billing
              </Link>
              <form action={logout}>
                <button type="submit" className={navLink}>
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className={navLink}>
                Sign in
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition hover:opacity-90"
              >
                Get started
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

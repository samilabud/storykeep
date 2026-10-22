"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SiteHeader } from "@/app/site-header";
import { buttonPrimary, card, field, muted, textLink } from "@/app/ui";
import type { AuthFormState } from "./actions";

type Props = {
  mode: "login" | "register";
  action: (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>;
};

export function AuthForm({ mode, action }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const isLogin = mode === "login";

  return (
    <>
      <SiteHeader variant="public" />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-12 sm:py-20">
        <div className={card}>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {isLogin ? "Sign in" : "Create your account"}
          </h1>
          <p className={`mt-2 ${muted}`}>
            {isLogin
              ? "Welcome back. Your stories are where you left them."
              : "Start a life story or a eulogy in a few minutes."}
          </p>

          <form action={formAction} className="mt-6 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Email
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                defaultValue={state?.email}
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Password
              <input
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete={isLogin ? "current-password" : "new-password"}
                className={field}
              />
              {!isLogin && (
                <span className="font-normal text-muted">At least 8 characters.</span>
              )}
            </label>

            {state?.error && (
              <p
                role="alert"
                className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
              >
                {state.error}
              </p>
            )}

            <button
              type="submit"
              disabled={pending}
              className={`${buttonPrimary} py-2.5 text-base`}
            >
              {isLogin ? "Sign in" : "Create account"}
            </button>
          </form>

          <p className={`mt-6 ${muted}`}>
            {isLogin ? "No account yet? " : "Already have an account? "}
            <Link
              href={isLogin ? "/register" : "/login"}
              className={`${textLink} text-ink`}
            >
              {isLogin ? "Create one" : "Sign in"}
            </Link>
          </p>
        </div>
      </main>
    </>
  );
}

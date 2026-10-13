"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth/config";
import { hashPassword } from "@/auth/password";
import { credentialsSchema } from "@/auth/validation";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";

// `email` is sent back so the form can keep it after an error. React clears
// a form when its action finishes.
export type AuthFormState = { error: string; email: string } | undefined;

export async function register(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const typedEmail = String(formData.get("email") ?? "");
  const parsed = credentialsSchema.safeParse({
    email: typedEmail,
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
      email: typedEmail,
    };
  }
  const { email, password } = parsed.data;

  // ON CONFLICT DO NOTHING: if the email exists, no row comes back. The
  // database decides, so two sign-ups at the same moment cannot both win.
  const inserted = await getDb()
    .insert(users)
    .values({ email, passwordHash: await hashPassword(password) })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id });
  if (inserted.length === 0) {
    return { error: "An account with this email already exists.", email };
  }

  // signIn redirects by throwing, so nothing after this line runs.
  await signIn("credentials", { email, password, redirectTo: "/stories" });
}

export async function login(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/stories",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        error: "Wrong email or password.",
        email: String(formData.get("email") ?? ""),
      };
    }
    throw error; // the redirect after a successful login is also a throw
  }
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}

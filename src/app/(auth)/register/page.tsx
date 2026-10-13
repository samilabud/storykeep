import { register } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Create account · StoryKeep" };

export default function RegisterPage() {
  return <AuthForm mode="register" action={register} />;
}

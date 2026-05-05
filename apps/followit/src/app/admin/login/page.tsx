import { redirect } from "next/navigation";
import { GammaLogo } from "@/components/GammaLogo";
import { setAdminSession, validateAdminCredentials } from "@/lib/admin-auth";

interface LoginPageProps {
  readonly searchParams: Promise<{ readonly error?: string }>;
}

async function login(formData: FormData) {
  "use server";

  const user = String(formData.get("user") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!validateAdminCredentials(user, password)) {
    redirect("/admin/login?error=1");
  }

  await setAdminSession();
  redirect("/admin");
}

export const metadata = {
  title: "Admin Login",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;

  return (
    <main className="login-page">
      <form className="login-panel" action={login}>
        <GammaLogo />
        <div>
          <p className="sop-kicker">FollowIT Admin</p>
          <h1>Sign in</h1>
        </div>
        {error && <p className="login-error">Invalid username or password.</p>}
        <label>
          Username
          <input name="user" autoComplete="username" defaultValue="admin" />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" />
        </label>
        <button className="button button-primary" type="submit">
          Sign in
        </button>
      </form>
    </main>
  );
}

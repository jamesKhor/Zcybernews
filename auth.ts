import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const validUsername = process.env.ADMIN_USERNAME;
        const plaintextPassword = process.env.ADMIN_PASSWORD;
        const passwordHash = process.env.ADMIN_PASSWORD_HASH;

        if (!validUsername) {
          console.error("[auth] ADMIN_USERNAME not set");
          return null;
        }

        if (!plaintextPassword && !passwordHash) {
          console.error(
            "[auth] Neither ADMIN_PASSWORD nor ADMIN_PASSWORD_HASH is set",
          );
          return null;
        }

        if (credentials.username !== validUsername) {
          console.warn(
            `[auth] Username mismatch (got=${credentials.username})`,
          );
          return null;
        }

        const password = String(credentials.password);

        // Plaintext takes precedence when set — easier mental model, avoids
        // the "stale hash silently wins" trap. Set ADMIN_PASSWORD="" to force
        // hash-only mode.
        if (plaintextPassword) {
          if (password !== plaintextPassword) {
            console.warn("[auth] Plaintext password mismatch");
            return null;
          }
          return { id: "1", name: "Admin" };
        }

        if (passwordHash) {
          const valid = await bcrypt.compare(password, passwordHash);
          if (!valid) {
            console.warn("[auth] bcrypt password mismatch");
            return null;
          }
          return { id: "1", name: "Admin" };
        }

        return null;
      },
    }),
  ],
  pages: {
    signIn: "/admin/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // 8 hours
  },
  // Do NOT add an `authorized` callback here — it would block all public routes.
  // Route protection is handled selectively in proxy.ts for /admin/** only.
});

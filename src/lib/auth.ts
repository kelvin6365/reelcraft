import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import { sendMail } from "@/lib/user/mailer";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    // Reuses better-auth's built-in Verification table for the reset token
    // (single-use, expiring — no bespoke token model needed). See
    // node_modules/better-auth/dist/api/routes/password.mjs for the
    // request-password-reset / reset-password endpoint behavior.
    sendResetPassword: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: "重設 ReelCraft 密碼",
        text: `你好，\n\n我哋收到你重設密碼嘅要求。請按以下連結重設密碼（一小時內有效，只可使用一次）：\n\n${url}\n\n如果唔係你本人提出，可以忽略呢封電郵。`,
      });
    },
  },
  advanced: {
    database: {
      // PKs are app-side UUIDv7 everywhere (docs/tech/01-data-model.md)
      generateId: () => newId(),
    },
  },
});

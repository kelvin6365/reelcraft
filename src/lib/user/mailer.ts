// Thin mailer stub. No SMTP/email-provider integration yet — in dev (and until
// a real provider is wired up) this just logs the message to the server
// console so the reset link is reachable during local testing.
//
// TODO(smtp): wire a real provider (Resend/SES/etc). When that lands, swap
// the console.log branch below for an actual send and gate it behind env
// vars added to src/lib/env.ts (the only file allowed to read raw env vars).

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
};

export async function sendMail(message: MailMessage): Promise<void> {
  // biome-ignore lint/suspicious/noConsole: dev-only mail stub, see TODO above
  console.log(
    `[mailer] TODO: no SMTP configured — logging email instead of sending.\n` +
      `  to: ${message.to}\n` +
      `  subject: ${message.subject}\n` +
      `  body:\n${message.text}\n`
  );
  return Promise.resolve();
}

import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { getEnv } from "@/env";
import { logger } from "@/lib/logger";

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
}

let transporter: Transporter | null | undefined;
const outbox: MailMessage[] = [];

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;
  const env = getEnv();
  transporter = env.SMTP_HOST
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
      })
    : null;
  return transporter;
}

/**
 * Sends email over SMTP when configured; otherwise logs a summary (no body / recipients) and keeps
 * the message in an in-memory outbox that tests can inspect.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  if (message.to.length === 0) return;
  const t = getTransporter();
  if (!t) {
    outbox.push(message);
    if (outbox.length > 200) outbox.shift();
    logger.info(
      { subject: message.subject, recipients: message.to.length },
      "email (SMTP not configured — logged only)",
    );
    return;
  }
  await t.sendMail({
    from: getEnv().EMAIL_FROM,
    to: message.to.join(", "),
    subject: message.subject,
    text: message.text,
  });
  logger.info({ subject: message.subject, recipients: message.to.length }, "email sent");
}

export function getOutbox(): readonly MailMessage[] {
  return outbox;
}

export function clearOutbox(): void {
  outbox.length = 0;
}

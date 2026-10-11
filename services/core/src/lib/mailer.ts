import nodemailer from 'nodemailer';
import type { Config } from '../config.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
  /** Development only: recently "sent" mail, so OTP codes can be read without an inbox. */
  outbox(): (Mail & { sentAt: string })[];
}

export function createMailer(config: Config, log: (msg: string) => void): Mailer {
  const recent: (Mail & { sentAt: string })[] = [];
  const remember = (mail: Mail) => {
    recent.unshift({ ...mail, sentAt: new Date().toISOString() });
    recent.length = Math.min(recent.length, 50);
  };

  if (config.mail.mode === 'console') {
    return {
      async send(mail) {
        remember(mail);
        log(`[mail] to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
      },
      outbox: () => recent,
    };
  }

  const transport = nodemailer.createTransport(config.mail.smtpUrl!);
  return {
    async send(mail) {
      await transport.sendMail({ from: config.mail.from, ...mail });
    },
    outbox: () => [],
  };
}

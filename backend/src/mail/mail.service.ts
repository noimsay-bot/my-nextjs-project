import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter = nodemailer.createTransport({
    host: this.configService.getOrThrow<string>("SMTP_HOST"),
    port: this.configService.getOrThrow<number>("SMTP_PORT"),
    secure: this.configService.getOrThrow<boolean>("SMTP_SECURE"),
    auth: this.configService.get<string>("SMTP_USER")
      ? {
          user: this.configService.get<string>("SMTP_USER"),
          pass: this.configService.get<string>("SMTP_PASS"),
        }
      : undefined,
  });

  constructor(private readonly configService: ConfigService) {}

  async sendMail(input: { to: string; subject: string; text: string; html?: string }) {
    const logOnly = this.configService.getOrThrow<boolean>("MAIL_LOG_ONLY");

    if (logOnly) {
      this.logger.log(`[MAIL_LOG_ONLY] to=${input.to} subject=${input.subject}\n${input.text}`);
      return;
    }

    await this.transporter.sendMail({
      from: this.configService.getOrThrow<string>("EMAIL_FROM"),
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
  }
}

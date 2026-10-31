import nodemailer from 'nodemailer';

export class MailService {
  /**
   * Creates a fresh Ethereal test account for a sender.
   */
  static async createEtherealAccount() {
    const testAccount = await nodemailer.createTestAccount();
    return {
      smtpHost: testAccount.smtp.host,
      smtpPort: testAccount.smtp.port,
      smtpUser: testAccount.user,
      smtpPass: testAccount.pass,
    };
  }

  /**
   * Sends an email using the specific Sender's Ethereal SMTP credentials.
   */
  static async sendEmail(params: {
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPass: string;
    fromName: string;
    fromEmail: string;
    to: string;
    subject: string;
    html: string;
  }) {
    const transporter = nodemailer.createTransport({
      host: params.smtpHost,
      port: params.smtpPort,
      secure: params.smtpPort === 465,
      auth: {
        user: params.smtpUser,
        pass: params.smtpPass,
      },
    });

    const info = await transporter.sendMail({
      from: `"${params.fromName}" <${params.fromEmail}>`,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);

    return {
      messageId: info.messageId,
      previewUrl: typeof previewUrl === 'string' ? previewUrl : null,
    };
  }
}
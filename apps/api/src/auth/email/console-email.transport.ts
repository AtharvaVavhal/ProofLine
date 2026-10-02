import { EmailTransport, signInCodeMessage } from './email-transport';

/**
 * Local-development transport: prints the message to stdout instead of sending it. It is not
 * an application log. Configuration refuses it when NODE_ENV=production (09 §6).
 */
export class ConsoleEmailTransport implements EmailTransport {
  async sendSignInCode(to: string, code: string): Promise<void> {
    const { subject, text } = signInCodeMessage(code);
    process.stdout.write(
      `\n[dev email transport — not for production]\nTo: ${to}\nSubject: ${subject}\n\n${text}\n\n`,
    );
  }
}

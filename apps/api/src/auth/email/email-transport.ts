/** Port for sending sign-in codes (04 §29). The message contains only the code and its expiry. */
export interface EmailTransport {
  sendSignInCode(to: string, code: string): Promise<void>;
}

export const EMAIL_TRANSPORT = Symbol('EMAIL_TRANSPORT');

export function signInCodeMessage(code: string): { subject: string; text: string } {
  return {
    subject: 'Your Proofline sign-in code',
    text: [
      `Your Proofline sign-in code is ${code}.`,
      'It expires in 10 minutes and can be used once.',
      "If you didn't ask for this code, you can ignore this email.",
    ].join('\n'),
  };
}

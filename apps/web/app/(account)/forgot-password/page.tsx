import { ForgotPasswordForm } from './ForgotPasswordForm';

export const metadata = { title: 'Reset password', robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}

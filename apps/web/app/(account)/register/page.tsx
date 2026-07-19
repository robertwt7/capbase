import { RegisterForm } from './RegisterForm';

export const metadata = {
  title: 'Create an account',
  robots: { index: false, follow: false },
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <RegisterForm next={next} />;
}

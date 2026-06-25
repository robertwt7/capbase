'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { TOKEN_COOKIE } from '../../lib/auth';

/** Clear the session cookie and return to the landing page. */
export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(TOKEN_COOKIE);
  redirect('/');
}

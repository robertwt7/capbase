export type Role = 'USER' | 'ADMIN';

export interface RegisterInput {
  email: string;
  name: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}

export interface UpdateProfileInput {
  name: string;
  email: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface ForgotPasswordInput {
  email: string;
}

export interface ResetPasswordInput {
  token: string;
  password: string;
}

/** Most PENDING submissions one account may have in the queue at once. Above
 *  it, contributions answer 429 until a moderator catches up. */
export const MAX_PENDING_SUBMISSIONS = 30;

/** Header carrying a Cloudflare Turnstile token from the web to the API. */
export const TURNSTILE_HEADER = 'x-turnstile-token';

/** One account as the admin user list shows it. */
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** ISO timestamp, or null when the account is in good standing. */
  bannedAt: string | null;
  createdAt: string;
  pendingCount: number;
}

export interface AdminUserListQuery {
  q?: string;
  page?: number;
  pageSize?: number;
}

/** PATCH /admin/users/:id — either field may be sent alone. */
export interface UpdateUserInput {
  banned?: boolean;
  role?: Role;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
export const AUTH_TOKEN_KEY = "scholar-e:auth-token";

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  google_email?: string | null;
};

type AuthResponse = {
  access_token: string;
  token_type: string;
  user: AuthUser;
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.detail || "Authentication request failed.");
  }
  return data as T;
}

export async function registerAccount(payload: {
  name: string;
  email: string;
  password: string;
}) {
  return request<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function loginAccount(payload: { email: string; password: string }) {
  return request<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchCurrentUser(token: string) {
  return request<AuthUser>("/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function googleStartUrl(token: string) {
  return `${API_BASE}/auth/google/start?token=${encodeURIComponent(token)}`;
}

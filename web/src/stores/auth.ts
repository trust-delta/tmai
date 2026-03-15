import { create } from "zustand";

interface AuthState {
  token: string;
  setToken: (token: string) => void;
}

/** Extract token from URL query param and strip it from the address bar */
function getTokenFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") ?? "";

  // Remove token from URL to prevent leaking via browser history / logs
  if (token) {
    params.delete("token");
    const clean =
      params.toString() === ""
        ? window.location.pathname
        : `${window.location.pathname}?${params}`;
    window.history.replaceState({}, "", clean);
  }

  return token;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: getTokenFromUrl(),
  setToken: (token) => set({ token }),
}));

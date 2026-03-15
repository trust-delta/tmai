import { create } from "zustand";

interface AuthState {
  token: string;
  setToken: (token: string) => void;
}

/** Extract token from URL query param on load */
function getTokenFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("token") ?? "";
}

export const useAuthStore = create<AuthState>((set) => ({
  token: getTokenFromUrl(),
  setToken: (token) => set({ token }),
}));

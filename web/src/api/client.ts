import { useAuthStore } from "../stores/auth";

/** Base fetch wrapper that injects Bearer token */
async function apiFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = useAuthStore.getState().token;
  const headers = new Headers(options.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(path, { ...options, headers });
}

/** GET /api/agents */
export async function fetchAgents() {
  const res = await apiFetch("/api/agents");
  if (!res.ok) throw new Error(`fetchAgents: ${res.status}`);
  return res.json();
}

/** POST /api/agents/{id}/approve */
export async function approveAgent(id: string) {
  const res = await apiFetch(`/api/agents/${encodeURIComponent(id)}/approve`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`approveAgent: ${res.status}`);
  return res.json();
}

/** POST /api/agents/{id}/select */
export async function selectChoice(id: string, choice: number) {
  const res = await apiFetch(`/api/agents/${encodeURIComponent(id)}/select`, {
    method: "POST",
    body: JSON.stringify({ choice }),
  });
  if (!res.ok) throw new Error(`selectChoice: ${res.status}`);
  return res.json();
}

/** POST /api/agents/{id}/submit */
export async function submitSelection(id: string, selectedChoices: number[]) {
  const res = await apiFetch(`/api/agents/${encodeURIComponent(id)}/submit`, {
    method: "POST",
    body: JSON.stringify({ selected_choices: selectedChoices }),
  });
  if (!res.ok) throw new Error(`submitSelection: ${res.status}`);
  return res.json();
}

/** POST /api/agents/{id}/input */
export async function sendText(id: string, text: string) {
  const res = await apiFetch(`/api/agents/${encodeURIComponent(id)}/input`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`sendText: ${res.status}`);
  return res.json();
}

/** POST /api/agents/{id}/key */
export async function sendKey(id: string, key: string) {
  const res = await apiFetch(`/api/agents/${encodeURIComponent(id)}/key`, {
    method: "POST",
    body: JSON.stringify({ key }),
  });
  if (!res.ok) throw new Error(`sendKey: ${res.status}`);
  return res.json();
}

/** GET /api/agents/{id}/preview */
export async function fetchPreview(id: string) {
  const res = await apiFetch(
    `/api/agents/${encodeURIComponent(id)}/preview`,
  );
  if (!res.ok) throw new Error(`fetchPreview: ${res.status}`);
  return res.json();
}

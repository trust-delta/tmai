import { useState } from "react";
import { sendText, sendKey } from "../../api/client";

interface InputBarProps {
  agentId: string;
}

export function InputBar({ agentId }: InputBarProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || sending) return;

    setSending(true);
    try {
      await sendText(agentId, text);
      setText("");
    } catch (err) {
      console.error("Failed to send text:", err);
    } finally {
      setSending(false);
    }
  }

  async function handleSpecialKey(key: string) {
    try {
      await sendKey(agentId, key);
    } catch (err) {
      console.error("Failed to send key:", err);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800"
    >
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Send text to agent..."
        disabled={sending}
        className="flex-1 rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-800 placeholder-neutral-400 focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder-neutral-600"
      />
      <button
        type="submit"
        disabled={sending || !text.trim()}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
      >
        Send
      </button>
      <button
        type="button"
        onClick={() => handleSpecialKey("Escape")}
        className="rounded-md border border-neutral-300 px-3 py-2 text-xs hover:bg-neutral-200 dark:border-neutral-700 dark:hover:bg-neutral-800"
        title="Send Escape key"
      >
        Esc
      </button>
    </form>
  );
}

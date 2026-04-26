interface Props {
  scheme: string;
  id: string;
}

export function AgentNotFound({ scheme, id }: Props) {
  const canonicalId = `${scheme}:${id}`;
  return (
    <div className="flex flex-1 items-center justify-center animate-fade-in">
      <div className="glass-light rounded-2xl px-8 py-8 text-center mx-4 max-w-md">
        <div className="text-4xl font-bold text-zinc-600 mb-3">404</div>
        <h2 className="text-base font-semibold text-zinc-300 mb-2">Agent not found</h2>
        <p className="text-xs font-mono text-zinc-500 break-all">{canonicalId}</p>
        <p className="mt-3 text-xs text-zinc-600">
          The agent may have ended or the id is no longer valid. Select an agent from the sidebar to
          continue.
        </p>
      </div>
    </div>
  );
}

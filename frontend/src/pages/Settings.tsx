import { Link } from 'react-router-dom';
import { errorMessage, API_BASE } from '../api/client';
import { useCapabilities } from '../api/hooks';
import { Alert, KVTable, Panel, Spinner } from '../components/ui';

export default function Settings() {
  const { data: caps, isLoading, error } = useCapabilities();

  return (
    <div className="min-h-full">
      <header
        className="flex items-center justify-between border-b px-5 py-3 backdrop-blur-md"
        style={{ background: 'var(--lab-panel)', borderColor: 'var(--lab-border)' }}
      >
        <div className="flex items-center gap-3">
          <Link to="/" className="font-display text-lg font-semibold tracking-wide text-slate-100 hover:text-sky-300">
            PartForge <span className="text-sky-400">AI</span>
          </Link>
          <span className="label-tech">Settings</span>
        </div>
        <Link to="/" className="label-tech transition-colors hover:text-sky-300">
          Dashboard
        </Link>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-5 py-6">
        <Panel title="Application">
          <KVTable
            rows={[
              ['API base path', API_BASE],
              ['App', caps?.app ?? '—'],
              ['Version', caps?.version ?? '—'],
              ['Environment', caps?.environment ?? '—'],
            ]}
          />
        </Panel>

        <Panel title="Server capabilities">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Spinner /> Loading capabilities…
            </div>
          )}
          {error != null && (
            <Alert kind="error" title="Failed to load capabilities">
              {errorMessage(error)}
            </Alert>
          )}
          {caps && (
            <pre className="overflow-x-auto rounded-md border border-slate-700/50 bg-slate-950/70 p-3 font-mono text-xs leading-relaxed text-slate-300">
              {JSON.stringify(caps, null, 2)}
            </pre>
          )}
        </Panel>
      </main>
    </div>
  );
}

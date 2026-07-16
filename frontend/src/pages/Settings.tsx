import { Link } from 'react-router-dom';
import { errorMessage, API_BASE } from '../api/client';
import { useCapabilities } from '../api/hooks';
import { Alert, KVTable, Panel, Spinner } from '../components/ui';

export default function Settings() {
  const { data: caps, isLoading, error } = useCapabilities();

  return (
    <div className="min-h-full">
      <header className="flex items-center justify-between border-b border-slate-700/70 bg-slate-800 px-5 py-3">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-lg font-bold text-sky-400 hover:text-sky-300">
            PartForge AI
          </Link>
          <span className="text-sm text-slate-400">Settings</span>
        </div>
        <Link to="/" className="text-sm text-slate-400 hover:text-sky-300">
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
            <pre className="overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-300">
              {JSON.stringify(caps, null, 2)}
            </pre>
          )}
        </Panel>
      </main>
    </div>
  );
}

import { legendGradient } from '../../lib/colormap';
import { fmt } from '../../lib/format';

export default function Legend({
  label,
  min,
  max,
  note,
}: {
  label: string;
  min: number;
  max: number;
  note?: string;
}) {
  return (
    <div className="lab-panel pointer-events-none px-3 py-2 text-xs text-slate-300">
      <div className="label-tech mb-1.5 !text-slate-300">{label}</div>
      <div
        className="h-2 w-48 rounded-sm"
        style={{ background: legendGradient(), boxShadow: '0 0 8px -2px rgba(35,213,255,0.3)' }}
      />
      <div className="mt-1 flex w-48 justify-between font-mono text-[10px] tabular-nums text-slate-400">
        <span>{fmt(min, 4)}</span>
        <span>{fmt(max, 4)}</span>
      </div>
      {note && <div className="mt-1 max-w-[200px] text-[10px] text-amber-300">{note}</div>}
    </div>
  );
}

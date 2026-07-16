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
    <div className="pointer-events-none rounded border border-slate-700 bg-slate-900/85 px-3 py-2 text-xs text-slate-300">
      <div className="mb-1 font-medium">{label}</div>
      <div className="h-2.5 w-48 rounded" style={{ background: legendGradient() }} />
      <div className="mt-0.5 flex w-48 justify-between font-mono text-[10px]">
        <span>{fmt(min, 4)}</span>
        <span>{fmt(max, 4)}</span>
      </div>
      {note && <div className="mt-1 max-w-[200px] text-[10px] text-amber-300">{note}</div>}
    </div>
  );
}

/**
 * Inline, render-blocking theme script to avoid a flash of the wrong theme.
 * Reads the persisted preference and applies `dark` on <html> before paint.
 */
export function ThemeScript() {
  const code = `(function(){try{var p=JSON.parse(localStorage.getItem('engtutor:prefs')||'{}');var t=p.theme||'system';var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

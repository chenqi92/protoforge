// Theme-first bootstrap: apply .dark class before any CSS arrives to avoid FOUC.
// This MUST be the first import in main.tsx so the dark-class is set before paint.
//
// CSP note (see src-tauri/tauri.conf.json app.security.csp):
// - script-src no longer allows 'unsafe-inline'/'unsafe-eval'; this module runs as a
//   normal bundled module instead of an inline <script>, so it complies.
// - script-src keeps 'wasm-unsafe-eval' for the EasyPlayer WASM decoder. Documented
//   fallback: if a target WebView rejects 'wasm-unsafe-eval', add 'unsafe-eval' back to
//   script-src only.
// - style-src 'unsafe-inline' is a retained accepted residual — runtime inline styles
//   are emitted by React / framer-motion and cannot be removed without a nonce/hash
//   pipeline the WebView does not support.
(function () {
  try {
    var raw = localStorage.getItem('protoforge-settings');
    var mode = 'system';
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.state && parsed.state.settings && parsed.state.settings.theme) {
        mode = parsed.state.settings.theme;
      }
    }
    var dark = mode === 'dark' || (mode === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) { /* Tracking Prevention may block localStorage */ }
})();

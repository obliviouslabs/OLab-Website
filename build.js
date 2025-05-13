require('esbuild').build({
  entryPoints: ['src/clienttdx.js'],
  bundle: true,
  format: 'iife',           // immediately‑invoked, attaches to window
  globalName: 'TDXLib',     // window.TDXLib.CheckBalance(), etc.
  outfile: 'assets/js/tdx-lib.js',
  minify: true,
}).catch(() => process.exit(1))
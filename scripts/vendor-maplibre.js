/**
 * Copies the CSP-safe MapLibre GL JS build from node_modules into the
 * `maplibregl` static resource. Run after bumping the maplibre-gl version:
 *
 *   npm install maplibre-gl@<version> --save-exact && npm run vendor:maplibre
 *
 * The CSP build loads its worker from a URL (set with maplibregl.setWorkerUrl)
 * instead of a Blob, which Lightning's Content Security Policy is stricter about.
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'maplibre-gl', 'dist');
const dest = path.join(__dirname, '..', 'force-app', 'main', 'default', 'staticresources', 'maplibregl');
const files = ['maplibre-gl-csp.js', 'maplibre-gl-csp-worker.js', 'maplibre-gl.css'];

fs.mkdirSync(dest, { recursive: true });
for (const file of files) {
  fs.copyFileSync(path.join(src, file), path.join(dest, file));
  console.log(`copied ${file}`);
}
const { version } = require('maplibre-gl/package.json');
fs.writeFileSync(path.join(dest, 'VERSION'), `${version}\n`);
console.log(`maplibre-gl ${version} vendored into ${path.relative(process.cwd(), dest)}`);

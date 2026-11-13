/**
 * Builds the static demo into demo-dist/ for Vercel or any static host.
 * Copies the component's shipmentGeo module so the demo uses the same code.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'demo-dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'vendor'), { recursive: true });

for (const file of ['index.html', 'styles.css', 'app.js', 'data.js', 'eta.js']) {
  fs.copyFileSync(path.join(root, 'demo', file), path.join(out, file));
}
fs.copyFileSync(
  path.join(root, 'force-app/main/default/lwc/shipmentGeo/shipmentGeo.js'),
  path.join(out, 'shipmentGeo.js')
);
const maplibre = path.join(root, 'node_modules/maplibre-gl/dist');
fs.copyFileSync(path.join(maplibre, 'maplibre-gl.js'), path.join(out, 'vendor/maplibre-gl.js'));
fs.copyFileSync(path.join(maplibre, 'maplibre-gl.css'), path.join(out, 'vendor/maplibre-gl.css'));
console.log(`Demo built in ${path.relative(root, out)}/`);

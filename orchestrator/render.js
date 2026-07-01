// CLI render: render the seed graph end-to-end from the terminal (no browser).
// First run renders all stale scenes; re-runs hit the cache (fast, ~$0).
//
// Run: npm run render
import './env.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from './pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const graph = JSON.parse(await fs.readFile(path.join(__dirname, 'graph', 'seed.json'), 'utf8'));

console.log(`Render "${graph.title}" (${graph.scenes.length} scenes)`);
const t0 = Date.now();
const result = await render(graph, (m) => console.log('  ' + m));
const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`\nDONE in ${secs}s`);
console.log('  file:', result.file);
console.log('  rendered scenes:', result.rendered.length ? result.rendered.join(', ') : '(all cached)');
if (result.skippedNarration.length) {
  console.log('  narration skipped:', result.skippedNarration.join(', '),
    '(set ELEVENLABS_VOICE_ID to a premade voice on free tier)');
}

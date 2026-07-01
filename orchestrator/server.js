// Cinemorph orchestrator — localhost server.
// Holds the live story graph, serves the player, routes /command (the only thing that spends money).

import './env.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { editGraph } from './providers/llm.js';
import { render } from './pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 4400;

const SEED_PATH = path.join(__dirname, 'graph', 'seed.json');

// In-memory live graph (single user). Loaded from seed on boot.
let graph = JSON.parse(await fs.readFile(SEED_PATH, 'utf8'));

const app = express();
app.use(express.json());

// Static front-end + generated output.
app.use('/', express.static(path.join(ROOT, 'web')));
app.use('/out', express.static(path.join(ROOT, 'out')));
app.use('/cache', express.static(path.join(ROOT, 'cache')));

// Current graph (for the UI / debugging).
app.get('/api/graph', (_req, res) => res.json(graph));

// The director's note: edit the graph, then re-render only the diff.
// This is the ONLY route that costs money.
app.post('/api/command', async (req, res) => {
  const note = (req.body?.note || '').trim();
  if (!note) return res.status(400).json({ error: 'empty note' });
  try {
    graph = await editGraph(graph, note);
    const result = await render(graph, (m) => console.log('[render]', m));
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// First/full render (no edit) — used to produce the initial cut.
app.post('/api/render', async (_req, res) => {
  try {
    const result = await render(graph, (m) => console.log('[render]', m));
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`Cinemorph orchestrator on http://localhost:${PORT}`);
});

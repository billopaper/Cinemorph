// Brain — headless Claude Code (uses your existing Claude login, no API key).
//
// Spawns the `claude` CLI in headless mode (`claude -p`), feeding it the brain
// prompt on stdin and reading back the edited graph. The model only edits
// text/JSON — it never touches media.
//
// Set CLAUDE_BIN in .env to override the binary (default: "claude" on PATH).

import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBrainPrompt } from '../prompts/brain.js';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Available music tracks (repo-relative paths) the brain may set as graph.music. */
function listMusicTracks() {
  try {
    return readdirSync(path.join(ROOT, 'assets', 'songs'))
      .filter((f) => f.toLowerCase().endsWith('.mp3'))
      .map((f) => `assets/songs/${f}`);
  } catch {
    return [];
  }
}

/**
 * @param {object} graph - current story graph
 * @param {string} note  - user's natural-language change ("make the ending darker")
 * @returns {Promise<object>} edited story graph (same shape as input)
 */
export async function editGraph(graph, note) {
  const prompt = buildBrainPrompt(graph, note, { musicTracks: listMusicTracks() });
  const raw = await runClaude(prompt);
  const edited = extractGraph(raw);
  return reconcile(edited, graph);
}

/** Spawn `claude -p`, write the prompt on stdin, resolve with stdout. */
function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    // shell:true (so claude.cmd resolves on Windows) with a single command
    // string — avoids DEP0190 (args array + shell). Prompt goes via stdin,
    // so no user input is ever interpolated into the command.
    const child = spawn(`"${CLAUDE_BIN}" -p --output-format json`, {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.trim()}`));
      resolve(out);
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * Pull the graph JSON out of the CLI response. `--output-format json` wraps the
 * model's answer in an envelope ({ result: "<text>", ... }); the answer itself
 * should be the graph, possibly fenced. Be tolerant of both.
 */
function extractGraph(raw) {
  let text = raw;
  try {
    const env = JSON.parse(raw);
    if (env && typeof env.result === 'string') text = env.result;
  } catch {
    // not an envelope — treat raw stdout as the answer
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error(`brain returned no JSON object: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Defensive guard: validate shape and re-attach the pipeline-owned `render`
 * blocks from the original graph (the brain must not manage render state).
 * New scenes the brain added simply have no render block → treated as stale.
 */
function reconcile(edited, original) {
  if (!edited || typeof edited !== 'object' || !Array.isArray(edited.scenes) || !edited.style) {
    throw new Error('brain returned a malformed graph (missing scenes/style)');
  }
  const origById = new Map(original.scenes.map((s) => [s.id, s]));
  for (const scene of edited.scenes) {
    const orig = origById.get(scene.id);
    scene.render = (orig && orig.render) || { clip_hash: null, status: 'stale', file: null };
  }
  return edited;
}

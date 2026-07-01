// Pipeline: diff graph -> regenerate only stale scenes -> assemble MP4.
//
//   markStale(graph) -> for each stale scene: keyframe image -> video clip (cached by hash)
//   for each narration cue: TTS line (cached by text hash, best-effort)
//   assemble: concat clips + place narration at scene offsets + duck music + credits

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sceneHash, narrationHash, characterHash, referencedCharacters,
  composeKeyframePrompt, composeClipPrompt,
} from './graph.js';
import * as runway from './providers/runway.js';
import * as tts from './providers/tts.js';
import { assemble } from './assemble.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, 'cache');
const DIRS = {
  images: path.join(CACHE, 'images'),
  clips: path.join(CACHE, 'clips'),
  chars: path.join(CACHE, 'chars'),
  narration: path.join(CACHE, 'narration'),
  out: path.join(ROOT, 'out'),
};

/** Stable per-scene seed derived from its content hash (deterministic re-renders). */
function seedFromHash(hash) {
  return parseInt(hash.slice(0, 8), 16);
}

/**
 * Render the current graph to an MP4, regenerating only what's stale.
 * Content-addressed: a clip/keyframe/narration whose hash already exists on disk
 * is reused for free (this is also how "revert to a previous cut" costs $0).
 *
 * @param {object} graph
 * @param {(msg: string) => void} [log]
 * @returns {Promise<{ file: string, rendered: string[], skippedNarration: string[] }>}
 */
export async function render(graph, log = () => {}) {
  await Promise.all(Object.values(DIRS).map((d) => mkdir(d, { recursive: true })));

  // --- 0. character sheets: derived from each character's description (+seed),
  //        cached by characterHash. Reused as a tagged reference for every shot
  //        that @-references the character. Only build sheets that are used. ---
  const usedTags = new Set(
    graph.scenes.flatMap((s) => referencedCharacters(s, graph.characters).map((c) => c.id)),
  );
  const sheetPathByTag = {};
  for (const c of graph.characters) {
    if (!usedTags.has(c.id)) continue;
    const sheetPath = path.join(DIRS.chars, `${characterHash(c)}.png`);
    if (!existsSync(sheetPath)) {
      log(`character @${c.id}: sheet…`);
      await runway.generateCharacterSheet({
        description: c.description, style: graph.style.look, seed: c.seed, outPath: sheetPath, log,
      });
    } else {
      log(`character @${c.id}: sheet cache hit`);
    }
    sheetPathByTag[c.id] = sheetPath;
  }

  // --- 1. scenes: render stale clips (keyframe -> video), reuse cache otherwise ---
  const rendered = [];
  for (const scene of graph.scenes) {
    const hash = sceneHash(scene, graph.style, graph.characters);
    const clipPath = path.join(DIRS.clips, `${hash}.mp4`);
    const imagePath = path.join(DIRS.images, `${hash}.png`);

    if (existsSync(clipPath)) {
      scene.render = { clip_hash: hash, status: 'fresh', file: clipPath };
      log(`scene ${scene.id}: cache hit (${hash})`);
      continue;
    }

    // Tagged reference images for the characters this scene @-references.
    const cast = referencedCharacters(scene, graph.characters);
    const referenceImages = [];
    for (const c of cast) {
      referenceImages.push({ uri: await runway.imageToDataUri(sheetPathByTag[c.id]), tag: c.id });
    }

    const seed = seedFromHash(hash);
    log(`scene ${scene.id}: keyframe…${cast.length ? ` (@${cast.map((c) => c.id).join(', @')})` : ''}`);
    await runway.generateKeyframe({
      prompt: composeKeyframePrompt(scene, graph.style), seed, referenceImages, outPath: imagePath, log,
    });
    log(`scene ${scene.id}: animate (${scene.duration}s)…`);
    await runway.generateClip({
      imagePath, prompt: composeClipPrompt(scene),
      duration: scene.duration, seed, outPath: clipPath, log,
    });
    scene.render = { clip_hash: hash, status: 'fresh', file: clipPath };
    rendered.push(scene.id);
  }

  // --- 2. narration: TTS each cue (cached by text). Best-effort: a failure
  //        (e.g. free-tier library-voice 402) skips that line, never fatal. ---
  const narrationFiles = {};
  const skippedNarration = [];
  for (const cue of graph.narration) {
    const nHash = narrationHash(cue);
    const outPath = path.join(DIRS.narration, `${nHash}.mp3`);
    if (existsSync(outPath)) {
      narrationFiles[cue.at] = outPath;
      continue;
    }
    try {
      await tts.synthesizeLine({ text: cue.text, outPath });
      narrationFiles[cue.at] = outPath;
      log(`narration ${cue.at}: synthesized`);
    } catch (err) {
      skippedNarration.push(cue.at);
      log(`narration ${cue.at}: SKIPPED (${String(err.message).split('\n')[0]})`);
    }
  }

  // --- 3. assemble: clips in order, narration at cumulative scene offsets ---
  const clips = graph.scenes.map((s) => ({ file: s.render.file, duration: s.duration }));
  const startOf = {};
  let acc = 0;
  for (const s of graph.scenes) { startOf[s.id] = acc; acc += s.duration; }
  const narration = graph.narration
    .filter((c) => narrationFiles[c.at])
    .map((c) => ({ file: narrationFiles[c.at], startSec: startOf[c.at] ?? 0 }));

  const outFile = path.join(DIRS.out, 'movie.mp4');
  const creditsImage = path.join(ROOT, 'assets', 'credits.png');
  await assemble({
    clips,
    narration,
    musicFile: path.resolve(ROOT, graph.music),
    creditsImage: existsSync(creditsImage) ? creditsImage : null,
    outFile,
    log,
  });

  log(`done -> ${outFile}`);
  return { file: '/out/movie.mp4', rendered, skippedNarration };
}

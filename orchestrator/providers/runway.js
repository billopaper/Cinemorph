// Runway provider — Gen-4 Image (keyframe) + Gen-4 Turbo (image->video).
//
// IMPORTANT: requires pay-as-you-go API credits (RUNWAY_API_KEY), NOT a web subscription.
// Docs: https://docs.dev.runwayml.com/
//
// Async, poll-based: POST a task -> poll /v1/tasks/{id} -> SUCCEEDED returns hosted
// output URLs (ephemeral) -> we download the bytes to the content-addressed cache.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API_KEY = process.env.RUNWAY_API_KEY;
const BASE = 'https://api.dev.runwayml.com';
const VERSION = process.env.RUNWAY_VERSION || '2024-11-06';
const IMAGE_MODEL = process.env.RUNWAY_IMAGE_MODEL || 'gen4_image';
const VIDEO_MODEL = process.env.RUNWAY_VIDEO_MODEL || 'gen4_turbo';
const RATIO = process.env.RUNWAY_RATIO || '1280:720';

function headers() {
  if (!API_KEY) {
    throw new Error('RUNWAY_API_KEY is not set. Add it to .env (pay-as-you-go API credits).');
  }
  return {
    Authorization: `Bearer ${API_KEY}`,
    'X-Runway-Version': VERSION,
    'Content-Type': 'application/json',
  };
}

/** Retry a network op on transient errors (connection resets, timeouts) with backoff. */
async function withRetry(fn) {
  const attempts = 4;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const msg = String(err?.cause?.code || err?.cause?.message || err?.message || err);
      const transient =
        /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|terminated|fetch failed|socket hang up|UND_ERR/i.test(msg);
      if (!transient || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

async function postTask(endpoint, body) {
  return withRetry(async () => {
    const res = await fetch(`${BASE}${endpoint}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Runway ${endpoint} failed (${res.status}): ${detail}`);
    }
    return (await res.json()).id;
  });
}

async function pollTask(id, { log = () => {}, label = 'task' } = {}) {
  for (let i = 0; i < 180; i++) {
    const task = await withRetry(async () => {
      const res = await fetch(`${BASE}/v1/tasks/${id}`, { headers: headers() });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Runway poll failed (${res.status}): ${detail}`);
      }
      return res.json();
    });
    if (task.status === 'SUCCEEDED') return task.output;
    if (task.status === 'FAILED' || task.status === 'CANCELLED') {
      throw new Error(`Runway ${label} ${task.status}: ${JSON.stringify(task.failure ?? task)}`);
    }
    if (i % 4 === 0) log(`${label}: ${task.status}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`Runway ${label}: timed out`);
}

async function download(url, outPath) {
  await withRetry(async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed (${res.status}) for ${url}`);
    await writeFile(outPath, Buffer.from(await res.arrayBuffer()));
  });
  return outPath;
}

/** Base64 data URI for a local image (used for keyframes + reference images). */
export async function imageToDataUri(imagePath) {
  const bytes = await readFile(imagePath);
  const ext = path.extname(imagePath).slice(1) || 'png';
  return `data:image/${ext};base64,${bytes.toString('base64')}`;
}

/**
 * Generate a keyframe image (the controlled first frame) from text.
 * `referenceImages` ([{ uri, tag }]) drive character consistency — the prompt
 * references a tag with @tag (Runway Gen-4 reference images).
 * @param {object} opts - { prompt, seed, referenceImages, outPath, log }
 * @returns {Promise<string>} path to the written PNG
 */
export async function generateKeyframe({ prompt, seed, referenceImages, outPath, log }) {
  const body = { promptText: prompt.slice(0, 1000), model: IMAGE_MODEL, ratio: RATIO };
  if (Number.isFinite(seed)) body.seed = seed;
  if (referenceImages?.length) body.referenceImages = referenceImages;
  const id = await postTask('/v1/text_to_image', body);
  const [url] = await pollTask(id, { log, label: 'keyframe' });
  return download(url, outPath);
}

/**
 * Generate a character reference "sheet" from a text description (no references).
 * Cached by the pipeline; reused as a tagged reference for every shot of the character.
 * @param {object} opts - { description, style, seed, outPath, log }
 * @returns {Promise<string>} path to the written PNG
 */
export async function generateCharacterSheet({ description, style, seed, outPath, log }) {
  const prompt =
    `${description}. Character reference portrait, head and shoulders, facing camera, ` +
    `neutral studio background, sharp focus, photorealistic. ${style || ''}`.trim();
  return generateKeyframe({ prompt, seed, outPath, log });
}

/**
 * Animate a keyframe image into a clip. The image is sent as a data URI so it
 * works from the cache without relying on Runway's ephemeral URLs.
 * @param {object} opts - { imagePath, prompt, motion, duration (5|10), seed, model, outPath, log }
 * @returns {Promise<string>} path to the written MP4
 */
export async function generateClip({ imagePath, prompt, motion, duration, seed, model, outPath, log }) {
  const dataUri = await imageToDataUri(imagePath);
  const body = {
    promptImage: dataUri,
    promptText: `${prompt}${motion ? `, ${motion}` : ''}`.slice(0, 1000),
    model: model || VIDEO_MODEL,
    ratio: RATIO,
    duration: duration === 10 ? 10 : 5,
  };
  if (Number.isFinite(seed)) body.seed = seed;
  const id = await postTask('/v1/image_to_video', body);
  const [url] = await pollTask(id, { log, label: 'video' });
  return download(url, outPath);
}

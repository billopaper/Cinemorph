// TTS provider — ElevenLabs (one fixed narrator voice for the whole film).
// Docs: https://elevenlabs.io/docs

import { writeFile } from 'node:fs/promises';

const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID;

// Model for the whole film. multilingual_v2 is the quality default and honors
// the voice_settings below (incl. `speed`). Override via .env if desired.
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';

// One fixed delivery for the narrator. Tuned for slow, weighty trailer VO:
//   speed 0.8       -> slower, more deliberate pacing (1.0 = normal, range ~0.7–1.2)
//   stability 0.45  -> expressive but not wandering across the 3 lines
//   style 0.15      -> a touch of character without hurting consistency
// Each is overridable from .env so the spike can be tuned without code edits.
const VOICE_SETTINGS = {
  stability: numEnv('ELEVENLABS_STABILITY', 0.45),
  similarity_boost: numEnv('ELEVENLABS_SIMILARITY', 0.75),
  style: numEnv('ELEVENLABS_STYLE', 0.15),
  use_speaker_boost: true,
  speed: numEnv('ELEVENLABS_SPEED', 0.8),
};

function numEnv(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function requireConfig() {
  if (!API_KEY) throw new Error('ELEVENLABS_API_KEY is not set (.env).');
  if (!VOICE_ID) throw new Error('ELEVENLABS_VOICE_ID is not set (.env).');
}

/**
 * Synthesize one narration line to an MP3.
 * Keyed by the line text so a text-only edit costs one TTS call and zero video spend.
 * @param {object} opts - { text, outPath }
 * @returns {Promise<string>} path to the written MP3
 */
export async function synthesizeLine(opts) {
  requireConfig();
  const { text, outPath } = opts;
  if (!text) throw new Error('tts.synthesizeLine: opts.text is required.');
  if (!outPath) throw new Error('tts.synthesizeLine: opts.outPath is required.');

  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}` +
    `?output_format=mp3_44100_128`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: VOICE_SETTINGS,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${detail}`);
  }

  const audio = Buffer.from(await res.arrayBuffer());
  await writeFile(outPath, audio);
  return outPath;
}

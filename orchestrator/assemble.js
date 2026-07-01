// FFmpeg assembly: scene clips + narration cues + ducked music -> one MP4.
//
//   [clips in order]            --scale/fps/concat-->  silent video  ─┐
//   [narration @ scene offsets] --adelay------------>                 ┼─ amix ─▶ movie.mp4
//   [music, looped, low volume] -------------------->                 ┘   (+ black credits tail)
//
// Inputs are explicit (not the graph) so this stays pure and testable.

import { spawn } from 'node:child_process';

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const W = 1280;
const H = 720;
const FPS = 24;

/** Run ffmpeg with args; resolve on exit 0, reject with tail of stderr otherwise. */
export function ffmpeg(args, { log = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG_BIN, ['-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => {
      err += d;
      if (err.length > 8000) err = err.slice(-8000);
    });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) return resolve();
      log(err.trim().split('\n').slice(-6).join('\n'));
      reject(new Error(`ffmpeg exited ${code}`));
    });
  });
}

/**
 * @param {object} opts
 *   clips:        [{ file, duration }]   scene clips, in order
 *   narration:    [{ file, startSec }]   placed at absolute offsets
 *   musicFile:    string                 looped + ducked under the whole thing
 *   outFile:      string                 destination MP4
 *   creditsSec:   number                 black tail length (default 5)
 *   musicVolume:  number                 0..1 (default 0.2)
 *   log:          (msg) => void
 * @returns {Promise<string>} outFile
 */
export async function assemble({
  clips,
  narration = [],
  musicFile,
  outFile,
  creditsSec = 5,
  creditsImage = null,
  musicVolume = 0.35,
  log = () => {},
}) {
  if (!clips?.length) throw new Error('assemble: no clips');

  const movieSec = clips.reduce((s, c) => s + c.duration, 0);
  const totalSec = movieSec + creditsSec;

  const inputs = [];
  const filters = [];

  // --- video: normalize each clip, then a credits tail (image if provided, else black) ---
  clips.forEach((c, i) => {
    inputs.push('-i', c.file);
    filters.push(`[${i}:v]scale=${W}:${H},setsar=1,fps=${FPS},format=yuv420p[v${i}]`);
  });
  if (creditsImage) {
    inputs.push('-loop', '1', '-t', String(creditsSec), '-i', creditsImage);
    filters.push(
      `[${clips.length}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p[vcredits]`,
    );
  } else {
    filters.push(`color=c=black:s=${W}x${H}:r=${FPS}:d=${creditsSec},format=yuv420p[vcredits]`);
  }
  const vChain = clips.map((_, i) => `[v${i}]`).join('') + '[vcredits]';
  filters.push(`${vChain}concat=n=${clips.length + 1}:v=1:a=0[vout]`);

  // --- audio: narration inputs, then looped music. Indices come after the clip
  //     inputs plus the optional credits-image input. ---
  const afterVideo = clips.length + (creditsImage ? 1 : 0);
  const narrLabels = [];
  narration.forEach((n, j) => {
    const idx = afterVideo + j;
    inputs.push('-i', n.file);
    const ms = Math.max(0, Math.round(n.startSec * 1000));
    filters.push(`[${idx}:a]adelay=${ms}|${ms}[n${j}]`);
    narrLabels.push(`[n${j}]`);
  });

  const musicIdx = afterVideo + narration.length;
  inputs.push('-stream_loop', '-1', '-i', musicFile);
  filters.push(`[${musicIdx}:a]volume=${musicVolume}[mus]`);

  if (narrLabels.length) {
    filters.push(
      `[mus]${narrLabels.join('')}amix=inputs=${narrLabels.length + 1}:` +
        `duration=longest:dropout_transition=0:normalize=0[aout]`,
    );
  } else {
    filters.push(`[mus]anull[aout]`);
  }

  const args = [
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', '[vout]',
    '-map', '[aout]',
    '-t', String(totalSec),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    outFile,
  ];

  log(`assemble: ${clips.length} clips (${movieSec}s) + ${narration.length} narration + music, +${creditsSec}s credits -> ${totalSec}s`);
  await ffmpeg(args, { log });
  return outFile;
}

// Story-graph helpers: content-addressed hashing + diff.
// This is the heart of incremental re-render — only stale scenes get regenerated.

import { createHash } from 'node:crypto';

const sha16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** Tags (@name) referenced in a piece of text. */
export function referencedTags(text) {
  const tags = new Set();
  for (const m of String(text || '').matchAll(/@([A-Za-z0-9]+)/g)) tags.add(m[1]);
  return [...tags];
}

/** All authored text of a scene (the fields a director writes). */
function sceneText(scene) {
  return [scene.prompt, scene.motion, scene.camera, scene.light].filter(Boolean).join(' ');
}

/** Characters a scene @-references (by id). Drives which reference sheets it needs. */
export function referencedCharacters(scene, characters) {
  const tags = new Set(referencedTags(sceneText(scene)));
  return characters.filter((c) => tags.has(c.id));
}

/**
 * Hash a character. Keys its reference "sheet" — edit the description (or seed)
 * and the sheet (and every scene that @-references the character) invalidates.
 */
export function characterHash(character) {
  return sha16(JSON.stringify({ description: character.description, seed: character.seed }));
}

/**
 * Hash everything that affects a scene's rendered video: its authored fields
 * (prompt/motion/camera/light), duration, the global style, and the referenced
 * characters (via characterHash, so a character edit invalidates exactly the
 * scenes that use it).
 */
export function sceneHash(scene, style, characters) {
  const cast = referencedCharacters(scene, characters).map((c) => ({
    id: c.id,
    hash: characterHash(c),
  }));
  const material = JSON.stringify({
    prompt: scene.prompt,
    motion: scene.motion,
    camera: scene.camera,
    light: scene.light,
    duration: scene.duration,
    style,
    cast,
  });
  return sha16(material);
}

/** Strip @ tag markers for prompts sent to endpoints that don't use references (image->video). */
export function stripTags(text) {
  return String(text || '').replace(/@([A-Za-z0-9]+)/g, '$1');
}

/**
 * Keyframe (still, text->image) prompt: opening-frame composition + lighting +
 * global look. Keeps @tags so Runway applies the character reference.
 */
export function composeKeyframePrompt(scene, style) {
  return [scene.prompt, scene.light, `${style.look}, ${style.palette}`]
    .filter(Boolean)
    .join('. ');
}

/**
 * Clip (image->video) prompt: the moment unfolding — subject, then subject/
 * environment motion, then camera movement, then light behavior. @tags stripped
 * (video has no references; the keyframe already carries the character).
 */
export function composeClipPrompt(scene) {
  return stripTags(
    [scene.prompt, scene.motion, scene.camera, scene.light].filter(Boolean).join('. '),
  );
}

/** Hash a narration cue (keyed by text — text-only edits cost one TTS call, zero video). */
export function narrationHash(cue) {
  return createHash('sha256').update(cue.text).digest('hex').slice(0, 16);
}

/**
 * Mark scenes stale where the freshly computed hash differs from the stored clip_hash.
 * Returns the list of stale scene ids (what the pipeline will re-render).
 */
export function markStale(graph) {
  const stale = [];
  for (const scene of graph.scenes) {
    const h = sceneHash(scene, graph.style, graph.characters);
    scene.render = scene.render || { clip_hash: null, status: 'stale', file: null };
    if (scene.render.clip_hash !== h || !scene.render.file) {
      scene.render.status = 'stale';
      scene.render.next_hash = h;
      stale.push(scene.id);
    } else {
      scene.render.status = 'fresh';
    }
  }
  return stale;
}

/** Compare two graphs and report which scenes/narration changed. */
export function diff(prev, next) {
  const changedScenes = [];
  for (const ns of next.scenes) {
    const ps = prev.scenes.find((s) => s.id === ns.id);
    const a = ps && sceneHash(ps, prev.style, prev.characters);
    const b = sceneHash(ns, next.style, next.characters);
    if (a !== b) changedScenes.push(ns.id);
  }
  const changedNarration = [];
  for (const nc of next.narration) {
    const pc = prev.narration.find((c) => c.at === nc.at);
    if (!pc || narrationHash(pc) !== narrationHash(nc)) changedNarration.push(nc.at);
  }
  return { changedScenes, changedNarration };
}

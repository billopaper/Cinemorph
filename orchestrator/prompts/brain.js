// The instruction given to the brain (headless Claude Code) on every edit.
// Goal: translate the user's note into the SMALLEST valid graph diff.

const WORD_BUDGET_PER_5S = 12; // ~2.5 words/sec; keep narration in sync without timing logic

export function buildBrainPrompt(graph, note, { musicTracks = [] } = {}) {
  return [
    'You are the editor of a short cinematic trailer described by a JSON "story graph".',
    'You will receive the current graph and a director\'s note. Return ONLY the edited graph as JSON.',
    '',
    'Each scene has four authored fields — edit only the one(s) the note implies:',
    '  - "prompt": the opening frame (subject, setting, composition).',
    '  - "motion": what MOVES over the shot (subject micro-motions + environment).',
    '  - "camera": the single continuous camera move (cinematographic language).',
    '  - "light": lighting behavior.',
    'So "make it darker" edits only "light"; "hold the shot" edits only "camera".',
    '',
    'Rules:',
    '- Make the SMALLEST change that satisfies the note. Touch as few scenes/fields as possible.',
    '- Do NOT rewrite scenes or fields the note does not mention. Leave them byte-for-byte identical.',
    '- ONE continuous shot per scene: never describe a cut, "then", or a second shot within a scene.',
    '- Good motion has three layers moving at once: foreground, subject, and camera. Use vivid verbs,',
    '  small human imperfections (breathing, blinking, shifting weight), and dynamic light.',
    '- Reference recurring subjects by their @id (e.g. @hero) instead of re-describing them; keep entity',
    '  ids, descriptions, and seeds stable unless the note explicitly asks to change them.',
    '- NARRATION: to change the narration, rewrite the "text" of the relevant cue(s) in the',
    `  "narration" array. Keep each cue's "at" anchor, keep it punchy/trailer-like, under ~${WORD_BUDGET_PER_5S} words`,
    '  for a 5s scene. Do not orphan a cue or add cues anchored to non-existent scene ids.',
    '- MUSIC: to change the music, set the top-level "music" to one of the AVAILABLE MUSIC TRACKS',
    '  listed below, using its exact path. Never invent a music path or keep a path not in the list.',
    '- duration must be 5 or 10.',
    '- Do not invent new top-level keys. Preserve the exact schema.',
    '- Do not touch any "render" objects — the pipeline manages those.',
    '',
    'AVAILABLE MUSIC TRACKS (use one of these exact paths for "music"):',
    musicTracks.length ? musicTracks.map((t) => `  - ${t}`).join('\n') : '  (none found)',
    '',
    `DIRECTOR'S NOTE: ${note}`,
    '',
    'CURRENT GRAPH:',
    JSON.stringify(graph, null, 2),
    '',
    'Return the full edited graph as JSON and nothing else.',
  ].join('\n');
}

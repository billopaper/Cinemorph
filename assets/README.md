# assets/

Tracked media the film depends on.

- **`songs/`** — royalty-free music beds (`*.mp3`). The graph's `"music"` field points at one
  (e.g. `assets/songs/original.mp3`). The audio files themselves are **gitignored** (keep the
  folder, not the tracks); drop your own in here. Sources: Pixabay Music, YouTube Audio Library.
- **`credits.png`** — the end-credits card appended after the last scene. Any aspect ratio works
  (it's letterboxed to 16:9). Remove it and the assembler falls back to a plain black tail.

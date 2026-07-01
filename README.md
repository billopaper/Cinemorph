# Cinemorph - feedback loop based video generation

*BilloPaper #02*

A director-in-the-loop film generator prototype. You watch a short AI-generated film, and when the
credits roll you type an instruction like "make the hero a robot". It re-renders only the scenes that
change, then plays the new cut. Single-user, runs on localhost.

## ❓ Question

We've all complained about a film or show: the story fell flat, a twist annoyed us, an actor felt
miscast. Usually we like *most* of it, and just a few decisions spoil it. Which leads to a thought,
if I could have chosen how a specific act played out, I'd have my perfect series. My perfect show. If
only I could alter it.

So: how could that actually be done?

## ⚡ Short Answer

Yes, it can be done and the trick is to stop treating the film as "a video" consisting of different frames  and treat it as an editable **script**.
Everything derives from one JSON **story graph**. Every scene is **content-addressed** by a hash of its inputs, so
the pipeline regenerates only the scenes whose hash changed and reuses the rest from a local cache.

- Full ~35s film: **~$2**, ~6 min (six Runway clips).
- Single-scene tweak: **~$0.27**, ~1 min.
- Music swap, narration rewrite, or rewatch: **~$0** (no video regenerates).

The mental model is object-oriented programming. The screenplay defines the world and the characters
once; each scene *references* them instead of re-describing them, and the film is assembled from
those references. Swap a single object like change the `hero`, and every shot that references it
updates, and nothing else does.

## 🔧 Setup

**The artifact.** One `seed.json` story graph is the source of truth. Each scene has four authored
fields so edits stay surgical:

| Field | What it is |
|---|---|
| `prompt` | the opening frame (subject, setting, composition) |
| `motion` | what moves over the 5s (subject + environment) |
| `camera` | the single continuous camera move |
| `light` | lighting behavior |

Plus global `style`, a `characters` list (id + description + locked seed), sparse `narration` cues
anchored to scene ids, and a `music` path. *"Make it darker"* touches only a scene's `light`;
*"hold the shot"* only its `camera`.

**Incremental render (the core idea).** `sceneHash` = hash of `{prompt, motion, camera, light,
style, referenced-characters}`. On an edit, only scenes whose hash changed are stale; unchanged
scenes are served from a content-addressed cache. Narration is hashed by text (a text edit = one TTS
call, zero video), and characters by `{description, seed}`, so editing a character invalidates
exactly the scenes that `@`-reference it. Reverting an edit re-hits the old cache for free.

**Consistency.** Keyframe-first: generate a still, then animate it. A character's "sheet" is
generated once from its description and passed as a tagged reference image on every shot that says
`@hero`, so the same face recurs across shots and re-renders.

**Stack.**

| Role | Tool |
|---|---|
| Brain (edits the story graph) | Headless **Claude Code** (uses your login, no API key) |
| Keyframe images + video | **Runway** Gen-4 Image + Gen-4 Turbo (image→video) |
| Narration voice | **ElevenLabs** (3 sparse cues, one premade voice) |
| Music bed | a static royalty-free MP3 |
| Assembly | **FFmpeg** (clips + narration at scene offsets + ducked music + credits tail) |
| Orchestrator | **Node** / Express on localhost |
| Front-end | plain HTML/JS `<video>` player + a live input field |

**Prerequisites.** Node ≥ 20, FFmpeg (with `ffprobe`) on PATH, a Runway API key (pay-as-you-go
credits, *not* a web subscription), an ElevenLabs key + a **premade** voice id, and a music bed in `assets/songs/`.

```powershell
winget install OpenJS.NodeJS.LTS
winget install Gyan.FFmpeg
```

## 🧪 Implementation

```bash
cp .env.example .env      # fill in RUNWAY_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID
cd orchestrator && npm install

npm start                 # the browser loop at http://localhost:4400
npm run render            # or render the whole film from the CLI, no browser
```

The loop: **watch → credits (input goes live) → Rewatch (free) | type a change → regenerate → new
cut.** The only thing that spends money is submitting a note.

```
web/            <video> player + live input + Rewatch (index.html, app.js)
orchestrator/
  server.js     localhost server; holds the live graph; routes /api/command + /api/render
  render.js     CLI entry: render the seed graph without the browser
  pipeline.js   diff graph -> render stale scenes -> TTS -> assemble
  graph.js      content-addressed hashing + diff + prompt composition
  assemble.js   FFmpeg assembly (clips + narration + music + credits tail)
  providers/    runway.js, tts.js, llm.js (swappable)
  prompts/      brain.js (the "smallest diff" editor instruction)
  graph/        seed.json (the story graph)
assets/         songs/ (music, gitignored) + credits.png
cache/          content-addressed clips / images / chars / narration (gitignored)
out/            movie.mp4 (gitignored)
```

## 📊 Résumé

- **The biggest quality lever was free.** Going from "AI-looking" to "cinematic" came mostly from
  detailed prompts with explicit description of movement. I could have invested far more time
  polishing the film, but that wasn't the point; the editing loop was. 
- **Content-addressing is what makes iteration affordable.** Most edits touch one clip; rewatch and
  revert are free. The economics only work because unchanged scenes are never re-rendered.
- **Video generation is too random.** Editing a small detail often triggers a complete
  reinterpretation of the whole scene, a tiny prompt change can produce a very different image, not a
  small delta. With today's prompt-based video models that seems unavoidable.
- **References are limited.** This prototype referenced only one static object, the `@hero`. Runway
  caps reference images at ~3 per generation, so scenes with many recurring elements (several
  characters, props, locations) would need a better solution than one reference per element.
- **You need to own the film.** You can only reshape a film you control end-to-end.
  So the prototype generates the short, then lets you rewrite it. Editing someone else's finished film
  is a much harder problem left for another day.

**Still, the idea excites me.** Strip away the rough edges and this is a real interactive,
director-in-the-loop experience, you don't just watch a story, you steer it. The render wait is the
obvious friction, but that dead time is exactly where something could live: a recap, a "what happens
next?" teaser, or, sure, an ad (not that I'm a fan). The version I actually want: a whole series
built on a graph like this one, where at the end of each episode you nudge the direction, recast a
character, drop a subplot, darken the tone, and the next episode renders around your choices. Your
show, not theirs.
// Cinemorph front-end loop: WATCH -> CREDITS (input live) -> Rewatch (free) | Reshape (regenerate).

const player = document.getElementById('player');
const overlay = document.getElementById('overlay');
const note = document.getElementById('note');
const submit = document.getElementById('submit');
const rewatch = document.getElementById('rewatch');
const statusEl = document.getElementById('status');

let currentSrc = null;

function setStatus(s) { statusEl.textContent = s; }

// Show the overlay slightly before the end so the input is "live during the credits".
player.addEventListener('timeupdate', () => {
  if (!player.duration) return;
  const remaining = player.duration - player.currentTime;
  if (remaining < 6) overlay.classList.add('show');
});
player.addEventListener('play', () => overlay.classList.remove('show'));

async function play(src) {
  currentSrc = src;
  player.src = src;
  overlay.classList.remove('show');
  player.muted = false;
  setStatus('watching');
  try {
    await player.play();
  } catch {
    // Browsers block autoplay of videos WITH sound. Fall back to muted autoplay
    // (always allowed) and let the user unmute with a click or the controls.
    player.muted = true;
    try {
      await player.play();
      setStatus('playing muted — click the video to unmute');
    } catch {
      setStatus('press play ▶ to watch');
    }
  }
}

// A user gesture lets us restore sound.
player.addEventListener('click', () => {
  if (player.muted) {
    player.muted = false;
    setStatus('watching');
  }
});

// Rewatch is free + instant — replay the cached MP4, no API calls.
rewatch.addEventListener('click', () => { if (currentSrc) play(currentSrc); });

// Reshape — the only action that spends money.
submit.addEventListener('click', async () => {
  const text = note.value.trim();
  if (!text) return;
  submit.disabled = true;
  setStatus('reshaping…');
  try {
    const res = await fetch('/api/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'render failed');
    note.value = '';
    play(`${data.file}?t=${Date.now()}`); // cache-bust the new cut
  } catch (err) {
    setStatus(`error: ${err.message}`);
  } finally {
    submit.disabled = false;
  }
});

// Boot: render (or replay) the initial cut.
(async () => {
  setStatus('rendering initial cut…');
  try {
    const res = await fetch('/api/render', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'render failed');
    play(data.file);
  } catch (err) {
    setStatus(`error: ${err.message} (scaffold — pipeline not wired yet)`);
  }
})();

# Session Memory

## Changes Made

### 1. Queue reset on page refresh (`Option A`)
- `server.js:95-100` — Added `POST /api/queue/reset` endpoint that clears videoQueue + currentVideo and broadcasts empty state
- `app.js:168-175` — Controller calls reset on page load before SSE connection
- `player.js` — Player calls reset on page load before SSE connection

### 2. Autoplay for player.html (no-interactivity device)
- `player.js` — Rewrote player initialization multiple iterations:
  - Player created upfront in `onYouTubeIframeAPIReady` (not lazily)
  - SSE connection inside player's `onReady` event
  - Polling fallback detects when YouTube API is ready regardless of callback timing
  - `loadVideo()` calls `ytPlayer.loadVideoById(videoId)`, then `tryPlay()` via CUED event + setTimeout
  - `onStateChange` handler: PLAYING hides status, ENDED auto-advances to next song, CUED triggers play attempt

### 3. Waiting-bg centering fix
- `player.js` reset handler: changed `waitingBg.style.display = 'flex'` (was `'block'` which broke flex centering)

### 4. Video visible above waiting-bg
- `player.css` — Added `position: fixed; z-index: 1` to `#player` (waiting-bg is z-index: 0)
- This ensures video renders on top of the waiting background

### 5. Mute workaround removed
- `player.js` — Removed `ytPlayer.mute()` / `ytPlayer.unMute()` calls
- Video now plays at full volume

## Current State of Files

- `server.js` — Has reset endpoint at `/api/queue/reset`
- `public/player.js` — Player with polling-based YT API init, SSE queue sync, autoplay handling
- `public/player.css` — `#player` is fixed/z-index:1, queue-display z-index:10
- `public/app.js` — Controller with reset on load, SSE connection
- `public/index.html` — Controller UI

## Pending / Open Questions

- Does autoplay work without the muted workaround? User asked "Why is it muted?" suggesting it was still muted
- Player page needs to work with NO user interaction (no mouse/touch)
- Auto-advance to next song on end is implemented

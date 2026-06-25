var currentVideoId = null;
var queueSongs = [];
var isPlaying = false;
var waitingBg = document.getElementById('waitingBg');
var statusEl = document.getElementById('status');
var queueDisplay = document.getElementById('queueDisplay');
var queueItemsEl = document.getElementById('queueItems');
var videoMetas = {};

// When a song starts playing, we set a timeout to auto-load the next queued song.
// If the server sends a new `current` video via SSE before the timeout, it cancels
// the fallback — the server is the source of truth for queue state.
var endTimeout = null;
var END_TIMEOUT_MS = 3000;

function updateQueue() {
  if (!queueSongs || !queueSongs.length) {
    queueDisplay.classList.remove('visible');
    queueItemsEl.innerHTML = '';
    return;
  }
  queueDisplay.classList.add('visible');
  var html = '';
  for (var i = 0; i < queueSongs.length; i++) {
    var id = queueSongs[i];
    var m = videoMetas[id] || { title: 'Loading...', thumb: '' };
    var cls = id === currentVideoId ? ' now-playing' : '';
    html += '<div class="queue-song' + cls + '">';
    html += '<span class="song-num"><span>' + (i + 1) + '</span></span>';
    html += '<span class="song-title">' + escapeHtml(m.title) + '</span>';
    if (m.thumb) html += '<img class="song-thumb" src="' + m.thumb + '">';
    html += '</div>';
  }
  queueItemsEl.innerHTML = html;
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
          .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Direct iframe approach — no IFrame API needed for autoplay.
// We create the iframe with autoplay+mute params which browsers accept.
var iframeContainer = null;

function loadVideo(videoId) {
  if (currentVideoId === videoId) return;
  currentVideoId = videoId;
  isPlaying = false;
  clearEndTimeout();

  // Create new iframe with autoplay and mute
  var iframe = document.createElement('iframe');
  iframe.src = 'https://www.youtube.com/embed/' + videoId +
    '?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0&loop=0&playsinline=1';
  iframe.width = '100%';
  iframe.height = '100%';
  iframe.frameBorder = '0';
  iframe.allow = 'autoplay; encrypted-media';
  iframe.allowFullscreen = false;
  iframe.style.cssText = 'width:100%;height:100%;border:none;pointer-events:none;';

  var playerEl = document.getElementById('player');
  if (!playerEl) return;

  iframeContainer = document.createElement('div');
  iframeContainer.style.cssText = 'position:absolute;inset:0;z-index:1;';
  iframeContainer.appendChild(iframe);
  playerEl.appendChild(iframeContainer);

  // Iframe loads instantly — start playing fallback
  isPlaying = true;
  waitingBg.classList.add('hidden');
  statusEl.classList.add('hidden');
  scheduleEndTimeout();
}

function clearEndTimeout() {
  if (endTimeout) {
    clearTimeout(endTimeout);
    endTimeout = null;
  }
}

function scheduleEndTimeout() {
  clearEndTimeout();
  endTimeout = setTimeout(function() {
    endTimeout = null;
    // Server didn't send a new current video in time — fall back to local queue.
    var idx = queueSongs.indexOf(currentVideoId);
    if (idx >= 0 && idx + 1 < queueSongs.length) {
      loadVideo(queueSongs[idx + 1]);
    } else {
      showWaiting();
    }
  }, END_TIMEOUT_MS);
}

function showWaiting() {
  currentVideoId = null;
  isPlaying = false;
  clearEndTimeout();
  waitingBg.classList.remove('hidden');
  statusEl.textContent = 'Waiting for songs...';
  statusEl.classList.remove('hidden');
  updateQueue();
}

function fetchMeta(ids) {
  fetch('/api/videos?ids=' + ids.join(','))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.items) {
        for (var i = 0; i < data.items.length; i++) {
          var v = data.items[i];
          videoMetas[v.id] = {
            title: v.snippet.title,
            thumb: v.snippet.thumbnails.medium && v.snippet.thumbnails.medium.url ||
                   v.snippet.thumbnails.default && v.snippet.thumbnails.default.url || ''
          };
        }
      }
      updateQueue();
    }).catch(function() {});
}

// Connect SSE to get server's current state.
function connectSSE() {
  var ev = new EventSource('/api/queue/stream');
  ev.onmessage = function(e) {
    var data = JSON.parse(e.data);

    // Server cleared everything (song ended, no queue)
    if (!data.current && (!data.next || !data.next.length)) {
      showWaiting();
      return;
    }

    // Always sync state from server
    clearEndTimeout();
    queueSongs = data.next || [];

    // Only create a new iframe if the current video actually changed
    if (data.current && data.current !== currentVideoId) {
      loadVideo(data.current);
    } else {
      // Queue changed but same video — just update metadata and UI
      if (queueSongs.length) {
        fetchMeta(queueSongs);
      }
      updateQueue();
    }
  };
  ev.onerror = function() {
    statusEl.textContent = 'Reconnecting...';
    statusEl.classList.remove('hidden');
  };
}

// Start the app — connect SSE immediately (no IFrame API needed).
waitingBg.classList.remove('hidden');
statusEl.classList.remove('hidden');
statusEl.textContent = 'Connecting...';
updateQueue();
connectSSE();

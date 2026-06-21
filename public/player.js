var ytPlayer = null;
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

function loadVideo(videoId) {
  if (!ytPlayer || currentVideoId === videoId) return;
  clearEndTimeout();
  currentVideoId = videoId;
  isPlaying = false;
  ytPlayer.loadVideoById(videoId);
  ytPlayer.playVideo();
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

// Load YouTube IFrame API
var s = document.createElement('script');
s.src = 'https://www.youtube.com/iframe_api';
document.head.appendChild(s);

// Poll until API is ready
(function check() {
  if (typeof YT === 'undefined' || typeof YT.Player === 'undefined') {
    setTimeout(check, 200);
    return;
  }

  ytPlayer = new YT.Player('player', {
    height: '100%',
    width: '100%',
    playerVars: { autoplay: 0, controls: 0, modestbranding: 1, rel: 0, fs: 0 },
    events: {
      onReady: function() {
        // Don't reset — just connect SSE to get server's current state.
        var ev = new EventSource('/api/queue/stream');
        ev.onmessage = function(e) {
          var data = JSON.parse(e.data);

          // Server cleared everything (song ended, no queue)
          if (!data.current && (!data.next || !data.next.length)) {
            showWaiting();
            return;
          }

          // Clear end timeout since server is in control of the queue
          clearEndTimeout();

          // New current video from server — load and play it
          if (data.current && data.current !== currentVideoId) {
            queueSongs = data.next || [];
            loadVideo(data.current);
          } else {
            queueSongs = data.next || [];
          }

          // Update metadata
          if (queueSongs.length) {
            fetchMeta(queueSongs);
          }
          updateQueue();
        };
        ev.onerror = function() {
          statusEl.textContent = 'Reconnecting...';
          statusEl.classList.remove('hidden');
        };
      },
      onStateChange: function(data) {
        // data.state: 1=PLAYING, 2=PAUSED, 3=BUFFERING, 5=CUED, 0=ENDED
        if (data.state === 1) {
          isPlaying = true;
          waitingBg.classList.add('hidden');
          statusEl.classList.add('hidden');
          // Start the fallback timeout: if the server doesn't send the next
          // video within END_TIMEOUT_MS, assume the song ended and load from
          // the local queue.
          scheduleEndTimeout();
        } else if (data.state === 2 || data.state === 3) {
          isPlaying = false;
        } else if (data.state === 0) {
          clearEndTimeout();
          // If the server already sent a new current video, SSE handler
          // will take care of it. If not, the endTimeout will fire and
          // fall back to the local queue.
        }
      }
    }
  });

  waitingBg.classList.remove('hidden');
  statusEl.classList.remove('hidden');
  statusEl.textContent = 'Connecting...';
  updateQueue();
})();

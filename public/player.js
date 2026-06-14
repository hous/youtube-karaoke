var ytPlayer = null;
var currentVideoId = null;
var queueSongs = [];
var isPlaying = false;
var waitingBg = document.getElementById('waitingBg');
var statusEl = document.getElementById('status');
var queueDisplay = document.getElementById('queueDisplay');
var queueItemsEl = document.getElementById('queueItems');
var videoMetas = {};

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
  currentVideoId = videoId;
  isPlaying = false;
  ytPlayer.loadVideoById(videoId);
}

function startPlaying() {
  if (!ytPlayer || !currentVideoId) return;
  isPlaying = true;
  waitingBg.style.display = 'none';
  statusEl.style.display = 'none';
}

function handleSongEnd() {
  var idx = -1;
  for (var i = 0; i < queueSongs.length; i++) {
    if (queueSongs[i] === currentVideoId) { idx = i; break; }
  }
  if (idx >= 0 && idx + 1 < queueSongs.length) {
    loadVideo(queueSongs[idx + 1]);
  } else {
    currentVideoId = null;
    isPlaying = false;
    waitingBg.style.display = 'flex';
    statusEl.style.display = 'block';
    statusEl.textContent = 'Waiting for songs...';
    statusEl.classList.remove('hidden');
    updateQueue();
  }
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
        var ev = new EventSource('/api/queue/stream');
        ev.onmessage = function(e) {
          var data = JSON.parse(e.data);
          queueSongs = data.next || [];
          if (data.current && data.current !== currentVideoId) {
            loadVideo(data.current);
          }
          if (queueSongs.length) {
            fetchMeta(queueSongs);
          } else {
            updateQueue();
          }
        };
        ev.onerror = function() {
          statusEl.textContent = 'Reconnecting...';
          statusEl.style.display = 'block';
          statusEl.classList.remove('hidden');
        };
      },
      onStateChange: function(data) {
        // data.state: 1=PLAYING, 2=PAUSED, 3=BUFFERING, 5=CUED, 0=ENDED
        if (data.state === 1 && !isPlaying) {
          // Video just started playing - unmute
          startPlaying();
        } else if (data.state === 1) {
          isPlaying = true;
        } else if (data.state === 2 || data.state === 3) {
          isPlaying = false;
        } else if (data.state === 0) {
          handleSongEnd();
        }
      }
    }
  });

  waitingBg.style.display = 'flex';
  statusEl.style.display = 'block';
  statusEl.textContent = 'Connecting...';
  statusEl.classList.remove('hidden');
  updateQueue();
})();

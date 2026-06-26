var currentVideoId = null;
var currentSinger = null;
var queueSongs = [];
var isPlaying = false;
var waitingBg = document.getElementById('waitingBg');
var statusEl = document.getElementById('status');
var queueDisplay = document.getElementById('queueDisplay');
var queueItemsEl = document.getElementById('queueItems');
var singerOverlay = document.getElementById('singerOverlay');
var singerLine1 = document.getElementById('singerLine1');
var singerLine2 = document.getElementById('singerLine2');
var videoMetas = {};
var lastAnnouncedSong = null;

// ─── Text-to-speech ───
function speak(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  var utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.9;
  utterance.pitch = 1.0;
  utterance.volume = 0.8;
  var voices = window.speechSynthesis.getVoices();
  var preferred = voices.find(function(v) {
    return v.lang.startsWith('en') && v.name.includes('Google');
  });
  if (preferred) utterance.voice = preferred;
  window.speechSynthesis.speak(utterance);
}

if ('speechSynthesis' in window) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = function() {
    window.speechSynthesis.getVoices();
  };
}

// ─── Audio unlock (mobile browsers require a user gesture on this page) ───
var audioUnlocked = false;
var pendingVideoId = null;

document.getElementById('audioUnlock').addEventListener('click', function() {
  audioUnlocked = true;
  this.style.display = 'none';
  if (pendingVideoId) {
    var id = pendingVideoId;
    pendingVideoId = null;
    loadVideo(id);
  }
});

// ─── Video player ───
var iframeContainer = null;

function loadVideo(videoId) {
  if (!audioUnlocked) {
    // Queue the video — will play as soon as the user taps the unlock screen
    pendingVideoId = videoId;
    return;
  }
  if (currentVideoId === videoId) return;
  currentVideoId = videoId;
  isPlaying = false;
  clearEndTimeout();

  var iframe = document.createElement('iframe');
  iframe.src = 'https://www.youtube.com/embed/' + videoId +
    '?autoplay=1&mute=0&controls=0&modestbranding=1&rel=0&playsinline=1';
  iframe.width = '100%';
  iframe.height = '100%';
  iframe.frameBorder = '0';
  iframe.allow = 'autoplay; encrypted-media';
  iframe.allowFullscreen = false;
  iframe.style.cssText = 'width:100%;height:100%;border:none;pointer-events:none;';

  var playerEl = document.getElementById('player');
  if (!playerEl) return;

  if (iframeContainer) {
    playerEl.removeChild(iframeContainer);
  }

  iframeContainer = document.createElement('div');
  iframeContainer.style.cssText = 'position:absolute;inset:0;z-index:1;';
  iframeContainer.appendChild(iframe);
  playerEl.appendChild(iframeContainer);

  isPlaying = true;
  waitingBg.classList.add('hidden');
  statusEl.classList.add('hidden');
  scheduleEndTimeout();
}

// ─── Singer Overlay ───
var overlayTimeout = null;

function showSingerOverlay(singer, title) {
  if (overlayTimeout) clearTimeout(overlayTimeout);

  singerLine1.textContent = singer || '';
  singerLine2.textContent = title || '';

  singerOverlay.classList.add('visible');
  overlayTimeout = setTimeout(function() {
    singerOverlay.classList.remove('visible');
    overlayTimeout = null;
  }, 7000);
}

function hideSingerOverlay() {
  if (singerOverlay) singerOverlay.classList.remove('visible');
  if (overlayTimeout) {
    clearTimeout(overlayTimeout);
    overlayTimeout = null;
  }
}

// ─── End-of-song timeout ───
// queueSongs[0] is always the currently playing song.
// When it ends, load queueSongs[1] (if present) by calling /api/queue/next
// which shifts the server queue, then the resulting SSE update loads the new video.
var endTimeout = null;
var END_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes as safety fallback

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
    advanceQueue();
  }, END_TIMEOUT_MS);
}

function advanceQueue() {
  fetch('/api/queue/next', { method: 'POST' })
    .catch(function() {});
}

function showWaiting() {
  currentVideoId = null;
  currentSinger = null;
  isPlaying = false;
  clearEndTimeout();
  hideSingerOverlay();
  waitingBg.classList.remove('hidden');
  statusEl.textContent = 'Waiting for songs...';
  statusEl.classList.remove('hidden');
  updateQueue();
}

// ─── Queue display ───
function updateQueue() {
  if (!queueSongs || !queueSongs.length) {
    queueDisplay.classList.remove('visible');
    queueItemsEl.innerHTML = '';
    return;
  }
  queueDisplay.classList.add('visible');
  var html = '';
  for (var i = 0; i < queueSongs.length; i++) {
    var item = queueSongs[i];
    var vid = item.videoId;
    var m = videoMetas[vid] || { title: 'Loading...', thumb: '' };
    var cls = i === 0 ? ' now-playing' : '';
    var singerHtml = item.singer
      ? '<div class="queue-song-singer">' + escapeHtml(item.singer) + '</div>'
      : '';
    html += '<div class="queue-song' + cls + '">';
    html += '<span class="song-num"><span>' + (i + 1) + '</span></span>';
    html += '<span class="song-title">' + escapeHtml(m.title) + '</span>';
    html += singerHtml;
    if (m.thumb) html += '<img class="song-thumb" src="' + m.thumb + '">';
    html += '</div>';
  }
  queueItemsEl.innerHTML = html;
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
          .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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

// ─── SSE Connection ───
function connectSSE() {
  var ev = new EventSource('/api/queue/stream');
  ev.onmessage = function(e) {
    var data = JSON.parse(e.data);

    if (!data.current && (!data.next || !data.next.length)) {
      showWaiting();
      return;
    }

    queueSongs = data.next || [];

    var newVideoId = data.current ? data.current.videoId : null;
    var newSinger = data.current ? data.current.singer : '';
    var newTitle = (data.current && videoMetas[newVideoId]) ? videoMetas[newVideoId].title : '';

    if (newVideoId && newVideoId !== currentVideoId) {
      clearEndTimeout();
      loadVideo(newVideoId);
      currentSinger = newSinger || null;

      if (newVideoId !== lastAnnouncedSong) {
        lastAnnouncedSong = newVideoId;
        showSingerOverlay(newSinger, newTitle);
        if (newSinger) {
          speak(newSinger + ', ' + (newTitle || 'your song'));
        }
      }
    } else {
      // Same video still playing — update queue display only
      var missingIds = [];
      for (var i = 0; i < queueSongs.length; i++) {
        if (!videoMetas[queueSongs[i].videoId]) {
          missingIds.push(queueSongs[i].videoId);
        }
      }
      if (missingIds.length) fetchMeta(missingIds);
      else updateQueue();
    }
  };
  ev.onerror = function() {
    statusEl.textContent = 'Reconnecting...';
    statusEl.classList.remove('hidden');
  };
}

// Start
waitingBg.classList.remove('hidden');
statusEl.classList.remove('hidden');
statusEl.textContent = 'Connecting...';
updateQueue();
connectSSE();

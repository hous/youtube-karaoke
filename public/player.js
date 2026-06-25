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

// ─── Video player (direct iframe for reliable autoplay) ───
var iframeContainer = null;
var unmuteAttempted = false;

function loadVideo(videoId) {
  if (currentVideoId === videoId) return;
  currentVideoId = videoId;
  isPlaying = false;
  clearEndTimeout();

  // Create new iframe with autoplay and mute
  var iframe = document.createElement('iframe');
  iframe.src = 'https://www.youtube.com/embed/' + videoId +
    '?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0&playsinline=1';
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

  // Try to unmute after a short delay (user has already interacted with the page by now)
  if (!unmuteAttempted) {
    unmuteAttempted = true;
    tryUnmute();
  }
}

function tryUnmute() {
  // Load the YouTube IFrame API to attempt unmute
  var tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  var firstScript = document.getElementsByTagName('script')[0];
  firstScript.parentNode.insertBefore(tag, firstScript);
}

window.onYouTubeIframeAPIReady = function() {
  if (!iframeContainer || unmuteAttempted) return;
  unmuteAttempted = true;

  var player = new YT.Player(iframeContainer, {
    videoId: currentVideoId,
    playerVars: { autoplay: 1 },
    events: {
      onReady: function(event) {
        event.target.unMute();
        event.target.setVolume(100);
      }
    }
  });
};

// ─── Singer Overlay ───
var overlayTimeout = null;

function showSingerOverlay(singer, title) {
  if (overlayTimeout) clearTimeout(overlayTimeout);

  if (singer) {
    singerLine1.textContent = singer;
    singerLine2.textContent = title || '';
  } else {
    singerLine1.textContent = '';
    singerLine2.textContent = title || '';
  }

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

// ─── End timeout ───
var endTimeout = null;
var END_TIMEOUT_MS = 3000;

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
    // Find current song in the combined queue (current + next from server).
    // The server broadcast includes currentVideo in `next` so we can locate
    // the currently playing song and advance to the next one.
    for (var i = 0; i < queueSongs.length; i++) {
      if (queueSongs[i].videoId === currentVideoId) {
        // Skip same song (handles skip button desync).
        var j = i + 1;
        while (j < queueSongs.length && queueSongs[j].videoId === currentVideoId) {
          j++;
        }
        if (j < queueSongs.length) {
          var next = queueSongs[j];
          loadVideo(next.videoId);
          showSingerOverlay(next.singer, (videoMetas[next.videoId] || {}).title);
          if (next.singer) {
            speak(next.singer + ', ' + (videoMetas[next.videoId] || {}).title);
          }
        } else {
          showWaiting();
        }
        return;
      }
    }
    // currentVideoId not found in queue — show waiting.
    showWaiting();
  }, END_TIMEOUT_MS);
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

// ─── Queue ───
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
    var cls = vid === currentVideoId ? ' now-playing' : '';
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

    clearEndTimeout();
    queueSongs = data.next || [];

    var newVideoId = data.current ? data.current.videoId : null;
    var newSinger = data.current ? data.current.singer : '';
    var newTitle = (data.current && videoMetas[newVideoId]) ? videoMetas[newVideoId].title : '';

    if (newVideoId && newVideoId !== currentVideoId) {
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
      // Same video still playing — just update metadata and UI
      if (queueSongs.length) {
        var missingIds = [];
        for (var i = 0; i < queueSongs.length; i++) {
          if (!videoMetas[queueSongs[i].videoId]) {
            missingIds.push(queueSongs[i].videoId);
          }
        }
        if (missingIds.length) fetchMeta(missingIds);
      }
      updateQueue();
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

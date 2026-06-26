let queue = [];
let currentVideo = null;
let videoMetas = {}; // cached {videoId: {title, channel, thumb}}
let source = null;
let firstResultId = null; // first search result for "Play Now"

// ─── Modal state ───
let pendingVideoId = null;
let pendingMeta = null;
let highlightedAutocompleteIndex = -1;

const searchInput = document.getElementById('searchInput');
const searchPanel = document.getElementById('searchPanel');
const searchBtn = document.getElementById('searchBtn');
const queueList = document.getElementById('queueList');

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') search();
});

// ─── Name / localStorage helpers ───
const NAMES_KEY = 'karaoke_names';

function getRecentNames() {
  try {
    return JSON.parse(localStorage.getItem(NAMES_KEY)) || [];
  } catch { return []; }
}

function saveName(name) {
  if (!name || !name.trim()) return;
  const names = getRecentNames();
  const trimmed = name.trim();
  // Move to front if exists
  const idx = names.indexOf(trimmed);
  if (idx > -1) names.splice(idx, 1);
  names.unshift(trimmed);
  // Keep top 20
  while (names.length > 20) names.pop();
  localStorage.setItem(NAMES_KEY, JSON.stringify(names));
}

// ─── Search ───
function search() {
  const q = searchInput.value.trim();
  if (!q) return;
  searchBtn.disabled = true;
  searchBtn.textContent = '...';
  firstResultId = null;
  const playBtn = document.getElementById('startPlayBtn');
  if (playBtn) playBtn.style.display = 'none';
  searchPanel.innerHTML = '<div class="panel-header">Results</div><div class="loading">Searching...</div>';

  const karaokeQ = `${q} instrumental karaoke (lyrics)`;

  fetch(`/api/search?q=${encodeURIComponent(karaokeQ)}`)
    .then(r => r.json())
    .then(data => renderSearchResults(data.items || []))
    .catch(err => {
      searchPanel.innerHTML = `<div class="panel-header">Results</div><div class="error">Error: ${err.message}</div>`;
    })
    .finally(() => {
      searchBtn.disabled = false;
      searchBtn.textContent = 'Search';
    });
}

function renderSearchResults(items) {
  if (!items.length) {
    searchPanel.innerHTML = '<div class="panel-header">Results</div><div class="loading">No results found.</div>';
    return;
  }

  // Store first result for play button
  firstResultId = items[0].id.videoId;
  const playBtn = document.getElementById('startPlayBtn');
  if (playBtn) playBtn.style.display = 'flex';

  // Cache metadata from search results
  items.forEach(item => {
    const id = item.id.videoId;
    videoMetas[id] = {
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumb: item.snippet.thumbnails.medium.url
    };
  });

  searchPanel.innerHTML = items.map(item => {
    const id = item.id.videoId;
    const title = item.snippet.title;
    const channel = item.snippet.channelTitle;
    const thumb = item.snippet.thumbnails.medium.url;
    return `
      <div class="song-card" onclick="openNameModal('${id}')" data-id="${id}">
        <img class="card-thumb" src="${thumb}" alt="">
        <div class="card-info">
          <div class="card-title">${escapeHtml(title)}</div>
          <div class="card-channel">${escapeHtml(channel)}</div>
        </div>
      </div>
    `;
  }).join('');
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ─── Name Entry Modal ───
function openNameModal(videoId) {
  pendingVideoId = videoId;
  pendingMeta = videoMetas[videoId] || { title: 'Loading...', channel: '', thumb: '' };

  document.getElementById('modalThumb').src = pendingMeta.thumb || '';
  document.getElementById('modalThumb').style.display = pendingMeta.thumb ? 'block' : 'none';
  document.getElementById('modalSongTitle').textContent = pendingMeta.title || '-';
  document.getElementById('modalSongChannel').textContent = pendingMeta.channel || '';
  document.getElementById('modalNameInput').value = '';
  document.getElementById('modalAddBtn').disabled = false;
  highlightedAutocompleteIndex = -1;

  renderRecentNames();
  renderAutocomplete('');

  const modal = document.getElementById('nameModal');
  modal.classList.add('visible');

  // Focus input after animation starts
  setTimeout(() => {
    const input = document.getElementById('modalNameInput');
    input.focus();
  }, 200);
}

function closeNameModal() {
  const modal = document.getElementById('nameModal');
  modal.classList.remove('visible');
  pendingVideoId = null;
  pendingMeta = null;
  highlightedAutocompleteIndex = -1;
}

function renderRecentNames() {
  const names = getRecentNames();
  const container = document.getElementById('modalRecentNames');
  if (names.length === 0) {
    container.innerHTML = '<span style="color:#444;font-size:13px;">No recent singers yet</span>';
    return;
  }
  container.innerHTML = names.slice(0, 6).map(name =>
    `<button class="modal-recent-chip" onclick="selectRecentName('${escapeHtml(name)}')">${escapeHtml(name)}</button>`
  ).join('');
}

function selectRecentName(name) {
  document.getElementById('modalNameInput').value = name;
  document.getElementById('modalNameInput').focus();
  renderAutocomplete(name);
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const qEscaped = escapeHtml(query);
  const idx = escaped.toLowerCase().indexOf(qEscaped.toLowerCase());
  if (idx === -1) return escaped;
  return escaped.slice(0, idx)
    + '<span class="match-highlight">' + escaped.slice(idx, idx + qEscaped.length) + '</span>'
    + escaped.slice(idx + qEscaped.length);
}

function renderAutocomplete(query) {
  const names = getRecentNames();
  const list = document.getElementById('modalAutocompleteList');
  highlightedAutocompleteIndex = -1;

  if (!query.trim()) {
    list.classList.remove('visible');
    return;
  }

  const matches = names.filter(n =>
    n.toLowerCase().includes(query.toLowerCase())
  );

  if (matches.length === 0) {
    list.classList.remove('visible');
    return;
  }

  list.classList.add('visible');
  list.innerHTML = matches.map(name =>
    `<div class="modal-autocomplete-item" onmousedown="selectAutocomplete('${escapeHtml(name)}')">${highlightMatch(name, query)}</div>`
  ).join('');
}

function selectAutocomplete(name) {
  document.getElementById('modalNameInput').value = name;
  document.getElementById('modalAutocompleteList').classList.remove('visible');
  document.getElementById('modalNameInput').focus();
}

// ─── Confirm add ───
function confirmAddToQueue() {
  const input = document.getElementById('modalNameInput');
  const singer = input.value.trim();
  saveName(singer || 'Anonymous');
  addSongToQueue(pendingVideoId, singer);
  closeNameModal();
}

function skipToAddSong() {
  addSongToQueue(pendingVideoId, '');
  closeNameModal();
}

function addSongToQueue(videoId, singer) {
  const params = singer ? `?videoId=${encodeURIComponent(videoId)}&singer=${encodeURIComponent(singer)}` : `?videoId=${encodeURIComponent(videoId)}`;
  fetch(`/api/queue/add${params}`, { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      currentVideo = data.current;
      queue = data.next;
      updateUI();
    })
    .catch(err => console.error('Failed to add to queue:', err));
}

// ─── Modal event listeners ───
document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('nameModal');
  const input = document.getElementById('modalNameInput');
  const addBtn = document.getElementById('modalAddBtn');
  const skipBtn = document.getElementById('modalSkipBtn');
  const autocompleteList = document.getElementById('modalAutocompleteList');

  // Close modal on overlay click (not card click)
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeNameModal();
  });

  // Input change → autocomplete
  input.addEventListener('input', () => {
    renderAutocomplete(input.value);
    // Enable/disable add button based on whether there's a pending song
    addBtn.disabled = !pendingVideoId;
  });

  // Keyboard navigation in autocomplete
  input.addEventListener('keydown', (e) => {
    const items = autocompleteList.querySelectorAll('.modal-autocomplete-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlightedAutocompleteIndex = Math.min(highlightedAutocompleteIndex + 1, items.length - 1);
      items.forEach((item, i) => item.classList.toggle('highlighted', i === highlightedAutocompleteIndex));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightedAutocompleteIndex = Math.max(highlightedAutocompleteIndex - 1, 0);
      items.forEach((item, i) => item.classList.toggle('highlighted', i === highlightedAutocompleteIndex));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedAutocompleteIndex >= 0 && items[highlightedAutocompleteIndex]) {
        items[highlightedAutocompleteIndex].click();
      } else {
        confirmAddToQueue();
      }
    } else if (e.key === 'Escape') {
      closeNameModal();
    }
  });

  // Button clicks
  addBtn.addEventListener('click', confirmAddToQueue);
  skipBtn.addEventListener('click', skipToAddSong);
});

// ─── Queue management ───
function skipToNext() {
  const isLastSong = queue.length <= 1;
  // Tell player.html to stop immediately (before HTTP round-trip)
  if (isLastSong) {
    localStorage.setItem('karaoke_stop', Date.now().toString());
  }
  fetch('/api/queue/next', { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      currentVideo = data.current;
      queue = data.next;
      updateUI();
    })
    .catch(err => console.error('Failed to skip:', err));
}

function playFirstResult() {
  if (!firstResultId) return;
  fetch('/api/queue/reset', { method: 'POST' })
    .then(() => fetch(`/api/queue/add?videoId=${encodeURIComponent(firstResultId)}`, { method: 'POST' }))
    .then(r => r.json())
    .then(data => {
      currentVideo = data.current;
      queue = data.next;
      updateUI();
      // Brief visual feedback
      const playBtn = document.getElementById('playFirstBtn');
      if (playBtn) {
        playBtn.textContent = '▶ Playing!';
        setTimeout(() => { playBtn.textContent = '▶ Play Now'; }, 2000);
      }
    })
    .catch(err => console.error('Failed to play:', err));
}

// Also allow Enter key on play button
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'searchInput') {
    e.preventDefault();
    search();
  }
});

function removeFromQueue(index) {
  fetch(`/api/queue/remove?index=${index}`, { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      currentVideo = data.current;
      queue = data.next;
      updateUI();
    })
    .catch(err => console.error('Failed to remove from queue:', err));
}

// ─── SSE subscription ───
function connectSSE() {
  if (source) { source.close(); source = null; }
  source = new EventSource('/api/queue/stream');

  source.onmessage = ev => {
    try {
      const data = JSON.parse(ev.data);
      currentVideo = data.current; // {videoId, singer}
      queue = data.next;          // [{videoId, singer}]
      updateUI();
    } catch (e) { /* ignore */ }
  };

  source.onerror = () => {
    console.warn('SSE disconnected, retrying...');
  };
}

// Fetch metadata for any videos that don't have it yet
function fetchMissingMeta() {
  const missingIds = [];
  for (const item of queue) {
    const vid = item.videoId;
    if (vid !== currentVideo?.videoId && !videoMetas[vid]) {
      missingIds.push(vid);
    }
  }
  // Also check current video
  if (currentVideo?.videoId && !videoMetas[currentVideo.videoId]) {
    missingIds.push(currentVideo.videoId);
  }
  if (missingIds.length) {
    // Deduplicate
    const ids = [...new Set(missingIds)];
    fetch('/api/videos?ids=' + ids.join(','))
      .then(r => r.json())
      .then(data => {
        if (data.items) {
          data.items.forEach(v => {
            videoMetas[v.id] = {
              title: v.snippet.title,
              channel: v.snippet.channelTitle,
              thumb: v.snippet.thumbnails.medium.url || v.snippet.thumbnails.default.url || ''
            };
          });
          updateUI();
        }
      })
      .catch(() => {});
  }
}

// ─── Update the UI with current state ───
function updateUI() {
  const np = document.getElementById('nowPlaying');
  if (currentVideo?.videoId) {
    np.style.display = 'flex';
    const meta = videoMetas[currentVideo.videoId];
    const npTitle = document.getElementById('npTitle');
    const npThumb = document.getElementById('npThumb');
    let titleText = meta?.title || 'Now Playing';
    if (currentVideo.singer) {
      titleText = `${currentVideo.singer} — ${titleText}`;
    }
    npTitle.textContent = titleText;
    if (meta?.thumb) {
      npThumb.src = meta.thumb;
      npThumb.style.display = 'block';
    } else {
      npThumb.style.display = 'none';
    }
  } else {
    np.style.display = 'none';
  }

  // Update queue count
  document.getElementById('queueCount').textContent = queue.length;

  // Render queue panel
  if (queue.length === 0) {
    queueList.innerHTML = '<div class="empty-state"><div class="icon">&#x1F3B5;</div>Queue is empty</div>';
  } else {
    queueList.innerHTML = queue.map((item, i) => {
      const vid = item.videoId;
      const meta = videoMetas[vid] || { title: 'Unknown', thumb: '' };
      const singer = item.singer ? `<div class="queue-singer">${escapeHtml(item.singer)}</div>` : '';
      return `
        <div class="queue-item">
          <div class="queue-num">${i + 1}</div>
          <div class="queue-info">
            <div class="queue-title">${escapeHtml(meta.title)}</div>
            ${singer}
          </div>
          <button class="queue-remove" onclick="removeFromQueue(${i})">&times;</button>
        </div>
      `;
    }).join('');
  }
}

// Start SSE connection on page load (no reset — the server owns the queue state)
connectSSE();
// Fetch missing metadata after a short delay
setTimeout(fetchMissingMeta, 500);

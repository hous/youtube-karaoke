let queue = [];
let currentVideo = null;
let videoMetas = {}; // cached {videoId: {title, channel, thumb}}
let source = null;

const searchInput = document.getElementById('searchInput');
const searchPanel = document.getElementById('searchPanel');
const searchBtn = document.getElementById('searchBtn');
const queueList = document.getElementById('queueList');

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') search();
});

function search() {
  const q = searchInput.value.trim();
  if (!q) return;
  searchBtn.disabled = true;
  searchBtn.textContent = '...';
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
      <div class="song-card" onclick="addToQueue('${id}')" data-id="${id}">
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

// Queue management
function addToQueue(videoId) {
  fetch(`/api/queue/add?videoId=${encodeURIComponent(videoId)}`, { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      currentVideo = data.current;
      queue = data.next;
      updateUI();
    })
    .catch(err => console.error('Failed to add to queue:', err));
}

function skipToNext() {
  fetch('/api/queue/next', { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      currentVideo = data.current;
      queue = data.next;
      updateUI();
    })
    .catch(err => console.error('Failed to skip:', err));
}

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

// SSE subscription
function connectSSE() {
  if (source) { source.close(); source = null; }
  source = new EventSource('/api/queue/stream');

  source.onmessage = ev => {
    try {
      const data = JSON.parse(ev.data);
      currentVideo = data.current;
      queue = data.next;
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
  for (const vid of queue) {
    if (vid !== currentVideo && !videoMetas[vid]) {
      missingIds.push(vid);
    }
  }
  // Also check current video
  if (currentVideo && !videoMetas[currentVideo]) {
    missingIds.push(currentVideo);
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

// Update the UI with current state
function updateUI() {
  const np = document.getElementById('nowPlaying');
  if (currentVideo) {
    np.style.display = 'flex';
    const meta = videoMetas[currentVideo];
    const npTitle = document.getElementById('npTitle');
    const npThumb = document.getElementById('npThumb');
    npTitle.textContent = meta?.title || 'Now Playing';
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
    queueList.innerHTML = queue.map((vid, i) => {
      const meta = videoMetas[vid] || { title: 'Unknown', thumb: '' };
      return `
        <div class="queue-item">
          <div class="queue-num">${i + 1}</div>
          <div class="queue-info">
            <div class="queue-title">${escapeHtml(meta.title)}</div>
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

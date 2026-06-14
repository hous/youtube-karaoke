import 'dotenv/config';
import express from 'express';
import cors from "cors";
import path from 'path';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const videoQueue = [];
let currentVideo = null;

const app = express();

// Serve static assets (HTML, JS, CSS)
app.use(express.static('public'));

// SSE clients list for queue updates
let sseClients = [];

function broadcastQueue() {
  const payload = { current: currentVideo, next: videoQueue };
  sseClients.forEach(res => {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (e) {
      // ignore broken connections
    }
  });
}



const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
if (!YOUTUBE_API_KEY) {
  console.error('ERROR: Set YOUTUBE_API_KEY environment variable');
  process.exit(1);
}

app.use(cors());
const PORT = process.env.PORT || 3000;


// Existing search endpoint remains unchanged
app.get('/api/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing query' });

  try {
    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('q', q);
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('maxResults', '25');
    searchUrl.searchParams.set('key', YOUTUBE_API_KEY);

    const searchResponse = await fetch(searchUrl.toString());
    const searchData = await searchResponse.json();

    if (searchData.error) {
      return res.status(400).json(searchData.error);
    }

    const ids = searchData.items.map(i => i.id.videoId).join(',');
    const videoUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    videoUrl.searchParams.set('part', 'status');
    videoUrl.searchParams.set('id', ids);
    videoUrl.searchParams.set('key', YOUTUBE_API_KEY);

    const videoResponse = await fetch(videoUrl.toString());
    const videoData = await videoResponse.json();

    const embeddableMap = {};
    if (videoData.items) {
      videoData.items.forEach(v => {
        embeddableMap[v.id] = v.status.embeddable;
      });
    }

    searchData.items = searchData.items.filter(item =>
      embeddableMap[item.id.videoId] !== false
    );

    res.json(searchData);
  } catch (err) {
    res.status(500).json({ error: 'Search failed', message: err.message });
  }
});

// Queue management endpoints
app.post('/api/queue/add', (req, res) => {
  const videoId = req.query.videoId;
  if (!videoId) return res.status(400).json({ error: 'Missing videoId' });
  if (!currentVideo) {
    currentVideo = videoId;
  } else {
    videoQueue.push(videoId);
  }
  res.json({ current: currentVideo, next: videoQueue });
  broadcastQueue();
});

// SSE endpoint for real‑time queue updates
app.get('/api/queue/stream', (req, res) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  // Send initial state
  const initPayload = { current: currentVideo, next: videoQueue };
  res.write(`data: ${JSON.stringify(initPayload)}\n\n`);

  // Register client
  sseClients.push(res);

  // Remove client on disconnect
  req.on('close', () => {
    sseClients = sseClients.filter(r => r !== res);
  });
});


app.post('/api/queue/remove', (req, res) => {
  const { index } = req.query;
  const i = parseInt(index);
  if (isNaN(i) || i < 0 || i >= videoQueue.length) {
    return res.status(400).json({ error: 'Invalid index' });
  }
  videoQueue.splice(i, 1);
  res.json({ current: currentVideo, next: videoQueue });
  broadcastQueue();
});

app.post('/api/queue/next', (req, res) => {
  if (videoQueue.length > 0) {
    currentVideo = videoQueue.shift();
  } else {
    currentVideo = null;
  }
  res.json({ current: currentVideo, next: videoQueue });
  broadcastQueue();
});

// Video details endpoint
app.get('/api/videos', async (req, res) => {
  const { ids } = req.query;
  if (!ids) return res.status(400).json({ error: 'Missing video IDs' });

  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'snippet,status');
    url.searchParams.set('id', ids);
    url.searchParams.set('key', YOUTUBE_API_KEY);

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.items) {
      data.items = data.items.filter(v => v.status.embeddable === true);
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Video lookup failed', message: err.message });
  }
});


app.listen(PORT, () => {
  console.log(`Karaoke server running at http://localhost:${PORT}`);
});

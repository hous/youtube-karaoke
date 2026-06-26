import 'dotenv/config';
import express from 'express';
import cors from "cors";
import path from 'path';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// videoQueue holds all songs including the currently playing one at index 0.
// currentVideo always points to videoQueue[0] (or null when empty).
const videoQueue = [];
let currentVideo = null;

const app = express();

app.use(express.static('public'));

let sseClients = [];

function broadcastQueue() {
  const payload = {
    current: currentVideo ? { videoId: currentVideo.videoId, singer: currentVideo.singer } : null,
    next: videoQueue,
  };
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

    const allIds = searchData.items.map(i => i.id.videoId);
    // YouTube videos.list caps at 20 IDs per request — batch them
    const batches = [];
    for (let i = 0; i < allIds.length; i += 20) {
      batches.push(allIds.slice(i, i + 20));
    }

    const videoUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    videoUrl.searchParams.set('part', 'status,contentDetails');
    videoUrl.searchParams.set('key', YOUTUBE_API_KEY);

    const embeddableMap = {};
    const regionRestricted = new Set();

    for (const batch of batches) {
      videoUrl.searchParams.set('id', batch.join(','));
      const videoResponse = await fetch(videoUrl.toString());
      const videoData = await videoResponse.json();

      if (videoData.items) {
        for (const v of videoData.items) {
          embeddableMap[v.id] = v.status?.embeddable;
          const restriction = v.contentDetails?.regionRestriction;
          if (restriction) {
            // regionRestriction is present — the video is blocked in some region(s).
            if (restriction.restrictedOn?.length > 0) {
              regionRestricted.add(v.id);
            } else if (restriction.unrestrictedOn?.length > 0 && restriction.unrestrictedOn.length < 250) {
              regionRestricted.add(v.id);
            } else {
              // Empty regionRestriction object — API can't determine countries.
              // Block conservatively (video is restricted somewhere).
              regionRestricted.add(v.id);
            }
          }
        }
      }
    }

    // Allowed channels — case-insensitive, ignore whitespace
    const ALLOWED_CHANNELS = ['singking', 'karafun'];
    const matchesChannel = (title) => {
      const t = title.toLowerCase().replace(/\s/g, '');
      return ALLOWED_CHANNELS.some(c => t.includes(c));
    };

    searchData.items = searchData.items.filter(item => {
      const id = item.id.videoId;
      return embeddableMap[id] !== false
        && !regionRestricted.has(id)
        && matchesChannel(item.snippet.channelTitle);
    });

    res.json(searchData);
  } catch (err) {
    res.status(500).json({ error: 'Search failed', message: err.message });
  }
});

app.post('/api/queue/reset', (req, res) => {
  videoQueue.length = 0;
  currentVideo = null;
  res.json({ current: null, next: [] });
  broadcastQueue();
});

app.post('/api/queue/add', (req, res) => {
  const videoId = req.query.videoId;
  if (!videoId) return res.status(400).json({ error: 'Missing videoId' });
  const singer = req.query.singer || '';
  const entry = { videoId, singer: singer || undefined };
  videoQueue.push(entry);
  if (!currentVideo) {
    currentVideo = videoQueue[0];
  }
  res.json({ current: currentVideo, next: videoQueue });
  broadcastQueue();
});

app.post('/api/queue/remove', (req, res) => {
  const i = parseInt(req.query.index);
  if (isNaN(i) || i < 0 || i >= videoQueue.length) {
    return res.status(400).json({ error: 'Invalid index' });
  }
  videoQueue.splice(i, 1);
  // If the currently playing song was removed, advance to whatever is now at index 0
  if (i === 0) {
    currentVideo = videoQueue.length > 0 ? videoQueue[0] : null;
  }
  res.json({ current: currentVideo, next: videoQueue });
  broadcastQueue();
});

app.post('/api/queue/next', (req, res) => {
  // Shift the current song off the front of the queue and advance
  if (videoQueue.length > 0) videoQueue.shift();
  currentVideo = videoQueue.length > 0 ? videoQueue[0] : null;
  res.json({ current: currentVideo, next: videoQueue });
  broadcastQueue();
});

app.get('/api/queue/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const initPayload = {
    current: currentVideo,
    next: videoQueue,
  };
  res.write(`data: ${JSON.stringify(initPayload)}\n\n`);

  sseClients.push(res);

  req.on('close', () => {
    sseClients = sseClients.filter(r => r !== res);
  });
});

app.get('/api/videos', async (req, res) => {
  const { ids } = req.query;
  if (!ids) return res.status(400).json({ error: 'Missing video IDs' });

  try {
    const idsList = ids.split(',');
    const batches = [];
    for (let i = 0; i < idsList.length; i += 20) {
      batches.push(idsList.slice(i, i + 20));
    }

    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'snippet,status');
    url.searchParams.set('key', YOUTUBE_API_KEY);

    const allItems = [];
    for (const batch of batches) {
      url.searchParams.set('id', batch.join(','));
      const response = await fetch(url.toString());
      const data = await response.json();
      if (data.items) {
        allItems.push(...data.items);
      }
    }

    allItems.sort((a, b) => idsList.indexOf(a.id) - idsList.indexOf(b.id));
    res.json({ items: allItems.filter(v => v.status?.embeddable === true) });
  } catch (err) {
    res.status(500).json({ error: 'Video lookup failed', message: err.message });
  }
});

app.get('/api/config', (req, res) => {
  res.json({ title: process.env.APP_TITLE || 'Karaoke' });
});

app.listen(PORT, () => {
  console.log(`Karaoke server running at http://localhost:${PORT}`);
});

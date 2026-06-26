# YouTube Karaoke

A self-hosted karaoke system with a controller interface and a display mode for connecting to a TV or monitor.

## Setup

1. Clone the repository
2. Copy the environment file:
   ```bash
   cp .env.default .env
   ```
3. Get a YouTube Data API v3 key:
   1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
   2. Create a new project (or select an existing one)
   3. Enable the **YouTube Data API v3** under "APIs & Services > Library"
   4. Go to **Credentials** → "Create credentials" → **API key**
   5. (Recommended) Restrict the key to HTTP referrers for your domains
4. Add your API key to `.env`:
   ```
   YOUTUBE_API_KEY=your_google_api_key_here
   ```

## Running

Start the development server:
```bash
npm install
npm run dev
```

The server runs at `http://localhost:3000`.

## Using on Multiple Devices

For the best experience, run the app on two devices:

### Controller (tablet or phone)

Open the controller page to search for songs and manage the queue:
```
http://<server-ip>:3000/
```

### Display (TV or monitor)

Open the display page on a TV, monitor, or projector to show the currently playing video:
```
http://<server-ip>:3000/player.html
```

Both pages connect to the same server via Server-Sent Events, so the queue and now-playing state are synchronized in real time.

## How It Works

- The controller page (`index.html`) provides a search interface and queue management
- The display page (`player.html`) shows the currently playing YouTube video with a queue footer
- The queue state is synchronized between devices using SSE
- Songs are automatically queued when added to an empty queue
- A queue footer on the display shows upcoming songs with the currently playing song highlighted

## YouTube API Quota

The free YouTube Data API v3 tier provides **10,000 units per day**:

| Endpoint | Cost |
|---|---|
| `search.list` (search) | **100 units** per query |
| `videos.list` (metadata check) | **1 unit** per batch (up to 20 IDs) |

At 100 units per search, a free key allows about **100 searches per day**. If you hit the limit, the quota resets at midnight UTC.

### Channel Restrictions

Search is limited to two channels by default: **SingKing** and **KaraFun**. To add or change channels, edit the `ALLOWED_CHANNELS` array in `server.js`.

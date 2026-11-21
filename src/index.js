require('dotenv').config();
const express = require('express');
const { execFile } = require('child_process');
const youtubeRoutes = require('./routes/youtube.routes');
const authenticate = require('./middleware/auth');

const app = express();
app.disable('x-powered-by');

delete process.env.PYTHONPATH;
delete process.env.PYTHONHOME;

// Keep yt-dlp fresh (YouTube changes often)
execFile('yt-dlp', ['-U'], (err, stdout) => {
  if (err) console.warn('yt-dlp update failed:', err.message);
  else console.log('yt-dlp update:', String(stdout).trim());
});

if (!process.env.API_KEY) {
  console.error('API_KEY is not set. Protected routes will refuse every request.');
}

app.use(express.json({ limit: '10kb' }));

// Health check only. Reveals nothing.
app.get('/', (req, res) => res.json({ status: 'ok' }));

// Token-based stream route (no API key header; the signed token is the auth)
app.use('/', youtubeRoutes.publicRouter);

// Everything under /api needs the API key
app.use('/api', authenticate, youtubeRoutes.privateRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));

process.on('SIGINT', () => process.exit(0));

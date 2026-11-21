const express = require('express');
const crypto = require('crypto');
const { Readable } = require('stream');
const {
  extractYoutubeId, isVideoId, isQuality, getVideoInfo, getDirectUrl
} = require('../utils/youtube-processor');

const privateRouter = express.Router();
const publicRouter = express.Router();

const TOKEN_TTL_MS = 10 * 60 * 1000;
const QUALITIES = ['720p', '480p', '360p', 'audio'];

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', process.env.API_KEY).update(data).digest('base64url');

function makeToken(videoId, quality) {
  const body = b64(JSON.stringify({ i: videoId, q: quality, e: Date.now() + TOKEN_TTL_MS }));
  return body + '.' + sign(body);
}

function readToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const good = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p || p.e < Date.now() || !isVideoId(p.i) || !isQuality(p.q)) return null;
    return p;
  } catch (e) {
    return null;
  }
}

// POST /api/prepare  { url }  (needs X-API-Key; called by your Vercel backend only)
privateRouter.post('/prepare', async (req, res) => {
  try {
    const videoId = extractYoutubeId((req.body || {}).url);
    if (!videoId) return res.status(400).json({ error: 'Invalid YouTube link' });

    const info = await getVideoInfo(videoId);
    res.json({
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration,
      tokens: QUALITIES.map((q) => ({ quality: q, token: makeToken(videoId, q) }))
    });
  } catch (e) {
    console.error('prepare error:', e.message);
    res.status(502).json({ error: 'Could not fetch this video' });
  }
});

// GET /s/:token  (no header; the signed, expiring token is the auth)
publicRouter.options('/s/:token', (req, res) => {
  setCors(res);
  res.status(204).end();
});

function setCors(res) {
  const origin = process.env.SITE_ORIGIN;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  }
}

publicRouter.get('/s/:token', async (req, res) => {
  const t = readToken(req.params.token);
  if (!t) return res.status(403).json({ error: 'Link expired or invalid' });

  try {
    const url = await getDirectUrl(t.i, t.q);
    const range = req.headers.range;
    const upstream = await fetch(url, { headers: range ? { Range: range } : {} });
    if (!upstream.ok && upstream.status !== 206) {
      return res.status(502).json({ error: 'Source refused the request' });
    }

    setCors(res);
    res.status(upstream.status);
    ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach((h) => {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    });
    if (!upstream.body) return res.end();

    const stream = Readable.fromWeb(upstream.body);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch (e) {
    console.error('stream error:', e.message);
    if (!res.headersSent) res.status(502).json({ error: 'Stream failed' });
  }
});

module.exports = { privateRouter, publicRouter };

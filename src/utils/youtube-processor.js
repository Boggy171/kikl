const { execFile } = require('child_process');

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

// Onlkky these values are ever passed to yt-dlp as a format
const QUALITY_PRESETS = {
  audio: 'bestaudio[ext=m4a]/bestaudio',
  '1080p': 'best[height<=1080][ext=mp4]/best[height<=1080]/best',
  '720p': 'best[height<=720][ext=mp4]/best[height<=720]/best',
  '480p': 'best[height<=480][ext=mp4]/best[height<=480]/best',
  '360p': 'best[height<=360][ext=mp4]/best[height<=360]/best'
};

const isVideoId = (id) => VIDEO_ID.test(String(id || ''));
const isQuality = (q) => Object.prototype.hasOwnProperty.call(QUALITY_PRESETS, q);

// Extract the 11-char id from a YouTube URL (or return null)
function extractYoutubeId(input) {
  try {
    const u = new URL(String(input));
    const host = u.hostname.replace(/^(www\.|m\.)/, '');
    let id = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com') {
      if (u.searchParams.get('v')) id = u.searchParams.get('v');
      else {
        const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([^/?]+)/);
        if (m) id = m[2];
      }
    }
    return isVideoId(id) ? id : null;
  } catch (e) {
    return null;
  }
}

// Max 2 yt-dlp processes at once so a free instance does not choke
let running = 0;
const waiting = [];
const acquire = () => new Promise((resolve) => {
  if (running < 2) { running++; resolve(); } else waiting.push(resolve);
});
const release = () => {
  const next = waiting.shift();
  if (next) next(); else running--;
};

// Optional extra flags from the YTDLP_ARGS env var (example: --js-runtimes node)
const EXTRA_ARGS = (process.env.YTDLP_ARGS || '').split(' ').filter(Boolean);

function runYtDlp(args) {
  return new Promise(async (resolve, reject) => {
    await acquire();
    execFile(
      'yt-dlp',
      ['--no-check-certificates', '--no-warnings', '--no-playlist', ...EXTRA_ARGS, ...args],
      { timeout: 60000, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout, stderr) => {
        release();
        if (err) {
          console.error('yt-dlp stderr:', String(stderr || err.message).slice(0, 1500));
          return reject(new Error('yt-dlp failed'));
        }
        resolve(stdout);
      }
    );
  });
}

const watchUrl = (id) => 'https://www.youtube.com/watch?v=' + id;

async function getVideoInfo(videoId) {
  if (!isVideoId(videoId)) throw new Error('Invalid video id');
  const out = await runYtDlp(['-j', '--skip-download', watchUrl(videoId)]);
  const info = JSON.parse(out);
  return {
    title: info.title,
    thumbnail: info.thumbnail,
    duration: info.duration
  };
}

// Resolve the direct media URL (cached ~10 min so Range/seek requests are fast)
const cache = new Map();
async function getDirectUrl(videoId, quality) {
  if (!isVideoId(videoId) || !isQuality(quality)) throw new Error('Invalid request');
  const key = videoId + ':' + quality;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.url;

  const out = await runYtDlp(['-f', QUALITY_PRESETS[quality], '-g', watchUrl(videoId)]);
  const lines = out.trim().split('\n').filter(Boolean);
  const url = quality === 'audio' ? lines[0] : lines[lines.length - 1];
  if (!url) throw new Error('No media url');

  cache.set(key, { url, exp: Date.now() + 10 * 60 * 1000 });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return url;
}

module.exports = { extractYoutubeId, isVideoId, isQuality, getVideoInfo, getDirectUrl, QUALITY_PRESETS };

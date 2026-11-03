// "Your video is ready" emails show the customer's own video: a short looping GIF made from it, with a play mark,
// over a blurred still of the same frame (the same look as our hero header). Its first frame doubles as the thumbnail,
// which is also saved as a JPEG and used when the GIF would be too heavy for an inbox.
// Local ffmpeg, a few seconds, best effort: if anything fails the email falls back to the built-in hero loop.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PLAY = path.join(__dirname, '..', '..', 'public', 'assets', 'img', 'email', 'play.png');
const MAX_GIF = 380e3;

function run(args, timeoutMs) {
  const stitch = require('../stitch');
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...stitch.guardArgs(args)], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve() : reject(new Error('ffmpeg: ' + err.split('\n').filter(Boolean).slice(-1)[0])); });
  });
}

// The graph: a 330px column of the video (full width for landscape) ping-ponged into a seamless loop, centred on a
// blurred, dimmed still of its first frame, with the play mark low right. One pass writes the GIF and the JPEG.
function graph(colors, dither) {
  return "[0:v]fps=12,scale='if(gt(a,1.18),-2,330)':'if(gt(a,1.18),280,-2)':flags=lanczos,"
    + "crop='if(gt(iw/ih,1.18),min(iw,560),330)':280:(iw-ow)/2:'min(ih*0.08,ih-280)',hqdn3d=1.5:1.5:12:12,split=3[m][r][s];"
    + '[r]reverse[rv];[m][rv]concat=n=2:v=1[mv];'
    + '[s]trim=end_frame=1,scale=560:-2,crop=560:280,gblur=sigma=14,eq=brightness=-0.22:saturation=0.75,noise=alls=8:allf=u,loop=loop=60:size=1,setpts=N/12/TB[bg];'
    + '[bg][mv]overlay=x=(W-w)/2:y=0:shortest=1[c];[c][1:v]overlay=x=W-w-20:y=H-h-18,split[o][j];'
    + `[o]split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=full[p];[b][p]paletteuse=dither=${dither}:diff_mode=rectangle[g]`;
}

// Writes p.gif (the loop, when it fits MAX_GIF) and p.jpg (its first frame) for a local video file into dir.
async function makeFiles(src, dir, duration) {
  const at = Math.max(0, Math.min(1.2, (duration || 5) * 0.15));
  const gif = path.join(dir, 'p.gif'), jpg = path.join(dir, 'p.jpg');
  for (const [secs, colors, dither] of [[0.8, 128, 'bayer:bayer_scale=5'], [0.7, 96, 'none'], [0.6, 64, 'none']]) {
    await run(['-ss', String(at), '-t', String(secs), '-i', src, '-i', PLAY, '-filter_complex', graph(colors, dither),
      '-map', '[g]', '-loop', '0', gif, '-map', '[j]', '-frames:v', '1', '-q:v', '4', jpg], 60e3);
    if (fs.statSync(gif).size <= MAX_GIF) return { gif, jpg };
  }
  return { gif: null, jpg: fs.existsSync(jpg) ? jpg : null };
}

async function forJob(job, videoUrl) {
  const stitch = require('../stitch');
  const media = require('../media');
  if (!videoUrl || !stitch.available() || !fs.existsSync(PLAY)) return {};
  return stitch.withTmpDir(async (dir) => {
    const src = await stitch.localFile(videoUrl, dir, job.user_id);
    const f = await makeFiles(src, dir, stitch.probe(src).duration);
    const out = {};
    if (f.jpg) out.thumb_url = media.save(fs.readFileSync(f.jpg), 'image/jpeg', job.user_id).publicUrl;
    if (f.gif) out.preview_gif = media.save(fs.readFileSync(f.gif), 'image/gif', job.user_id).publicUrl;
    return out;
  });
}

module.exports = { forJob, makeFiles, MAX_GIF };

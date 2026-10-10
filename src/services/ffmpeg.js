import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../utils/errors.js';
import { formatTime } from '../utils/time.js';

function run(cmd, args, { timeoutMs = 10 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(
        err.code === 'ENOENT'
          ? new AppError(`${cmd} is not installed. On a Mac run: brew install ffmpeg`, 500, 'FFMPEG_MISSING')
          : err,
      );
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      const why = signal ? `killed (${signal})` : `exit code ${code}`;
      const err = new Error(`${cmd} failed (${why}): ${stderr.trim().split('\n').slice(-3).join(' | ')}`);
      err.stderr = stderr;
      reject(err);
    });
  });
}

/** Reads duration and resolution. Throws a friendly 422 for files ffmpeg can't decode. */
export async function probeVideo(file) {
  let info;
  try {
    const { stdout } = await run('ffprobe', [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      file,
    ], { timeoutMs: 30_000 });
    info = JSON.parse(stdout);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      "We couldn't read that video. It may be corrupt or in an unsupported format. Try exporting it again as MP4.",
      422,
      'UNREADABLE_VIDEO',
    );
  }

  const video = (info.streams || []).find((s) => s.codec_type === 'video');
  if (!video) throw new AppError('That file has no video track.', 422, 'NO_VIDEO_TRACK');

  const durationSec = Number(info.format?.duration ?? video.duration);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new AppError("We couldn't work out how long that video is. Try exporting it again as MP4.", 422, 'NO_DURATION');
  }

  return {
    durationSec,
    width: Number(video.width) || undefined,
    height: Number(video.height) || undefined,
    codec: video.codec_name,
  };
}

/**
 * Samples frames from [startSec, startSec + durationSec] at `fps`, downsized
 * (never upscaled) to keep image tokens down. Seeking with -ss before -i
 * resets timestamps to 0, and ffmpeg's fps filter puts output frame i at
 * i / fps, so frame i is at clip time startSec + i / fps.
 */
export async function sampleFrames(file, outDir, { fps, width, startSec = 0, durationSec }) {
  await mkdir(outDir, { recursive: true });
  const args = ['-v', 'error', '-ss', Math.max(0, startSec).toFixed(3), '-i', file];
  if (durationSec) args.push('-t', durationSec.toFixed(3));
  // width null = keep full resolution (used before cropping around a person)
  const filter = width ? `fps=${fps},scale='min(${width},iw)':-2` : `fps=${fps}`;
  args.push('-vf', filter, '-q:v', width ? '4' : '2', path.join(outDir, 'frame_%05d.jpg'));
  await run('ffmpeg', args);

  const names = (await readdir(outDir)).filter((f) => f.endsWith('.jpg')).sort();
  return names.map((name, i) => {
    const seconds = Math.max(0, startSec) + i / fps;
    return { index: i, path: path.join(outDir, name), seconds, label: formatTime(seconds) };
  });
}

/** Average luma (0–255) across the clip, sampled at 1 fps on tiny frames. Cheap and deterministic. */
export async function measureBrightness(file) {
  const { stdout } = await run('ffmpeg', [
    '-v', 'error',
    '-i', file,
    '-vf', 'fps=1,scale=160:-2,signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=-',
    '-f', 'null',
    '-',
  ], { timeoutMs: 120_000 });
  const values = [...stdout.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Cuts [startSec, endSec] into a small MP4 (no audio) for the incident report. */
export async function cutClip(file, startSec, endSec, outPath) {
  await mkdir(path.dirname(outPath), { recursive: true });
  const start = Math.max(0, startSec);
  const duration = Math.max(0.5, endSec - start);
  await run('ffmpeg', [
    '-v', 'error',
    '-y',
    '-ss', start.toFixed(2),
    '-i', file,
    '-t', duration.toFixed(2),
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '26',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outPath,
  ]);
  return outPath;
}

/**
 * Re-encodes a video as H.264 so browsers can play it. OpenCV/supervision write
 * "mp4v" by default, which Chrome and Safari won't play in a <video> tag.
 */
export async function transcodeForWeb(input, outPath) {
  await mkdir(path.dirname(outPath), { recursive: true });
  await run('ffmpeg', [
    '-v', 'error',
    '-y',
    '-i', input,
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outPath,
  ]);
  return outPath;
}

import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import fetch from 'node-fetch';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }
  try {
    const { fields, files } = await parseForm(req);
    const params = JSON.parse(fields.params || '{}');
    const vid = files.video;
    const videoFile = Array.isArray(vid) ? vid[0] : vid;
    if (!videoFile) { res.status(400).send('No video file'); return; }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vercel-vid-'));
    const inVideoPath = path.join(tmpDir, 'in.mp4');
    const framePath = path.join(tmpDir, 'frame.png');

    const srcPath = videoFile.filepath || videoFile.path || videoFile.tempFilePath;
    fs.copyFileSync(srcPath, inVideoPath);

    const fr = await fetch(JSON.parse(fields.params).frameUrl);
    if (!fr.ok) { cleanup(); res.status(400).send('Could not fetch frame image: ' + fr.status); return; }
    fs.writeFileSync(framePath, Buffer.from(await fr.arrayBuffer()));

    const p = JSON.parse(fields.params);
    const canvasW = Math.round(Number(p.canvasW || 1080));
    const canvasH = Math.round(Number(p.canvasH || 1350));
    const scaleFactor = Number(p.scale || 1);
    const posX = Math.round(Number(p.posX || 0));
    const posY = Math.round(Number(p.posY || 0));
    const rotationDeg = Number(p.rotationDeg || 0);
    const angleRad = ((rotationDeg % 360) * Math.PI) / 180;

    const filter =
      `[0:v]scale=iw*${scaleFactor}:ih*${scaleFactor},` +
      `rotate=${angleRad}:ow=rotw(iw):oh=roth(ih):c=white@0,` +
      `pad=${canvasW}:${canvasH}:${posX}:${posY}:color=white[vv];` +
      `[vv][1:v]overlay=0:0:format=auto[out]`;

    const args = [
      '-hide_banner','-y',
      '-i', inVideoPath,
      '-i', framePath,
      '-filter_complex', filter,
      '-map', '[out]',
      '-r', '30',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-preset', 'veryfast',
      '-an',
      'pipe:1'
    ];

    const ff = spawn(ffmpegPath.path, args);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'no-store');
    let stderr = '';
    ff.stderr.on('data', d => { stderr += d.toString(); });
    ff.stdout.pipe(res);
    ff.on('close', code => {
      cleanup();
      if (code !== 0) { try { if (!res.headersSent) res.status(500).send('ffmpeg failed'); } catch {} console.error(stderr); }
    });

    function cleanup(){
      try { fs.unlinkSync(inVideoPath); } catch {}
      try { fs.unlinkSync(framePath); } catch {}
      try { fs.rmdirSync(tmpDir); } catch {}
    }
  } catch (e) { console.error(e); res.status(500).send('Server error'); }
}

function parseForm(req){
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({ multiples: false, keepExtensions: true });
    form.parse(req, (err, fields, files) => err ? reject(err) : resolve({ fields, files }));
  });
}

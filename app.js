import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import vm from 'vm';
import { time } from 'console';
import { fileURLToPath } from 'url';
import { Innertube, Platform } from 'youtubei.js';
import rateLimit from 'express-rate-limit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;

const PCName = "miani"; // PCのユーザー名

const DROPBOX_DIR = 'C:/Users/' + PCName + '/Dropbox';
const IO_FILE = path.join(DROPBOX_DIR, 'yt.txt');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'リクエストが多すぎます。しばらく待ってください。' },
});
app.use('/api/', limiter);

let yt;
(async () => {
  try {
    Platform.shim.eval = async (data, env) => {
      const props = [];
      if (env.n) props.push(`n: exportedVars.nFunction("${env.n}")`);
      if (env.sig) props.push(`sig: exportedVars.sigFunction("${env.sig}")`);
      const code = `(function(){\n${data.output}\nreturn { ${props.join(', ')} }\n})()`;
      return vm.runInNewContext(code);
    };
    yt = await Innertube.create();
    console.log('Innertube 初期化完了');
    console.log('---------------------------------------');
    main();
  } catch (err) {
    console.error('Innertube 初期化失敗:', err.message);
  }
})();

const formatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  dateStyle: 'medium',
  timeStyle: 'medium'
});

function gettime() {
  return formatter.format(new Date());
}


function extractVideoId(input) {
  const match = input.match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  return null;
}

async function decipherUrl(format) {
  const raw = await format.decipher(yt.session.player);
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  return raw.url ?? null;
}

function main() {
  if (!fs.existsSync(IO_FILE)) fs.writeFileSync(IO_FILE, '');

  console.log('Dropbox監視開始:', IO_FILE);

  fs.watchFile(IO_FILE, { interval: 2000 }, async () => {
    const content = fs.readFileSync(IO_FILE, 'utf8').trim(); 
    if (!content) return;

    const videoId = extractVideoId(content);
    if (!videoId) return;

    console.log('URL検知:', content);
    console.log('動画ID:', videoId);
    console.log('処理開始:', gettime());
    console.log('---------------------------------------');


    try {
      const info = await yt.getInfo(videoId);
      const format = (info.streaming_data?.formats ?? [])
        .filter(f => f.mime_type?.includes('video/mp4'))
        .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];

      if (!format) {
        fs.writeFileSync(IO_FILE, 'エラー: フォーマットが見つかりません');
        return;
      }

      const videoUrl = await decipherUrl(format);
      if (!videoUrl) {
        fs.writeFileSync(IO_FILE, 'エラー: URL取得失敗');
        return;
      }

      fs.writeFileSync(IO_FILE, `${gettime()} \n ${videoUrl}`); // 成功したURLを書き込む
      console.log('完了:', videoUrl);
    } catch (err) {
      fs.writeFileSync(IO_FILE, '例外: ' + err.message);
    }
  });
}

function requireYt(req, res, next) {
  if (!yt) return res.status(503).json({ error: 'サーバー初期化中です。少し待ってから再試行してください。' });
  next();
}

app.get('/api/video-url', requireYt, async (req, res) => {
  const videoId = extractVideoId(req.query.url ?? '');
  if (!videoId) return res.status(400).json({ error: 'URLが正しくありません' });

  try {
    const info = await yt.getInfo(videoId);
    const format = (info.streaming_data?.formats ?? [])
      .filter(f => f.mime_type?.includes('video/mp4'))
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];

    if (!format) return res.status(404).json({ error: 'フォーマットが見つかりません' });

    const videoUrl = await decipherUrl(format);
    if (!videoUrl) return res.status(500).json({ error: 'URL取得失敗' });

    const d = info.basic_info;
    res.json({
      title: d.title,
      thumbnail: d.thumbnail?.[0]?.url ?? '',
      duration: d.duration,
      height: format.height,
      mimeType: format.mime_type,
      videoUrl,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/info', requireYt, async (req, res) => {
  const videoId = extractVideoId(req.query.url ?? '');
  if (!videoId) return res.status(400).json({ error: 'URLが正しくありません' });

  try {
    const info = await yt.getInfo(videoId);
    const allFormats = [
      ...(info.streaming_data?.formats ?? []),
      ...(info.streaming_data?.adaptive_formats ?? []),
    ];

    const urls = await Promise.all(
      allFormats
        .filter(f => f.mime_type?.includes('video/mp4'))
        .map(async f => ({
          itag: f.itag,
          height: f.height ?? null,
          mimeType: f.mime_type,
          url: await decipherUrl(f),
        }))
    );

    res.json({ urls: urls.filter(f => f.url) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



app.listen(PORT, () => console.log(`${gettime()} - http://localhost:${PORT}`));
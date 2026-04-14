import path from 'path';
import fs from 'fs';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { Innertube, Platform } from 'youtubei.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PCName = "miani"; // PCのユーザー名

const DROPBOX_DIR = 'C:/Users/' + PCName + '/Dropbox';
const IO_FILE = path.join(DROPBOX_DIR, 'yt.txt');

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

async function getFormat(info, useHighestQuality) {
  const formats = (info.streaming_data?.formats ?? [])
    .filter(f => f.mime_type?.includes('video/mp4'))
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

  if (useHighestQuality) {
    // -t: 720p固定
    const format720p = formats.find(f => f.height === 720);
    return format720p || formats[0];
  } else {
    // 通常: できる限り高画質
    return formats[0];
  }
}

function main() {
  if (!fs.existsSync(IO_FILE)) fs.writeFileSync(IO_FILE, '');

  console.log('Dropbox監視開始:', IO_FILE);

  fs.watchFile(IO_FILE, { interval: 2000 }, async () => {
    const content = fs.readFileSync(IO_FILE, 'utf8').trim(); 
    if (!content) return;
    const useHighestQuality = content.endsWith('-t');
    const urlToProcess = useHighestQuality ? content.slice(0, -2).trim() : content;

    const videoId = extractVideoId(urlToProcess);
    if (!videoId) return;

    console.log('URL検知:', content);
    console.log('動画ID:', videoId);
    console.log('処理開始:', gettime());
    console.log('---------------------------------------');

    try {
      const info = await yt.getInfo(videoId);
      let formats = (info.streaming_data?.formats ?? [])
        .filter(f => f.mime_type?.includes('video/mp4'))
        .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

      if (formats.length === 0) {
        fs.writeFileSync(IO_FILE, 'エラー: フォーマットが見つかりません');
        return;
      }
      const format = useHighestQuality ? formats[0] : (formats[1] || formats[0]);

      const videoUrl = await decipherUrl(format);
      if (!videoUrl) {
        fs.writeFileSync(IO_FILE, 'エラー: URL取得失敗');
        return;
      }

      fs.writeFileSync(IO_FILE, `${gettime()} \n ${videoUrl}`);
      console.log('完了:', videoUrl);
    } catch (err) {
      fs.writeFileSync(IO_FILE, '例外: ' + err.message);
    }
  });
}
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const YT = createRequire(import.meta.url)('../src/youtube-util.js');

const ID = 'dQw4w9WgXcQ';

test('nhận các dạng link YouTube hợp lệ', () => {
  const ok = [
    ID,
    `https://www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/watch?v=${ID}&t=42s&list=PLx`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}?feature=share`,
    `  https://www.youtube.com/watch?v=${ID}  `,
  ];
  for (const s of ok) assert.equal(YT.parseYouTubeId(s), ID, s);
});

test('từ chối host lạ, scheme lạ, ID sai, kiểu lừa userinfo', () => {
  const bad = [
    '', '   ', null, undefined, 42, {},
    'https://evil.com/watch?v=' + ID,
    `https://youtube.com.evil.com/watch?v=${ID}`,
    `https://evilyoutube.com/watch?v=${ID}`,
    `https://youtube.com@evil.com/watch?v=${ID}`,
    `https://user:pw@www.youtube.com/watch?v=${ID}`,
    `javascript:alert(1)//youtu.be/${ID}`,
    `file:///C:/x/${ID}`,
    `ftp://www.youtube.com/watch?v=${ID}`,
    'https://www.youtube.com/watch?v=short',
    `https://www.youtube.com/watch?v=${ID}extra`,
    'https://www.youtube.com/watch?v="><script>alert(1)</script>',
    'https://www.youtube.com/playlist?list=PLabc',
    'https://www.youtube.com/',
    'x'.repeat(400),
  ];
  for (const s of bad) assert.equal(YT.parseYouTubeId(s), null, String(s).slice(0, 60));
});

test('embedUrl chỉ dựng từ ID sạch, luôn trỏ youtube-nocookie', () => {
  const u = new URL(YT.embedUrl(ID));
  assert.equal(u.origin, 'https://www.youtube-nocookie.com');
  assert.equal(u.pathname, '/embed/' + ID);
  assert.equal(u.searchParams.get('enablejsapi'), '1');
  assert.equal(YT.embedUrl('../../evil'), null);
  assert.equal(YT.embedUrl(`${ID}"onload="x`), null);
  assert.equal(YT.isValidId(ID), true);
  assert.equal(YT.isValidId(ID + 'a'), false);
});

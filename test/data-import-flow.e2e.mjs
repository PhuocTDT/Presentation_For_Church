// E2E (app Electron thật, bản sao KHÔNG có data/ như bản phát hành):
//  1) Người dùng CŨ đã có dữ liệu (bài hát, Kinh Thánh, cài đặt, media) → mở bản mới vẫn chạy bình thường.
//  2) Luồng import bài hát (JSON/TXT/DOCX) và Kinh Thánh (XML), kiểm tra dữ liệu, loại trùng, file mẫu.
//   node --test test/data-import-flow.e2e.mjs      (mất ~1 phút, mở cửa sổ Electron)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeAppCopy, launchApp, instanceUserDataDir, removeInstanceUserData } from './_e2e-app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TPL = path.join(ROOT, 'templates', 'import');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pfc-e2e-files-'));
const instances = [];
const copies = [];
const newInstance = () => { const id = 'e2e-' + Math.random().toString(36).slice(2, 8); instances.push(id); return id; };

after(() => {
  for (const c of copies) { try { c.cleanup(); } catch (e) { console.error('cleanup app copy:', e.message); } }
  for (const id of instances) { try { removeInstanceUserData(id); } catch (e) { console.error('cleanup userData:', e.message); } }
  if (work.includes('pfc-e2e-files-')) fs.rmSync(work, { recursive: true, force: true });
});

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const w = (name, content) => { const p = path.join(work, name); fs.writeFileSync(p, content); return p; };

// ─────────────────────────────────────────────────────────────────────────────
test('người dùng CŨ có dữ liệu sẵn: bản mới (không đóng gói data) vẫn nạp và chạy bình thường', async () => {
  const instanceId = newInstance();
  const ud = instanceUserDataDir(instanceId);
  fs.mkdirSync(path.join(ud, 'bible-versions'), { recursive: true });
  fs.mkdirSync(path.join(ud, 'media'), { recursive: true });

  const seededSongs = [1, 2, 3].map((n) => ({
    id: 1700000000000 + n, type: 'song', title: `Bài cũ số ${n}`, lyrics: `Lời bài cũ ${n} dòng 1\nDòng 2\n\nSlide hai của bài ${n}`,
    style: { fontFamily: 'CMG Sans', fontSize: '72px', color: '#ffeeaa' }, background: null
  }));
  fs.writeFileSync(path.join(ud, 'songs.json'), JSON.stringify(seededSongs));
  fs.copyFileSync(path.join(TPL, 'bible.sample.xml'), path.join(ud, 'bible-versions', 'Ban_Cu.xml'));
  // sổ đăng ký bản dịch kiểu bản cũ: có bản đang dùng + một mục trỏ tới file không còn tồn tại
  fs.writeFileSync(path.join(ud, 'bible-versions.json'), JSON.stringify({
    versions: {
      'Ban_Cu.xml': { displayName: 'Bản cũ', language: 'vi', source: 'bundled', hidden: false },
      'Gone.xml': { displayName: 'Đã mất', language: 'vi', source: 'bundled', hidden: false }
    },
    defaultVersion: 'Gone.xml', order: ['Gone.xml', 'Ban_Cu.xml']
  }));
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ theme: 'light', gpuAcceleration: true }));
  fs.writeFileSync(path.join(ud, 'media', 'anh-cu.png'), PNG_1PX);

  const copy = makeAppCopy(); copies.push(copy);
  assert.ok(!fs.existsSync(path.join(copy.dir, 'data')), 'bản sao phải KHÔNG có thư mục data/');
  const app = await launchApp({ appDir: copy.dir, instanceId });
  try {
    // bài hát cũ còn nguyên (không bị ghi đè/seed lại), kể cả nội dung
    const songs = await app.ev('window.electronAPI.loadSongs()');
    for (const s of seededSongs) {
      const got = songs.find((x) => x.id === s.id);
      assert.ok(got, 'mất bài ' + s.title);
      assert.equal(got.title, s.title); assert.equal(got.lyrics, s.lyrics);
      assert.equal(got.style.color, '#ffeeaa', 'kiểu chữ của bài cũ phải giữ nguyên');
    }
    // Kinh Thánh cũ còn trong danh sách và đọc được; mục trỏ tới file mất không làm hỏng danh sách
    const versions = await app.ev('window.electronAPI.loadBibleVersions()');
    assert.ok(Array.isArray(versions));
    assert.ok(versions.some((v) => v.fileName === 'Ban_Cu.xml'), 'mất bản Kinh Thánh cũ');
    const parsed = await app.ev('window.electronAPI.loadBibleParsed("Ban_Cu.xml")');
    assert.equal(parsed.length, 3, 'phải đọc được 3 chương của file mẫu');
    assert.match(parsed[0].lyrics, /^1 Đây là câu mẫu số một/);
    // cài đặt cũ giữ nguyên
    const settings = await app.ev('window.electronAPI.loadSettings()');
    assert.equal(settings.theme, 'light');
    // media cũ còn
    const media = await app.ev('window.electronAPI.loadMedia()');
    assert.ok(media.some((m) => m.name === 'anh-cu.png'), 'mất media cũ');
    // nút "nạp lại dữ liệu gốc" không được xóa dữ liệu người dùng khi không có gì để nạp
    await app.ev('window.electronAPI.reloadDefaultData()');
    const after = await app.ev('window.electronAPI.loadSongs()');
    assert.ok(seededSongs.every((s) => after.some((x) => x.id === s.id)), 'reloadDefaultData làm mất bài hát của người dùng');
    assert.ok((await app.ev('window.electronAPI.loadBibleVersions()')).some((v) => v.fileName === 'Ban_Cu.xml'));
    // UI: bản không có dữ liệu mẫu ẩn khối "Nạp lại dữ liệu gốc"
    const info = await app.ev('window.electronAPI.getDataPathInfo()');
    assert.equal(info.hasBundledData, false);
    assert.deepEqual(app.exceptions, [], 'renderer có exception: ' + app.exceptions.join(' | '));
    assert.ok(!/Unhandled|TypeError|ReferenceError/.test(app.log()), 'main log có lỗi:\n' + app.log().slice(-800));
  } finally { await app.close(); }
});

// ─────────────────────────────────────────────────────────────────────────────
test('người dùng MỚI (không có gì): app mở sạch, Kinh Thánh trống, có hướng dẫn nhập', async () => {
  const instanceId = newInstance();
  const copy = makeAppCopy(); copies.push(copy);
  const app = await launchApp({ appDir: copy.dir, instanceId });
  try {
    assert.deepEqual(await app.ev('window.electronAPI.loadBibleVersions()'), []);
    const hint = await app.ev(`(function(){
      var btn = Array.from(document.querySelectorAll('button')).find(b => /Tải file mẫu định dạng/.test(b.textContent));
      return { hasTemplateBtn: !!btn, headerImport: !!document.getElementById('header-import-btn') };
    })()`);
    assert.ok(hint.headerImport, 'thiếu nút Import');
    // chuyển sang tab Bible (trống) → phải hiện hướng dẫn nhập + nút tải file mẫu
    await app.ev("(function(){ var t = Array.from(document.querySelectorAll('button')).find(b => /^\\s*Bible\\s*$/i.test(b.textContent)); if (t) t.click(); return !!t; })()");
    await new Promise((r) => setTimeout(r, 800));
    const bibleTab = await app.ev("document.querySelector('tbody') ? document.querySelector('tbody').innerText : ''");
    assert.match(bibleTab, /Chưa có bản dịch Kinh Thánh/, 'tab Bible trống phải hướng dẫn nhập: ' + bibleTab);
    assert.deepEqual(app.exceptions, []);
  } finally { await app.close(); }
});

// ─────────────────────────────────────────────────────────────────────────────
test('import bài hát: JSON (kiểm tra, loại trùng theo nội dung, cấp id mới khi trùng id), TXT, DOCX, file lạ', async () => {
  const instanceId = newInstance();
  const copy = makeAppCopy(); copies.push(copy);
  const app = await launchApp({ appDir: copy.dir, instanceId });
  const importFiles = async (files) => {
    app.pushDialog(files);
    return app.ev(`window.electronAPI.showOpenDialogMulti({ title: 'x' }).then(r => window.electronAPI.importSongsFromFile(r.filePaths))`);
  };
  const titles = async () => (await app.ev('window.electronAPI.loadSongs()')).map((s) => s.title);
  try {
    await app.ev('window.alert = function () {}; true'); // alert() native sẽ treo CDP
    const json = w('songs-mix.json', JSON.stringify([
      { id: 1, type: 'song', title: 'E2E Bài A', lyrics: 'Lời A\n\nSlide 2 A' },
      { id: 1, type: 'song', title: 'E2E Bài B (trùng id với A)', lyrics: 'Lời B' },           // id trùng, nội dung khác → vẫn nhập, id mới
      { id: 3, type: 'song', title: 'e2e bài a', lyrics: 'Lời A\n\nSlide 2 A' },                 // trùng nội dung với A → bỏ qua
      { id: 4, type: 'song', title: 'E2E thiếu lời' },                                           // lỗi
      { id: 5, type: 'bible', title: 'E2E sai loại', lyrics: 'x' },                              // lỗi (không nhập Kinh Thánh qua JSON bài hát)
      'chuỗi lạ'                                                                                 // lỗi
    ]));
    let res = await importFiles([json]);
    assert.equal(res.length, 1);
    assert.deepEqual({ added: res[0].added, skipped: res[0].skipped, invalid: res[0].invalid, total: res[0].total }, { added: 2, skipped: 1, invalid: 3, total: 6 });
    const songs = await app.ev('window.electronAPI.loadSongs()');
    const a = songs.find((s) => s.title === 'E2E Bài A'), b = songs.find((s) => s.title === 'E2E Bài B (trùng id với A)');
    assert.ok(a && b); assert.notEqual(a.id, b.id, 'hai bài phải có id khác nhau');
    assert.equal(a.style.fontFamily, 'CMG Sans', 'thiếu style → dùng mặc định');
    // nhập lại đúng file → không nhân đôi
    res = await importFiles([json]);
    assert.deepEqual({ added: res[0].added, skipped: res[0].skipped }, { added: 0, skipped: 3 });
    assert.equal((await titles()).filter((t) => t === 'E2E Bài A').length, 1);

    // dạng bọc { "songs": [...] }
    res = await importFiles([w('songs-wrapped.json', JSON.stringify({ songs: [{ title: 'E2E Bọc', lyrics: 'Lời bọc' }] }))]);
    assert.equal(res[0].added, 1);

    // file mẫu đi kèm app nhập được đúng như hướng dẫn
    res = await importFiles([path.join(TPL, 'songs.sample.json')]);
    assert.deepEqual({ added: res[0].added, invalid: res[0].invalid }, { added: 2, invalid: 0 });
    const sample = (await app.ev('window.electronAPI.loadSongs()')).find((s) => s.title.startsWith('Bài hát mẫu 2'));
    assert.deepEqual(sample.background, { mediaName: 'ten-file-anh-nen.jpg', mediaType: 'image' });

    // TXT: tên file = tên bài, lời = nội dung (qua luồng renderer importSongsFromFile)
    app.pushDialog([path.join(TPL, 'songs.sample.txt')]);
    await app.ev('importSongsFromFile()');
    const txtSong = (await app.ev('window.electronAPI.loadSongs()')).find((s) => s.title === 'songs.sample');
    assert.ok(txtSong, 'TXT phải thành bài hát (tên bài = tên file)');
    assert.match(txtSong.lyrics, /Dòng lời 1 của slide thứ nhất/);
    // nhập lại cùng file TXT → bỏ qua vì trùng, không nhân đôi
    app.pushDialog([path.join(TPL, 'songs.sample.txt')]);
    await app.ev('importSongsFromFile()');
    assert.equal((await titles()).filter((t) => t === 'songs.sample').length, 1);
    // DOCX tối thiểu, tạo bằng jszip (đã là phụ thuộc production của app). KHÔNG được bỏ qua âm thầm.
    const JSZip = createRequire(import.meta.url)(path.join(ROOT, 'node_modules', 'jszip'));
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Lời trong docx dòng một</w:t></w:r></w:p><w:p><w:r><w:t>Dòng hai</w:t></w:r></w:p></w:body></w:document>');
    const docx = path.join(work, 'E2E Bài docx.docx');
    fs.writeFileSync(docx, await zip.generateAsync({ type: 'nodebuffer' }));
    res = await importFiles([docx]);
    assert.equal(res.length, 1);
    assert.equal(res[0].type, undefined, 'docx bị từ chối: ' + JSON.stringify(res[0]));
    assert.match(res[0].lyrics, /Lời trong docx dòng một/);
    assert.match(res[0].lyrics, /Dòng hai/);
    assert.equal(res[0].title, 'E2E Bài docx');

    // file định dạng lạ và JSON hỏng phải được BÁO, không im lặng
    res = await importFiles([w('x.pdf', 'pdf'), w('hong.json', '{ not json')]);
    assert.equal(res.length, 2);
    assert.ok(res.every((r) => r.type === 'rejected'), JSON.stringify(res));
    assert.match(res[0].reason, /không hỗ trợ/i);
    assert.match(res[1].reason, /JSON không hợp lệ/);

    // chỉ có tên (không có lời) trong object lẻ → renderer coi là lỗi, không lưu bài rỗng
    assert.ok(!(await titles()).includes('E2E không lời'));
    assert.deepEqual(app.exceptions, [], app.exceptions.join(' | '));
  } finally { await app.close(); }
});

// ─────────────────────────────────────────────────────────────────────────────
test('import Kinh Thánh XML: nhận file đúng định dạng, từ chối file sai/độc hại, báo trùng tên, xuất file mẫu', async () => {
  const instanceId = newInstance();
  const copy = makeAppCopy(); copies.push(copy);
  const app = await launchApp({ appDir: copy.dir, instanceId });
  const ud = instanceUserDataDir(instanceId);
  try {
    // 1) file đúng định dạng (bản mẫu đi kèm app)
    const good = w('Ban_Dich_Thu.xml', fs.readFileSync(path.join(TPL, 'bible.sample.xml')));
    app.pushDialog([good]);
    let r = await app.ev('window.electronAPI.importBibleVersion()');
    assert.equal(r.success, true, JSON.stringify(r));
    assert.equal(r.fileName, 'Ban_Dich_Thu.xml');
    assert.ok((await app.ev('window.electronAPI.loadBibleVersions()')).some((v) => v.fileName === 'Ban_Dich_Thu.xml'));
    const parsed = await app.ev('window.electronAPI.loadBibleParsed("Ban_Dich_Thu.xml")');
    assert.equal(parsed.length, 3);
    assert.equal(parsed[2].type, 'bible');

    // 2) cùng tên file → từ chối, không ghi đè
    app.pushDialog([good]);
    r = await app.ev('window.electronAPI.importBibleVersion()');
    assert.equal(r.success, false); assert.match(r.error, /Đã tồn tại/);

    // 3) file không phải Kinh Thánh → từ chối VÀ không được chép vào thư mục dữ liệu
    app.pushDialog([w('Khong_Phai_Kinh_Thanh.xml', '<?xml version="1.0"?><root><item>x</item></root>')]);
    r = await app.ev('window.electronAPI.importBibleVersion()');
    assert.equal(r.success, false); assert.match(r.error, /không đúng định dạng/);
    assert.ok(!fs.existsSync(path.join(ud, 'bible-versions', 'Khong_Phai_Kinh_Thanh.xml')), 'file sai vẫn bị chép vào thư mục dữ liệu');

    // 4) có sách nhưng thiếu chương/câu → từ chối với lý do cụ thể
    app.pushDialog([w('Thieu_Chuong.xml', '<XMLBIBLE><BIBLEBOOK bnumber="1"></BIBLEBOOK></XMLBIBLE>')]);
    r = await app.ev('window.electronAPI.importBibleVersion()');
    assert.equal(r.success, false); assert.match(r.error, /CHAPTER/);
    app.pushDialog([w('Thieu_Cau.xml', '<XMLBIBLE><BIBLEBOOK bnumber="1"><CHAPTER cnumber="1"></CHAPTER></BIBLEBOOK></XMLBIBLE>')]);
    r = await app.ev('window.electronAPI.importBibleVersion()');
    assert.equal(r.success, false); assert.match(r.error, /VERS/);

    // 5) file độc hại: hàng chục nghìn thẻ sách không có chương → phải trả lời nhanh (không treo)
    const evil = w('Doc_Hai.xml', '<XMLBIBLE>' + '<BIBLEBOOK bnumber="1">'.repeat(60000) + '</XMLBIBLE>');
    app.pushDialog([evil]);
    const t0 = Date.now();
    r = await app.ev('window.electronAPI.importBibleVersion()');
    assert.equal(r.success, false);
    assert.ok(Date.now() - t0 < 5000, 'kiểm tra file độc hại quá chậm: ' + (Date.now() - t0) + 'ms');

    // 6) đuôi không phải .xml
    app.pushDialog([w('bible.txt', 'x')]);
    r = await app.ev('window.electronAPI.importBibleVersion()');
    assert.equal(r.success, false);

    // 7) xuất file mẫu ra thư mục tùy chọn, và các file mẫu nhập lại được
    const outParent = path.join(work, 'out-templates'); fs.mkdirSync(outParent);
    app.pushDialog([outParent]);
    const ex = await app.ev('window.electronAPI.exportImportTemplates()');
    assert.equal(ex.success, true, JSON.stringify(ex));
    for (const f of ['songs.sample.json', 'songs.sample.txt', 'bible.sample.xml', 'HUONG-DAN-NHAP-DU-LIEU.md']) {
      assert.ok(fs.existsSync(path.join(ex.path, f)), 'thiếu ' + f);
    }
    assert.deepEqual(app.exceptions, [], app.exceptions.join(' | '));
  } finally { await app.close(); }
});

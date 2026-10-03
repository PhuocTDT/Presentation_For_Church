// Khởi động relay LOCAL cho e2e: wrangler dev dùng entry test (cloud/worker/test/relay-test-entry.js).
//   node test/start-test-relay.mjs [port=28787] [persistDir]
// Sinh cloud/worker/wrangler.test.toml từ wrangler.toml thật (chỉ đổi name + main) để không bị lệch cấu hình.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(ROOT, 'cloud', 'worker');
const port = process.argv[2] || '28787';
const persist = process.argv[3] || path.join(dir, '.wrangler', 'test-state');
let toml = fs.readFileSync(path.join(dir, 'wrangler.toml'), 'utf8');
if (!/^main\s*=\s*"src\/worker\.js"/m.test(toml)) throw new Error('wrangler.toml: không thấy main = "src/worker.js"');
toml = toml.replace(/^main\s*=\s*"src\/worker\.js"/m, 'main = "test/relay-test-entry.js"').replace(/^name\s*=\s*".*"/m, 'name = "band-comm-relay-test"');
fs.writeFileSync(path.join(dir, 'wrangler.test.toml'), toml);
const child = spawn('npx', ['wrangler', 'dev', '-c', 'wrangler.test.toml', '--local', '--port', port, '--persist-to', persist], { cwd: dir, stdio: 'inherit', shell: true });
child.on('exit', (c) => process.exit(c || 0));

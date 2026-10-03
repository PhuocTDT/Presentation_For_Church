// Entry CHỈ DÙNG KHI TEST (`node test/start-test-relay.mjs`, tức wrangler dev local) — KHÔNG nằm trong
// bản deploy (wrangler.toml thật vẫn trỏ main = src/worker.js).
//
// Vì sao cần: relay thật chỉ cho CHỦ PHÒNG (Cognito ID token hợp lệ + bản ghi phòng ở identity) tạo/chiếm
// phòng (B-19, room-relay.js handleAdminConfig). Test e2e dựng phòng ngẫu nhiên nên không có Cognito.
// Entry này chỉ ghi đè ĐÚNG MỘT hàm — bearerIsRoomOwner — để coi mọi Bearer token là chủ phòng; mọi
// logic bảo mật khác (adminSecret, token thành viên, hạn mức…) giữ nguyên để test vẫn có giá trị.
import worker from '../src/worker.js';
import { RoomRelay as RealRoomRelay } from '../src/room-relay.js';

export class RoomRelay extends RealRoomRelay {
  async bearerIsRoomOwner(bearerToken) { return !!bearerToken; }
}
export default worker;

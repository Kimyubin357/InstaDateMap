/* 시안 A — 공용 렌더러: 표본 데이터 · 지도 투영 · 묶음 계산 · 화면 조립 · 겹침 검사
   외부 라이브러리·네트워크 없음. 각 시퀀스 페이지가 LAB.sequence({...})를 부릅니다. */
(function () {
'use strict';

/* ---------- 기기 크기·안전영역 ---------- */
const SIZES = {
  p320: { key: 'p320', w: 320, h: 568, o: 'p', compact: 1, kb: 253, label: '세로 320×568' },
  p393: { key: 'p393', w: 393, h: 852, o: 'p', compact: 0, kb: 336, label: '세로 393×852' },
  l568: { key: 'l568', w: 568, h: 320, o: 'l', compact: 1, side: 236, panel: 292, kb: 160, label: '가로 568×320' },
  l667: { key: 'l667', w: 667, h: 375, o: 'l', compact: 1, side: 264, panel: 320, kb: 194, label: '가로 667×375' },
  l844: { key: 'l844', w: 844, h: 390, o: 'l', compact: 0, side: 320, panel: 400, kb: 200, label: '가로 844×390' },
  l932: { key: 'l932', w: 932, h: 430, o: 'l', compact: 0, side: 340, panel: 420, kb: 216, label: '가로 932×430' },
};
const SAFE = { p: { t: 59, b: 34, l: 0, r: 0 }, l: { t: 0, b: 21, l: 59, r: 59 } };
const FF = 'system-ui,-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif';

/* ---------- 상태·사람 ---------- */
const ST = { want: '가고 싶음', visited: '다녀옴', again: '또 갈래', meh: '별로' };
const ST_KEYS = ['want', 'visited', 'again', 'meh'];
const ST_RANK = { want: 0, again: 1, visited: 2, meh: 3 };
const BY = { Y: '유빈 저장', J: '지수 저장', B: '둘 다 저장' };

/* ---------- 표본 장소 25곳 (성수동 12 · 서울 기타 12 · 부산 1) ---------- */
const LONGMEMO = '주말엔 웨이팅이 1시간 넘는대. 오픈 10시 전에 가면 2층 테라스 자리 잡을 수 있음. 지수는 바질 크림치즈 베이글, 나는 소금 버터 크루아상. 서울숲 산책하고 와도 좋을 듯. 주차 안 되니까 성수역 4번 출구로.';
const S = (o) => Object.assign({ sido: '', gu: '성동구', dong: '성수동', src: 1, col: [], memo: '' }, o);
const BASE = [
  S({ id: 1, name: '모노하 성수', kind: '카페', st: 'want', by: 'Y', lat: 37.5447, lng: 127.0557, road: '연무장길 41', h: 72, memo: '2층 창가 자리 좋대. 평일 오후에 가기', col: ['성수 카페'] }),
  S({ id: 2, name: '할머니 손칼국수', kind: '음식점', st: 'visited', by: 'B', lat: 37.5441, lng: 127.0571, road: '성수이로 88', h: 900, memo: '겉절이 최고. 현금만 받음', src: 0 }),
  S({ id: 3, name: '성수 우드앤브릭 베이커리 앤 브런치 카페 서울숲 본점', kind: '카페', st: 'want', by: 'J', lat: 37.5452, lng: 127.0546, road: '서울숲2길 32-14', h: 30, memo: LONGMEMO, src: 2, col: ['성수 카페', '기념일 후보'] }),
  S({ id: 4, name: '서울숲 피크닉 마켓', kind: '', st: 'want', by: 'Y', lat: 37.5437, lng: 127.0420, road: '뚝섬로 273', h: 300 }),
  S({ id: 5, name: '연무장길 수제버거', kind: '음식점', st: 'again', by: 'B', lat: 37.5430, lng: 127.0590, road: '연무장5길 9', h: 500, memo: '더블 치즈 + 감튀 반반' }),
  S({ id: 6, name: '뚝도시장 떡볶이', kind: '음식점', st: 'meh', by: 'Y', lat: 37.5425, lng: 127.0478, road: '광나루로 51', h: 700, memo: '너무 달았음', src: 0 }),
  S({ id: 7, name: '성수 아틀리에 전시관', kind: '전시', st: 'want', by: 'J', lat: 37.5468, lng: 127.0600, road: '성수일로 77', h: 100, memo: '12월까지 사진전' }),
  S({ id: 8, name: '그레이 하우스 커피', kind: '카페', st: 'visited', by: 'J', lat: 37.5459, lng: 127.0563, road: '아차산로 17', h: 400, col: ['성수 카페'] }),
  S({ id: 9, name: '성수 양조장', kind: '술집', st: 'want', by: 'Y', lat: 37.5476, lng: 127.0520, road: '성덕정길 120', h: 200 }),
  S({ id: 10, name: '서울숲 4번출구 파스타', kind: '음식점', st: 'again', by: 'J', lat: 37.5445, lng: 127.0445, road: '서울숲길 44', h: 650, memo: '기념일에 또 가자' }),
  S({ id: 11, name: '필름 사진관 성수', kind: '', st: 'want', by: 'Y', lat: 37.5434, lng: 127.0548, road: '성수이로7길 26', h: 400, src: 0 }),
  S({ id: 12, name: '카페 소금빵', kind: '카페', st: 'want', by: 'J', lat: 37.5462, lng: 127.0582, road: '연무장7길 11', h: 10, memo: '오픈런 해야 한대! 11시 전에', col: ['성수 카페'] }),
  S({ id: 13, name: '딩티엔 용산아이파크몰점', kind: '음식점', st: 'visited', by: 'B', lat: 37.5296, lng: 126.9648, gu: '용산구', dong: '한강로동', road: '한강대로23길 55', h: 1200, memo: '샤오롱바오 2판' }),
  S({ id: 14, name: '연남 토마', kind: '음식점', st: 'want', by: 'Y', lat: 37.5627, lng: 126.9244, gu: '마포구', dong: '연남동', road: '동교로 253', h: 150, col: ['기념일 후보'] }),
  S({ id: 15, name: '연남 책방 카페', kind: '카페', st: 'again', by: 'J', lat: 37.5605, lng: 126.9221, gu: '마포구', dong: '연남동', road: '성미산로 161', h: 800, memo: '조용해서 좋았음' }),
  S({ id: 16, name: '망원 한강 피크닉 스팟', kind: '', st: 'want', by: 'J', lat: 37.5585, lng: 126.9010, gu: '마포구', dong: '망원동', road: '마포나루길 467', h: 9, memo: '돗자리 챙기기' }),
  S({ id: 17, name: '을지로 노가리 골목', kind: '술집', st: 'want', by: 'Y', lat: 37.5660, lng: 126.9910, gu: '중구', dong: '을지로동', road: '을지로13길 19', h: 220 }),
  S({ id: 18, name: '익선동 수제맥주 펍', kind: '술집', st: 'want', by: 'Y', lat: 37.5743, lng: 126.9895, gu: '종로구', dong: '익선동', road: '수표로28길 21', h: 220 }),
  S({ id: 19, name: '한남 와인바', kind: '술집', st: 'again', by: 'B', lat: 37.5355, lng: 127.0010, gu: '용산구', dong: '한남동', road: '이태원로 242', h: 600, col: ['기념일 후보'] }),
  S({ id: 20, name: '서촌 그림책 전시', kind: '전시', st: 'visited', by: 'J', lat: 37.5800, lng: 126.9700, gu: '종로구', dong: '효자동', road: '자하문로 61', h: 1000 }),
  S({ id: 21, name: '석촌호수 산책길', kind: '', st: 'visited', by: 'B', lat: 37.5090, lng: 127.1000, gu: '송파구', dong: '잠실동', road: '잠실로 148', h: 2000, src: 0 }),
  S({ id: 22, name: '길상사', kind: '', st: 'want', by: 'Y', lat: 37.5995, lng: 126.9950, gu: '성북구', dong: '성북동', road: '선잠로5길 68', h: 1500, memo: '가을 단풍 때', src: 0 }),
  S({ id: 23, name: '이태원 타코', kind: '음식점', st: 'meh', by: 'J', lat: 37.5345, lng: 126.9940, gu: '용산구', dong: '이태원동', road: '보광로 120', h: 1300 }),
  S({ id: 24, name: '해운대 돼지국밥', kind: '음식점', st: 'want', by: 'B', lat: 35.1630, lng: 129.1600, sido: '부산', gu: '해운대구', dong: '우동', road: '해운대해변로 197', h: 3000, memo: '부산 여행 때' }),
  S({ id: 25, name: '망원시장 고로케', kind: '음식점', st: 'visited', by: 'Y', lat: 37.5560, lng: 126.9060, gu: '마포구', dong: '망원동', road: '포은로8길 14', h: 1100, src: 0 }),
];
const EXTRA = {
  bagel: S({ id: 26, name: '한남 베이글 하우스', kind: '카페', st: 'want', by: 'Y', lat: 37.5372, lng: 127.0045, gu: '용산구', dong: '한남동', road: '대사관로 35', h: 0, src: 0 }),
};
const sidoOf = (p) => p.sido || '서울';
const IDS = {
  all: BASE.map((p) => p.id),
  seoul: BASE.filter((p) => !p.sido).map((p) => p.id),
  seongsu: BASE.filter((p) => p.dong === '성수동').map((p) => p.id),
};

/* ---------- 작은 도구 ---------- */
const uniq = (a) => [...new Set(a)];
const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isNew = (p) => p.h < 24;
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const ago = (h) => (h < 1 ? '방금' : h < 24 ? `${h}시간 전` : h < 48 ? '어제' : `${Math.floor(h / 24)}일 전`);
const measure = (() => { const c = document.createElement('canvas').getContext('2d'); return (t, f) => { c.font = f + ' ' + FF; return c.measureText(t).width; }; })();
const boxC = (x, y, w, h) => ({ l: x - w / 2, t: y - h / 2, r: x + w / 2, b: y + h / 2 });
const ov = (a, b, m = 0) => a.l < b.r + m && b.l < a.r + m && a.t < b.b + m && b.t < a.b + m;
const byStatus = (a, b) => ST_RANK[a.st] - ST_RANK[b.st] || a.h - b.h;

/* ---------- 아이콘·상태 기호 (색 없이 모양으로 구분) ---------- */
const IC = {
  search: '<circle cx="9" cy="9" r="5.5"/><path d="M13 13l4.5 4.5"/>',
  filter: '<path d="M3 5.5h14M5.5 10h9M8 14.5h4"/>',
  gear: '<circle cx="10" cy="10" r="2.6"/><path d="M10 2.6v2.1M10 15.3v2.1M2.6 10h2.1M15.3 10h2.1M4.8 4.8l1.5 1.5M13.7 13.7l1.5 1.5M4.8 15.2l1.5-1.5M13.7 6.3l1.5-1.5"/>',
  locate: '<circle cx="10" cy="10" r="5"/><circle cx="10" cy="10" r="1.4" fill="currentColor"/><path d="M10 2.2v2.6M10 15.2v2.6M2.2 10h2.6M15.2 10h2.6"/>',
  fit: '<path d="M3 7.5V3h4.5M12.5 3H17v4.5M17 12.5V17h-4.5M7.5 17H3v-4.5"/><rect x="7" y="7" width="6" height="6" rx="1"/>',
  plus: '<path d="M10 3.5v13M3.5 10h13"/>',
  map: '<path d="M2.5 5l5-2 5 2 5-2v12l-5 2-5-2-5 2z"/><path d="M7.5 3v12M12.5 5v12"/>',
  list: '<path d="M7 5h10M7 10h10M7 15h10"/><path d="M3 5h.5M3 10h.5M3 15h.5"/>',
  close: '<path d="M5 5l10 10M15 5L5 15"/>',
  left: '<path d="M12.5 3.5L6 10l6.5 6.5"/>',
  right: '<path d="M7.5 3.5L14 10l-6.5 6.5"/>',
  route: '<path d="M5 17.5V10a3 3 0 0 1 3-3h7.5"/><path d="M12.5 4l3 3-3 3"/>',
  copy: '<rect x="7" y="7" width="9.5" height="10.5" rx="1.5"/><path d="M4 13.5V4.5A1.5 1.5 0 0 1 5.5 3H12"/>',
  pin: '<path d="M10 18s5.5-5.2 5.5-9.6a5.5 5.5 0 0 0-11 0C4.5 12.8 10 18 10 18z"/><circle cx="10" cy="8.4" r="2"/>',
  ext: '<path d="M11.5 3H17v5.5M17 3l-7.5 7.5M14.5 12v4.5a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V6.5A.5.5 0 0 1 4 6h4.5"/>',
  trash: '<path d="M3.5 6h13M8 6V3.8h4V6M5.2 6l1 11.2h7.6l1-11.2"/>',
  folder: '<path d="M2.8 6.2V15a1 1 0 0 0 1 1h12.4a1 1 0 0 0 1-1V7.9a1 1 0 0 0-1-1H9.6L8 5H3.8a1 1 0 0 0-1 1.2z"/>',
  camera: '<rect x="3" y="3" width="14" height="14" rx="4"/><circle cx="10" cy="10" r="3.2"/><path d="M14 6h.01"/>',
  pending: '<circle cx="10" cy="10" r="7.2"/><path d="M10 5.8V10l2.8 2"/>',
  check: '<path d="M4.5 10.5l3.5 3.5 7.5-8"/>',
  edit: '<path d="M4 16.3l.9-3.8 8.6-8.6 2.9 2.9-8.6 8.6z"/><path d="M11.8 5.6l2.9 2.9"/>',
  plusbox: '<rect x="3" y="3" width="14" height="14" rx="3"/><path d="M10 6.5v7M6.5 10h7"/>',
};
const icon = (n, s = 20) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]}</svg>`;
function glyph(st, size = 18) {
  const a = `class="gl" width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true"`;
  switch (st) {
    case 'want': return `<svg ${a}><circle cx="10" cy="10" r="7.3" fill="#fff" stroke="#111" stroke-width="2.8"/></svg>`;
    case 'visited': return `<svg ${a}><circle cx="10" cy="10" r="9" fill="#111"/><path d="M5.8 10.3l2.9 2.9 5.6-6" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case 'again': return `<svg ${a}><circle cx="10" cy="10" r="9" fill="#111"/><path d="M10 15.2C10 15.2 4.8 12 4.8 8.7 4.8 7.1 6 5.9 7.5 5.9c1 0 1.9.6 2.5 1.4.6-.8 1.5-1.4 2.5-1.4 1.5 0 2.7 1.2 2.7 2.8 0 3.3-5.2 6.5-5.2 6.5z" fill="#fff"/></svg>`;
    case 'meh': return `<svg ${a}><circle cx="10" cy="10" r="8" fill="#e2e2e2" stroke="#444" stroke-width="1.8" stroke-dasharray="2.4 1.9"/><path d="M6.2 10h7.6" stroke="#222" stroke-width="2.4" stroke-linecap="round"/></svg>`;
  }
  return '';
}
const NEWT = '<i class="newt">NEW</i>';

/* ---------- 지도 투영 (위도·경도 → km → 화면) ---------- */
const LAT0 = 37.55, LNG0 = 127.0, KX = 88.2, KY = 111.0;
const toKm = (lat, lng) => ({ x: (lng - LNG0) * KX, y: (LAT0 - lat) * KY });
const kmOf = (p) => toKm(p.lat, p.lng);
const KOREA = [[38.61, 128.36], [38.2, 128.6], [37.8, 128.95], [37.45, 129.18], [37.0, 129.42], [36.4, 129.47], [35.95, 129.56], [35.55, 129.45], [35.25, 129.3], [35.13, 129.22], [35.05, 128.95], [34.88, 128.55], [34.75, 127.75], [34.55, 127.3], [34.35, 126.55], [34.75, 126.3], [35.35, 126.45], [35.95, 126.65], [36.3, 126.5], [36.85, 126.2], [37.05, 126.75], [37.35, 126.6], [37.6, 126.6], [37.75, 126.7], [37.95, 126.68], [38.3, 127.3], [38.33, 127.9]];
const HAN = [[37.62, 126.75], [37.595, 126.82], [37.575, 126.86], [37.556, 126.885], [37.545, 126.91], [37.532, 126.935], [37.522, 126.955], [37.517, 126.975], [37.519, 126.995], [37.525, 127.015], [37.531, 127.035], [37.534, 127.05], [37.532, 127.065], [37.526, 127.08], [37.527, 127.095], [37.535, 127.11], [37.55, 127.125], [37.57, 127.16]];
const ROADS = [
  [[37.566, 126.86], [37.566, 127.14]], [[37.5455, 126.93], [37.5455, 127.14]], [[37.62, 126.9965], [37.49, 126.9965]],
  [[37.63, 127.045], [37.48, 127.045]], [[37.61, 126.915], [37.53, 126.975]], [[37.505, 126.94], [37.505, 127.14]],
  [[37.59, 126.92], [37.59, 127.09]], [[37.63, 127.075], [37.48, 127.075]], [[37.6, 126.955], [37.49, 126.955]],
];

function mapSVG(cfg, view, sc) {
  const W = cfg.w, H = cfg.h, s = view.s;
  const P = (ll) => { const k = toKm(ll[0], ll[1]); return [(view.ox + k.x * s).toFixed(1), (view.oy + k.y * s).toFixed(1)]; };
  const path = (pts) => pts.map((ll, i) => (i ? 'L' : 'M') + P(ll).join(' ')).join('');
  let g = `<rect width="${W}" height="${H}" fill="#f1f1f1"/>`;
  g += `<path d="${path(KOREA)}Z" fill="#e0e0e0" stroke="#c8c8c8" stroke-width="1"/>`;
  if (s > 250) { // 골목 블록
    const x0 = (0 - view.ox) / s, x1 = (W - view.ox) / s, y0 = (0 - view.oy) / s, y1 = (H - view.oy) / s, step = 0.11;
    const sw = s > 900 ? 4 : 2;
    for (let i = Math.floor(x0 / step); i <= Math.ceil(x1 / step); i++) { const x = (view.ox + (i * step + (i % 3) * 0.018) * s).toFixed(1); g += `<path d="M${x} 0V${H}" stroke="#f3f3f3" stroke-width="${sw}"/>`; }
    for (let j = Math.floor(y0 / step); j <= Math.ceil(y1 / step); j++) { const y = (view.oy + (j * step + (j % 2) * 0.025) * s).toFixed(1); g += `<path d="M0 ${y}H${W}" stroke="#f3f3f3" stroke-width="${sw}"/>`; }
  }
  if (s > 4) { const rw = s < 40 ? 1.5 : s < 250 ? 3 : 7; ROADS.forEach((r) => { g += `<path d="${path(r)}" stroke="#fafafa" stroke-width="${rw}" fill="none" stroke-linecap="round"/>`; }); }
  g += `<path d="${path(HAN)}" stroke="#c4c4c4" stroke-width="${Math.max(2, 0.9 * s).toFixed(1)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${g}</svg>`;
}

/* ---------- 묶음 계산 ----------
   규칙(시안 A):
   1) 1곳은 절대 숫자로 바꾸지 않는다 → 상태 기호 표시물.
   2) 묶음은 ‘지역 이름 + 곳 수 + 가고 싶음 수’ 이름표. 이름은 구성원이 공유하는 가장 작은 행정구역.
   3) 표시물의 터치 영역(44)이 8px 안으로 겹칠 때만 묶는다(화면 거리 기준). 넓은 지역·구 단계에서만.
   4) 동네·가게 단계는 묶지 않고 모든 장소를 기호로 두고, 이름표만 우선순위로 일부 생략.
   5) 선택한 장소·방금 저장한 장소(집중)는 어느 단계에서도 묶지 않는다. 새 장소(24h)는 따로 두되
      묶음과 겹치면 그 묶음에 ‘NEW n’ 꼬리표로 붙는다. */
function stageOf(s) { return s < 8 ? 'wide' : s < 70 ? 'gu' : s < 700 ? 'neigh' : 'store'; }
const STAGE_KO = { wide: '넓은 지역', gu: '구', neigh: '동네', store: '가게' };

function regionName(ps, ctx) {
  const dongs = uniq(ps.map((p) => sidoOf(p) + p.gu + p.dong));
  if (dongs.length === 1) return ps[0].dong;
  const cnt = {}; ps.forEach((p) => { const k = sidoOf(p) + '|' + p.gu; cnt[k] = (cnt[k] || 0) + 1; });
  const gus = Object.entries(cnt).sort((a, b) => b[1] - a[1]).map((e) => e[0].split('|'));
  if (gus.length === 1) return gus[0][1];
  const sidos = uniq(ps.map(sidoOf));
  if (sidos.length === 1) {
    const total = ctx.visible.filter((p) => sidoOf(p) === sidos[0]).length;
    if (ps.length >= total || gus.length > 3) return sidos[0];
    if (gus.length === 2) return gus[0][1].replace(/구$/, '') + '·' + gus[1][1];
    return gus[0][1].replace(/구$/, '') + ' 일대';
  }
  const sc = {}; ps.forEach((p) => { sc[sidoOf(p)] = (sc[sidoOf(p)] || 0) + 1; });
  return Object.entries(sc).sort((a, b) => b[1] - a[1])[0][0] + ' 외';
}
function pillInfo(ms, ctx) {
  const ps = ms.map((q) => q.p);
  const name = regionName(ps, ctx), n = ps.length, want = ps.filter((p) => p.st === 'want').length, nw = ps.filter(isNew).length;
  const line2 = want === n ? '모두 가고 싶음' : want === 0 ? '모두 다녀옴' : `가고 싶음 ${want}`;
  const w = Math.ceil(Math.max(measure(name, '700 13px') + 5 + measure(String(n), '800 15px'), measure(line2, '600 11px'))) + 20;
  return { name, n, want, nw, line2, w };
}
function mkItem(ms, ctx) {
  if (ms.length === 1) { const q = ms[0]; return { kind: 'dot', ms, x: q.x, y: q.y, box: boxC(q.x, q.y, 44, 44) }; }
  const x = avg(ms.map((q) => q.x)), y = avg(ms.map((q) => q.y)), info = pillInfo(ms, ctx);
  return Object.assign({ kind: 'pill', ms, x, y, box: boxC(x, y, info.w, 44) }, info);
}
function greedy(pts, R) {
  const arr = [...pts].sort((a, b) => a.y - b.y || a.x - b.x), used = new Set(), out = [];
  for (const a of arr) {
    if (used.has(a)) continue; const g = [a]; used.add(a);
    for (const b of arr) if (!used.has(b) && Math.hypot(a.x - b.x, a.y - b.y) < R) { g.push(b); used.add(b); }
    out.push(g);
  }
  return out;
}
function mergeLoop(items, ctx) {
  let changed = true, guard = 0;
  while (changed && guard++ < 300) {
    changed = false;
    outer: for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      if (ov(items[i].box, items[j].box, 8)) { const m = mkItem(items[i].ms.concat(items[j].ms), ctx); items.splice(j, 1); items.splice(i, 1, m); changed = true; break outer; }
    }
  }
  return items;
}
function displace(it, hards, items) {
  const ox = it.x, oy = it.y; let best = null;
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    for (let d = 4; d <= 200; d += 4) {
      const x = ox + dx * d, y = oy + dy * d, b = boxC(x, y, it.w, 44);
      if (!hards.some((h) => ov(b, h.box, 8)) && !items.some((o) => o !== it && ov(b, o.box, 8))) { if (!best || d < best.d) best = { x, y, d, b }; break; }
    }
  }
  if (best) { it.anchor = { x: ox, y: oy }; it.x = best.x; it.y = best.y; it.box = best.b; }
}
function labelSize(txt, nw, sel) {
  const w = measure(txt, sel ? '800 13px' : '650 12px') + (sel ? 14 : 12) + (sel ? 4 : 2) + (nw ? measure('NEW', '800 9px') + 6 + 4 : 0);
  return { w: Math.ceil(w) + 1, h: sel ? 26 : 22 };
}
function priority(p, sc) {
  if (sc.sel === p.id) return 1000; if ((sc.focus || []).includes(p.id)) return 900; if (isNew(p)) return 800;
  return { want: 500, again: 400, visited: 300, meh: 200 }[p.st] - p.h / 100000;
}

function layoutMarkers(ctx, view, stage, sc, cfg, R) {
  const W = cfg.w, H = cfg.h, LB = R ? { l: R.x - 6, t: R.y - 6, r: R.x + R.w + 6, b: R.y + R.h + 6 } : { l: 2, t: 2, r: W - 2, b: H - 2 };
  const hard = new Set([...(sc.focus || []), ...(sc.sel ? [sc.sel] : [])]);
  const pts = ctx.visible.map((p) => { const k = kmOf(p); return { p, x: view.ox + k.x * view.s, y: view.oy + k.y * view.s }; });
  const rest = pts.filter((q) => !hard.has(q.p.id)), hardPts = pts.filter((q) => hard.has(q.p.id));
  let items;
  if (stage === 'wide' || stage === 'gu') {
    const soft = rest.filter((q) => isNew(q.p)), normal = rest.filter((q) => !isNew(q.p));
    items = mergeLoop(greedy(normal, 50).map((ms) => mkItem(ms, ctx)), ctx);
    for (const q of soft) {
      const b = boxC(q.x, q.y, 44, 44), hit = items.find((it) => it.kind === 'pill' && ov(b, it.box, 8));
      if (hit) { hit.ms.push(q); Object.assign(hit, pillInfo(hit.ms, ctx)); hit.box = boxC(hit.x, hit.y, hit.w, 44); } else items.push(mkItem([q], ctx));
    }
    items = mergeLoop(items, ctx);
  } else {
    // 동네·가게 단계: 묶지 않는다. 기호가 겹칠 만큼 가까우면(26px) 둘레로 펼치고 실제 위치에 점선을 잇는다.
    items = [];
    for (const g of greedy(rest, 30)) {
      if (g.length === 1) { items.push(mkItem(g, ctx)); continue; }
      const cx = avg(g.map((q) => q.x)), cy = avg(g.map((q) => q.y)), rad = 14 + 5 * g.length;
      g.forEach((q, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / g.length, x = cx + rad * Math.cos(a), y = cy + rad * Math.sin(a); items.push({ kind: 'dot', ms: [q], x, y, box: boxC(x, y, 44, 44), spider: { x: q.x, y: q.y } }); });
    }
  }
  // 선택·집중 표시끼리 겹치면 같은 방식으로 둘레에 펼친다(번호가 서로 가리지 않게)
  const hardItems = [];
  for (const g of greedy(hardPts, 40)) {
    if (g.length === 1) { const q = g[0]; hardItems.push({ kind: 'dot', ms: [q], x: q.x, y: q.y, hard: true, box: boxC(q.x, q.y, 44, 44) }); continue; }
    const cx = avg(g.map((q) => q.x)), cy = avg(g.map((q) => q.y)), rad = 18 + 6 * g.length;
    g.forEach((q, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / g.length, x = cx + rad * Math.cos(a), y = cy + rad * Math.sin(a); hardItems.push({ kind: 'dot', ms: [q], x, y, hard: true, box: boxC(x, y, 44, 44), spider: { x: q.x, y: q.y } }); });
  }
  for (const it of items) if (it.kind === 'pill' && hardItems.some((h) => ov(it.box, h.box, 8))) displace(it, hardItems, items);
  const all = items.concat(hardItems);
  // 이름표: 우선순위(선택 > 집중 > NEW > 가고 싶음 > 또 갈래 > 다녀옴 > 별로)로 겹치지 않는 것만
  const obstacles = all.map((it) => (it.kind === 'pill' ? { it, b: it.box } : { it, b: boxC(it.x, it.y, sc.sel === it.ms[0].p.id ? 40 : 28, sc.sel === it.ms[0].p.id ? 40 : 28) }));
  const maxc = { wide: 9, gu: 9, neigh: 9, store: 14 }[stage];
  const dots = all.filter((it) => it.kind === 'dot').map((it) => ({ it, p: it.ms[0].p, pri: priority(it.ms[0].p, sc) })).sort((a, b) => b.pri - a.pri);
  const labels = [];
  for (const d of dots) {
    const sel = sc.sel === d.p.id, forced = hard.has(d.p.id);
    if (d.it.x < -60 || d.it.x > W + 60 || d.it.y < -60 || d.it.y > H + 60) continue;
    const nw = isNew(d.p), r = sel ? 21 : 15;
    const tryPlace = (txt, strict) => {
      const { w, h } = labelSize(txt, nw, sel);
      const cands = [[d.it.x + r, d.it.y - h / 2], [d.it.x - r - w, d.it.y - h / 2], [d.it.x - w / 2, d.it.y + r], [d.it.x - w / 2, d.it.y - r - h]];
      for (const [x, y] of cands) {
        const b = { l: x, t: y, r: x + w, b: y + h };
        if (b.l < LB.l || b.r > LB.r || b.t < LB.t || b.b > LB.b) continue;
        if (strict && (obstacles.some((o) => o.it !== d.it && ov(b, o.b, 2)) || labels.some((l) => ov(b, l.b, 2)))) continue;
        return { x, y, b, txt };
      }
      return null;
    };
    const full = trunc(d.p.name, sel ? 16 : forced ? 11 : maxc);
    // 선택·집중 장소는 이름표를 반드시 붙이되, 자리가 없으면 글자를 줄여서라도 지도 영역 안에 둔다
    let placed = tryPlace(full, true) || (forced && tryPlace(trunc(d.p.name, 7), true)) || (sel && (tryPlace(full, false) || tryPlace(trunc(d.p.name, 7), false)));
    if (!placed && sel) { const t = trunc(d.p.name, 7), { w, h } = labelSize(t, nw, sel); placed = { x: d.it.x - w / 2, y: d.it.y + r, b: { l: d.it.x - w / 2, t: d.it.y + r, r: d.it.x + w / 2, b: d.it.y + r + h }, txt: t }; }
    if (placed) labels.push(Object.assign(placed, { nw, sel, d }));
  }
  return { all, labels };
}

function drawMarkers(dev, ctx, view, stage, sc, cfg, R) {
  const { all, labels } = layoutMarkers(ctx, view, stage, sc, cfg, R);
  const focus = sc.focus ? new Set(sc.focus) : null;
  const nums = new Map((sc.numbered || []).map((id, i) => [id, i + 1]));
  const dimOf = (it) => (focus && !it.ms.some((q) => focus.has(q.p.id)) ? ' dim' : '');
  let html = '', lines = '';
  for (const it of all) {
    if (it.x < -120 || it.x > cfg.w + 120 || it.y < -120 || it.y > cfg.h + 120) continue;
    const dim = dimOf(it);
    if (it.kind === 'pill') {
      if (it.anchor) lines += `<line x1="${it.anchor.x}" y1="${it.anchor.y}" x2="${it.x}" y2="${it.y}" stroke="#111" stroke-width="1.5" stroke-dasharray="3 3" class="${dim}"/><circle cx="${it.anchor.x}" cy="${it.anchor.y}" r="3" fill="#111" class="${dim}"/>`;
      html += `<div class="mk pill${dim}" data-g="${esc(it.name)}" data-ids="${it.ms.map((q) => q.p.id).join(',')}" role="button" aria-label="${esc(it.name)} ${it.n}곳, 가고 싶음 ${it.want}곳${it.nw ? `, 새 장소 ${it.nw}곳` : ''}" style="left:${it.x.toFixed(1)}px;top:${it.y.toFixed(1)}px;width:${it.w}px"><b>${esc(it.name)}<em>${it.n}</em></b><small>${it.line2}</small>${it.nw ? `<i class="newtag">NEW ${it.nw}</i>` : ''}</div>`;
    } else {
      const p = it.ms[0].p, sel = sc.sel === p.id, num = nums.get(p.id);
      if (it.spider) lines += `<line x1="${it.spider.x.toFixed(1)}" y1="${it.spider.y.toFixed(1)}" x2="${it.x.toFixed(1)}" y2="${it.y.toFixed(1)}" stroke="#111" stroke-width="1.2" stroke-dasharray="2 2" class="${dim}"/><circle cx="${it.spider.x.toFixed(1)}" cy="${it.spider.y.toFixed(1)}" r="2.5" fill="#111" class="${dim}"/>`;
      html += `<div class="mk dot${sel ? ' sel' : ''}${num ? ' num' : ''}${dim}" data-p="${p.id}" role="button" aria-label="${esc(p.name)}, ${ST[p.st]}${isNew(p) ? ', 새로 등록' : ''}" style="left:${it.x.toFixed(1)}px;top:${it.y.toFixed(1)}px"><span class="bub">${num ? num : glyph(p.st, sel ? 26 : 20)}</span>${isNew(p) && !num ? '<i class="nb">N</i>' : ''}</div>`;
    }
  }
  for (const l of labels) html += `<div class="lbl${l.sel ? ' sel' : ''}${dimOf(l.d.it)}" style="left:${l.x.toFixed(1)}px;top:${l.y.toFixed(1)}px">${l.nw ? '<i class="new">NEW</i>' : ''}${esc(l.txt)}</div>`;
  dev.querySelector('.mk-layer').innerHTML = (lines ? `<svg class="leader" width="${cfg.w}" height="${cfg.h}">${lines}</svg>` : '') + html;
  return all;
}

/* ---------- 장면 데이터 ---------- */
function makeCtx(sc) {
  let all = BASE.map((p) => Object.assign({}, p));
  if (sc.extra) all = all.concat(sc.extra.map((p) => Object.assign({}, p)));
  if (sc.patch) for (const [id, o] of Object.entries(sc.patch)) { const p = all.find((x) => x.id == id); if (p) Object.assign(p, o); }
  if (sc.empty) all = [];
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  let visible = all;
  if (sc.filter) {
    if (sc.filter.st) visible = visible.filter((p) => sc.filter.st.includes(p.st));
    if (sc.filter.kind) visible = visible.filter((p) => (p.kind || '종류 없음') === sc.filter.kind);
  }
  if (sc.collection) visible = visible.filter((p) => (p.col || []).includes(sc.collection));
  if (sc.hideMarkers) visible = [];
  return { all, byId, visible };
}
function resolveIds(v, ctx) {
  if (v === 'all') return ctx.visible.map((p) => p.id);
  if (v === 'seoul') return ctx.visible.filter((p) => !p.sido).map((p) => p.id);
  if (v === 'seongsu') return ctx.all.filter((p) => p.dong === '성수동').map((p) => p.id);
  return v || [];
}
function groupOrder(ids, ctx) {
  const ps = resolveIds(ids, ctx).map((i) => ctx.byId[i]).filter(Boolean);
  const nw = ps.filter(isNew).sort((a, b) => a.h - b.h), rest = ps.filter((p) => !isNew(p));
  const sections = [];
  if (nw.length) sections.push({ title: '새로 저장', ids: nw.map((p) => p.id) });
  const gus = uniq(rest.map((p) => p.gu));
  if (gus.length > 1) {
    const by = {}; rest.forEach((p) => { (by[p.gu] = by[p.gu] || []).push(p); });
    Object.entries(by).sort((a, b) => b[1].length - a[1].length).forEach(([g, arr]) => sections.push({ title: g, key: 'sec-' + g, ids: arr.sort(byStatus).map((p) => p.id) }));
  } else {
    const w = rest.filter((p) => p.st === 'want').sort(byStatus), o = rest.filter((p) => p.st !== 'want').sort(byStatus);
    if (w.length) sections.push({ title: '가고 싶음', ids: w.map((p) => p.id) });
    if (o.length) sections.push({ title: '다녀온 곳', ids: o.map((p) => p.id) });
  }
  return { sections, flat: sections.flatMap((s) => s.ids), ps };
}

/* ---------- UI 조각 ---------- */
function filterCount(sc) { return sc.filter ? (sc.filter.st ? 1 : 0) + (sc.filter.kind ? 1 : 0) : 0; }
function hdrHTML(sc) {
  const n = filterCount(sc);
  return `<div class="row hdr blk">
    <button class="search hit" data-k="search" aria-label="저장한 장소와 새 장소 검색">${icon('search', 18)}<span class="ell">장소·주소 검색</span></button>
    <button class="ibtn hit${n ? ' on' : ''}" data-k="filter" aria-label="필터${n ? `, ${n}개 적용 중` : ''}">${icon('filter', 18)}<small>필터</small>${n ? `<i class="badge">${n}</i>` : ''}</button>
    <button class="ibtn hit" data-k="settings" aria-label="설정">${icon('gear', 18)}<small>설정</small></button></div>`;
}
function chipsHTML(sc, ctx) {
  const c = [];
  if (sc.loading) c.push(`<span class="chip ghost" role="status"><i class="spin"></i>불러오는 중…</span>`);
  if (sc.pending) c.push(`<button class="chip dashed hit" data-k="pending" aria-label="확인 대기 링크 ${sc.pending}개 이어서 처리">${icon('pending', 16)}확인 대기 ${sc.pending}</button>`);
  if (sc.newChip) c.push(`<button class="chip hit" data-k="newchip" aria-label="새로 저장한 장소 ${sc.newChip}곳 보기">${NEWT}새 장소 ${sc.newChip}</button>`);
  if (sc.filter && sc.filter.st) c.push(`<button class="chip on hit" data-k="chip-st" aria-label="상태 필터 해제">${sc.filter.st.map((s) => ST[s]).join('·')}만<span class="x">✕</span></button>`);
  if (sc.filter && sc.filter.kind) c.push(`<button class="chip on hit" data-k="chip-kind" aria-label="종류 필터 해제">${sc.filter.kind}만<span class="x">✕</span></button>`);
  if (sc.collection) c.push(`<button class="chip on hit" data-k="chip-col" aria-label="모음 보기 해제">${icon('folder', 16)}${sc.collection} ${ctx.visible.length}곳<span class="x">✕</span></button>`);
  return c.join('');
}
function toolsHTML() {
  return `<button class="ibtn hit" data-k="locate" aria-label="내 위치로 이동">${icon('locate', 18)}<small>내 위치</small></button>
    <button class="ibtn hit" data-k="fitall" aria-label="저장한 장소 전체 보기">${icon('fit', 18)}<small>전체</small></button>`;
}
function dockHTML(cfg) {
  const seg = cfg.compact
    ? `<button class="ibtn on hit" data-k="tabmap" aria-pressed="true">${icon('map', 18)}<small>지도</small></button><button class="ibtn hit" data-k="tablist">${icon('list', 18)}<small>리스트</small></button>`
    : `<button class="on hit" data-k="tabmap" aria-pressed="true">${icon('map', 18)}지도</button><button class="hit" data-k="tablist">${icon('list', 18)}리스트</button>`;
  return `<div class="dock blk"><div class="seg" role="group" aria-label="보기 전환">${seg}</div><button class="add primary hit" data-k="add">${icon('plus', 20)}장소 추가</button></div>`;
}
function rcolHTML() {
  return `<div class="rcol blk"><div class="seg v" role="group" aria-label="보기 전환"><button class="ibtn on hit" data-k="tabmap" aria-pressed="true">${icon('map', 18)}<small>지도</small></button><button class="ibtn hit" data-k="tablist">${icon('list', 18)}<small>리스트</small></button></div>
    <div class="rstack">${toolsHTML()}<button class="ibtn addL primary hit" data-k="add" aria-label="장소 추가">${icon('plus', 22)}<small>추가</small></button></div></div>`;
}
// 알림: 동작이 하나면 알림 전체가 하나의 버튼(좁은 가로에서도 44px 이상 한 덩어리)
function toastHTML(t) { return `<div class="toast blk" role="status" aria-live="polite">${t.action ? `<button class="hit tbtn" data-k="toast"><span>${t.text}</span><b>${t.action} ›</b></button>` : `<span class="ttxt">${t.text}</span>`}</div>`; }
function seg4HTML(cur, opt = {}) {
  return `<div class="seg4" role="group" aria-label="상태 바꾸기">${ST_KEYS.map((s) => `<button class="hit${cur === s ? ' on' : ''}" data-k="st-${s}" aria-pressed="${cur === s}"><span class="gw">${glyph(s, 18)}</span>${opt.saving === s ? '<span class="savenote">저장 중…</span>' : ST[s]}</button>`).join('')}</div>`;
}
function rowHTML(p, num) {
  return `<button class="grow hit" data-p="${p.id}">${num ? `<span class="num">${num}</span>` : glyph(p.st, 22)}<span class="gname ell">${esc(p.name)}</span>${isNew(p) ? NEWT : ''}<small class="ell">${num ? ST[p.st] + ' · ' : ''}${p.kind || '종류 없음'} · ${p.dong} · ${BY[p.by]}</small></button>`;
}

function previewHTML(c, ctx, cfg) {
  const p = ctx.byId[c.id], list = c.list === 'seongsuOrder' ? groupOrder('seongsu', ctx).flat : c.list, i = list.indexOf(c.id) + 1;
  const tight = cfg.o === 'l' && cfg.compact, routeTxt = !cfg.compact;
  return `<section class="card preview blk" aria-label="장소 미리보기">
    <div class="crow">${c.ctxLabel ? `<button class="btn ghost back hit" data-k="tolist" aria-label="${c.ctxLabel} 목록으로">${icon('left', 16)}<span class="ell">${c.ctxLabel}</span></button>` : '<span class="sp"></span>'}
      <span class="count" aria-label="${list.length}곳 중 ${i}번째">${i} / ${list.length}</span>
      <button class="ibtn hit" data-k="close" aria-label="미리보기 닫기">${icon('close', 18)}</button></div>
    <div class="pv-status">${glyph(p.st, 16)}<b>${ST[p.st]}</b>${isNew(p) ? NEWT : ''}<span class="ell">· ${BY[p.by]}</span></div>
    <h3 class="pv-name">${esc(p.name)}</h3>
    <div class="pv-meta ell">${p.kind || '종류 없음'} · ${p.gu} ${p.dong}</div>
    ${p.memo ? `<div class="pv-memo ell">“${esc(p.memo)}”</div>` : `<div class="pv-memo empty">메모 없음</div>`}
    <div class="crow acts">
      <button class="ibtn hit" data-k="prev" aria-label="이전 장소">${icon('left', 18)}<small>이전</small></button>
      <button class="ibtn hit" data-k="next" aria-label="다음 장소">${icon('right', 18)}<small>다음</small></button>
      <span class="sp"></span>
      ${routeTxt ? `<button class="btn hit" data-k="route">${icon('route', 18)}길찾기</button>` : `<button class="ibtn hit" data-k="route" aria-label="카카오맵 길찾기">${icon('route', 18)}<small>길찾기</small></button>`}
      <button class="btn primary hit" data-k="detail">${tight && cfg.key === 'l568' ? '상세' : '상세 보기'}</button></div></section>`;
}
function groupHTML(c, ctx, cfg) {
  const g = groupOrder(c.ids, ctx), want = g.ps.filter((p) => p.st === 'want').length, nw = g.ps.filter(isNew).length;
  const body = g.sections.map((s) => (s.key ? `<button class="gsecb hit" data-k="${s.key}" aria-label="${s.title}만 확대">${s.title} ${s.ids.length}곳<span>지도 확대 ›</span></button>` : `<div class="gsec">${s.title}<span>${s.ids.length}</span></div>`) + s.ids.map((id) => rowHTML(ctx.byId[id])).join('')).join('');
  return `<section class="card group blk" aria-label="${c.title} 장소 목록">
    <div class="crow head"><div class="ttl"><b>${c.title} ${g.ps.length}곳</b><small>가고 싶음 ${want}${nw ? ` · NEW ${nw}` : ''}</small></div>
      <button class="ibtn hit" data-k="close" aria-label="목록 닫기">${icon('close', 18)}</button></div>
    <div class="glist scroll">${body}</div></section>`;
}
function tray1HTML(c, ctx) {
  const p = ctx.byId[c.id];
  return `<section class="card tray blk" aria-label="방금 저장한 장소">
    <div class="crow head"><div class="ttl"><b>${icon('check', 16)} ${c.note || '장소를 저장했어요'}</b></div><button class="ibtn hit" data-k="close" aria-label="닫기">${icon('close', 18)}</button></div>
    <div class="tr-name">${NEWT}<span class="ell">${esc(p.name)}</span></div>
    <div class="pv-meta ell">${p.kind || '종류 없음'} · ${p.gu} ${p.dong} · ${BY[p.by]}</div>
    ${p.memo ? `<div class="pv-memo ell">“${esc(p.memo)}”</div>` : ''}
    ${seg4HTML(p.st, c)}
    <div class="crow acts"><button class="btn hit" data-k="memo" style="flex:1">${icon('edit', 16)}${p.memo ? '메모 고치기' : '메모 쓰기'}</button><button class="btn primary hit" data-k="detail" style="flex:1">상세 보기</button></div></section>`;
}
function trayNHTML(c, ctx) {
  const ps = c.ids.map((i) => ctx.byId[i]);
  return `<section class="card group tray blk" aria-label="${c.title}">
    <div class="crow head"><div class="ttl"><b>${icon('check', 16)} ${c.title}</b><small>${c.sub}</small></div><button class="ibtn hit" data-k="close" aria-label="닫기">${icon('close', 18)}</button></div>
    <div class="glist scroll">${ps.map((p, i) => rowHTML(p, c.numbered ? i + 1 : 0)).join('')}</div></section>`;
}
function cardHTML(sc, ctx, cfg) {
  const c = sc.card; if (!c) return '';
  const land = cfg.o === 'l';
  switch (c.type) {
    case 'preview': return previewHTML(c, ctx, cfg);
    case 'group': return groupHTML(c, ctx, cfg);
    case 'tray1': return tray1HTML(c, ctx);
    case 'trayN': return trayNHTML(c, ctx);
    case 'empty': return `<section class="card empty-card blk"><b>아직 저장한 장소가 없어요</b><p>인스타 링크를 붙여 넣거나 장소를 검색해서 첫 곳을 담아 보세요.</p><p><b>${land ? '오른쪽 아래' : '아래'} ＋ 장소 추가</b>에서 시작해요.</p></section>`;
    case 'loadError': return `<section class="card err-card blk" role="alert"><b>장소를 불러오지 못했어요</b><p>인터넷 연결을 확인한 뒤 다시 시도해 주세요.</p><button class="primary hit" data-k="retry">다시 시도</button></section>`;
    case 'mapError': return `<section class="card err-card blk" role="alert"><b>지도를 불러오지 못했어요</b><p>잠시 후 다시 시도하거나, 저장한 장소를 리스트로 볼 수 있어요.</p><div class="crow"><button class="primary hit" data-k="retry" style="flex:1">다시 시도</button><button class="hit btn" data-k="tolist" style="flex:1">리스트로 보기</button></div></section>`;
    case 'zero': return `<section class="card err-card blk" role="status"><b>조건에 맞는 장소가 없어요</b><p>${[sc.filter.st && sc.filter.st.map((s) => ST[s]).join('·'), sc.filter.kind].filter(Boolean).join(' · ')} 조건으로 찾았어요.</p><button class="primary hit" data-k="freset">필터 초기화</button></section>`;
  }
  return '';
}

function filterPanelHTML(sc, ctx, cfg) {
  const f = sc.panel, sel = f.st || null, kind = f.kind || null, all = ctx.all;
  const cnt = (s) => all.filter((p) => p.st === s).length;
  const kinds = ['음식점', '카페', '술집', '전시', '종류 없음'].map((k) => [k, all.filter((p) => (p.kind || '종류 없음') === k).length]);
  const result = ctx.visible.length;
  const body = `<div class="flab">상태 <small>여러 개 고를 수 있어요 · 지도 기호와 같아요</small></div>
    <div class="fgrid"><button class="all hit${!sel ? ' on' : ''}" data-k="fs-all" aria-pressed="${!sel}">전체<small>${all.length}</small></button>
    ${ST_KEYS.map((s) => `<button class="hit${sel && sel.includes(s) ? ' on' : ''}" data-k="fs-${s}" aria-pressed="${!!(sel && sel.includes(s))}"><span class="gw">${glyph(s, 18)}</span>${ST[s]}<small>${cnt(s)}</small></button>`).join('')}</div>
    <div class="flab">종류 <small>하나만 고를 수 있어요</small></div>
    <div class="kinds"><button class="chip hit${!kind ? ' on' : ''}" data-k="fk-all">전체</button>${kinds.map(([k, n]) => `<button class="chip hit${kind === k ? ' on' : ''}" data-k="fk-${k}">${k} ${n}</button>`).join('')}</div>`;
  const foot = `<button class="btn hit" data-k="freset">초기화</button><button class="btn primary hit" data-k="fdone">완료 · 지도에 ${result}곳</button>`;
  const head = `<div class="sh-head"><b>필터</b><button class="ibtn hit" data-k="fclose" aria-label="필터 닫기">${icon('close', 18)}</button></div>`;
  if (cfg.o === 'p') return `<div class="psheet layer blk" role="dialog" aria-label="필터"><div class="grab"></div>${head}<div class="sh-body scroll">${body}</div><div class="sh-foot">${foot}</div></div>`;
  return `<div class="lpanel layer blk" role="dialog" aria-label="필터">${head}<div class="sh-body scroll">${body}</div><div class="sh-foot">${foot}</div></div>`;
}
function detailHTML(sc, ctx, cfg) {
  const d = sc.panel, p = ctx.byId[d.id], st = p.st, land = cfg.o === 'l';
  const memo = d.memo !== undefined ? d.memo : p.memo;
  const head = `<div class="dt-head">${land ? `<button class="btn ghost hit" data-k="back">${icon('left', 16)}미리보기로</button>` : ''}<span class="sp">${land ? '' : '<div class="grab" style="margin-top:0"></div>'}</span><button class="ibtn hit" data-k="close" aria-label="상세 닫기">${icon('close', 18)}</button></div>`;
  const srcs = p.src ? Array.from({ length: p.src }, (_, i) => `<button class="btn srcrow hit" data-k="src${i}"><span>${icon('camera', 18)} 인스타 게시물 ${i + 1}</span>${icon('ext', 16)}</button>`).join('') : '<p class="legend-note">카카오 검색으로 저장해서 원본 게시물이 없어요.</p>';
  const cols = (p.col || []).map((c) => `<span class="chip ghost" style="border-style:solid !important">${icon('folder', 14)}${c}</span>`).join('');
  let note = '';
  if (d.saving) note = `<i class="spin"></i>${ST[d.saving]}(으)로 저장 중…`;
  else if (d.checking) note = `<i class="spin"></i>지수님이 고친 내용이 있는지 확인 중…`;
  else if (d.fail) note = `저장하지 못했어요. 연결을 확인해 주세요.<button class="btn hit" data-k="retry">다시 시도</button>`;
  else if (d.note) note = `${icon('check', 16)}${d.note}`;
  const body = `<div class="dt-scroll scroll">
      <div class="dt-status">${glyph(st, 16)}<b>${ST[st]}</b>${isNew(p) ? NEWT : ''}<span>· ${BY[p.by]} · ${ago(p.h)}</span></div>
      <h2 class="dt-name">${esc(p.name)}</h2>
      <div class="dt-meta">${p.kind || '종류 없음'} · ${sidoOf(p)} ${p.gu} ${p.dong}</div>
      <div class="dt-acts"><button class="hit" data-k="kakao">${icon('route', 20)}카카오맵 길찾기</button><button class="hit" data-k="copy">${icon(d.copied ? 'check' : 'copy', 20)}${d.copied ? '복사했어요' : '주소 복사'}</button><button class="hit" data-k="showmap">${icon('pin', 20)}지도에서 보기</button></div>
      <div class="dt-box"><div class="dt-lab">같이 쓰는 메모<small>${memo ? `${memo.length}/500 · 지수 · 어제 고침` : '0/500'}</small></div>
        ${d.draft ? `<div class="draft">저장하지 않은 초안이 있어요</div>` : ''}
        <p class="memo-txt${memo ? '' : ' empty'}">${memo ? esc(memo) : '둘이 같이 보는 메모를 남겨 보세요.'}</p>
        <button class="btn hit" data-k="memo">${icon('edit', 16)}${memo ? '메모 고치기' : '메모 쓰기'}</button></div>
      <div class="dt-box" style="border-style:dashed"><div class="mini"><span class="pin">${icon('pin', 28)}</span></div><div class="addr">${sidoOf(p)} ${p.gu} ${p.road}</div></div>
      <div><div class="dt-lab" style="margin-bottom:6px">모음</div><div class="kinds">${cols}<button class="chip hit" data-k="addcol">${icon('plusbox', 16)}모음에 담기</button></div></div>
      <div><div class="dt-lab" style="margin-bottom:6px">원본</div><div style="display:flex;flex-direction:column;gap:8px">${srcs}</div></div>
      <button class="btn danger hit" data-k="delete">${icon('trash', 18)}장소 삭제</button>
    </div>
    <div class="dt-bar"><div class="dt-note" aria-live="polite">${note || '<span class="meta">상태는 누르면 바로 저장돼요</span>'}</div>${seg4HTML(st, d)}</div>`;
  if (!land) return `<div class="backdrop"></div><div class="psheet full layer blk" role="dialog" aria-label="장소 상세">${head}${body}</div>`;
  return `<div class="lpanel layer blk" role="dialog" aria-label="장소 상세">${head}${body}</div>`;
}
function editorHTML(sc, ctx, cfg) {
  const e = sc.editor, p = ctx.byId[e.id];
  const keys = e.kb === false ? '' : `<div class="kbd" aria-hidden="true"><div class="kl">키보드</div>${[10, 9, 9, 5].map((n) => `<div class="kr">${'<span></span>'.repeat(n)}</div>`).join('')}</div>`;
  return `<div class="editor layer blk" role="dialog" aria-label="메모 고치기" style="--kbh:${e.kb === false ? 'var(--sb)' : 'var(--kb)'}">
    <div class="ed-head"><button class="btn ghost hit" data-k="edcancel">닫기</button><b class="ell">메모 · ${esc(trunc(p.name, 10))}</b><button class="btn primary hit" data-k="edsave">저장</button></div>
    <div class="ed-area" role="textbox" aria-multiline="true"><div>${esc(e.text)}<span class="caret"></span></div></div>
    <div class="ed-foot"><span>${e.dirty ? '저장 안 됨 · 지수님도 이 메모를 고칠 수 있어요' : ''}</span><span>${e.text.length}/500</span></div></div>${keys}`;
}
function dialogHTML(sc, ctx, cfg) {
  const d = sc.dialog;
  if (d.type === 'unsaved') return `<div class="dlg-back"><div class="dlg layer blk" role="alertdialog" aria-label="저장 확인"><h4>메모를 저장하지 않았어요</h4><p>저장하지 않고 나가면 방금 고친 내용이 사라져요.</p>
    <div class="btns"><button class="btn primary hit" data-k="dlg-save">저장하고 나가기</button><button class="btn hit" data-k="dlg-keep">계속 쓰기</button><button class="btn hit" data-k="dlg-discard" style="border-style:dashed">버리고 나가기</button></div></div></div>`;
  if (d.type === 'delete') return `<div class="dlg-back"><div class="dlg layer blk" role="alertdialog" aria-label="삭제 확인"><h4>이 장소를 지울까요?</h4><p>‘${esc(trunc(ctx.byId[d.id].name, 18))}’이 지도와 리스트에서 사라져요. 지운 장소는 <b>설정 › 지운 장소</b>에서 다시 살릴 수 있어요.</p>
    <div class="btns"><button class="btn hit" data-k="dlg-cancel">취소</button><button class="btn primary hit" data-k="dlg-delete">${icon('trash', 16)}삭제</button></div></div></div>`;
  if (d.type === 'conflict') return `<div class="dlg-back"><div class="dlg layer blk" role="alertdialog" aria-label="메모 충돌"><h4>지수님이 먼저 메모를 고쳤어요</h4><p>둘 중 남길 내용을 골라 주세요. 고르기 전까지 내 초안은 지워지지 않아요.</p>
    <div class="cmp"><div><b>지수님 메모 (지금 저장된 내용)</b>주말 웨이팅 1시간! 10시 전에 도착하기. 테라스는 2층.</div><div class="mine"><b>내 초안</b>${esc(d.mine)}</div></div>
    <div class="btns"><button class="btn hit" data-k="dlg-theirs">지수님 메모로 두기</button><button class="btn primary hit" data-k="dlg-mine">내 초안으로 저장</button></div></div></div>`;
  return '';
}
function safeHTML(cfg) {
  if (cfg.o === 'p') return `<div class="safe t"><span class="clock">9:41</span><span class="island"></span><span class="bat"></span><span class="tag" style="left:4px;top:44px">안전영역 59</span></div><div class="safe b" style="height:34px"><span class="home"></span><span class="tag" style="left:4px;top:2px">34</span></div>`;
  return `<div class="safe l"><span class="notch"></span><span class="tag" style="left:2px;top:4px">59</span></div><div class="safe r"><span class="tag" style="right:2px;top:4px">59</span></div><div class="safe b" style="height:21px;left:59px;right:59px"><span class="home"></span><span class="tag" style="left:2px;top:2px">21</span></div>`;
}
function specialHTML(sc, cfg) {
  if (sc.kind === 'lock') return `<div class="full-screen lock"><div class="time">9:41</div><div style="font-size:13px">11월 7일 토요일</div>
    <button class="notif hit" data-k="notif"><span class="nt"><b>데이트맵</b><span>지금</span></span><b>${sc.lock.title}</b><span>${sc.lock.body}</span></button></div>`;
  if (sc.kind === 'register') return `<div class="full-screen"><h3>장소 추가</h3><div class="oos"><b>등록 화면 — 이번 시안 범위 밖</b><span>링크 붙여 넣기 → 후보·지점 확인 → 저장</span><span>${sc.reg.summary}</span></div><button class="primary hit" data-k="regsave">${sc.reg.button}</button></div>`;
  if (sc.kind === 'external') return `<div class="full-screen" style="background:#d8d8d8"><span class="sysback" style="left:${cfg.o === 'p' ? 22 : 66}px;top:${cfg.o === 'p' ? 40 : 4}px">◀ 데이트맵</span><div class="oos" style="background:#eee"><b>카카오맵 앱 (외부 화면)</b><span>‘${sc.ext.dest}’까지 길찾기가 바로 열려요.</span><span>앱이 없으면 카카오맵 웹 페이지로 열고, 데이트맵 화면은 그대로 남아요.</span></div></div>`;
  return '';
}

function buildUI(sc, ctx, cfg) {
  if (sc.kind && sc.kind !== 'map') return specialHTML(sc, cfg);
  const P = cfg.o === 'p', chips = chipsHTML(sc, ctx), toast = sc.toast ? toastHTML(sc.toast) : '', card = cardHTML(sc, ctx, cfg);
  let panel = '';
  if (sc.panel && sc.panel.type === 'filter') panel = filterPanelHTML(sc, ctx, cfg);
  if (sc.panel && sc.panel.type === 'detail') panel = detailHTML(sc, ctx, cfg);
  let h = '';
  if (P) {
    h += `<div class="top-lane">${hdrHTML(sc)}<div class="row r2 blk"><div class="chips scroll">${chips}</div><div class="tools">${toolsHTML()}</div></div>${toast}</div>`;
    if (!panel) h += `<div class="bottom-lane">${card}${cfg.compact && card ? '' : dockHTML(cfg)}</div>`;
    h += panel;
  } else {
    h += panel || `<div class="side">${hdrHTML(sc)}${card}</div>`;
    h += `<div class="mid">${chips ? `<div class="chips wrap blk">${chips}</div>` : ''}</div>`;
    if (toast) h += `<div class="mid midb">${toast}</div>`;
    if (!(sc.panel && sc.panel.type === 'detail')) h += rcolHTML();
  }
  if (sc.editor) h += editorHTML(sc, ctx, cfg);
  if (sc.dialog) h += dialogHTML(sc, ctx, cfg);
  return h;
}

/* ---------- 지도 영역(가려지지 않는 사각형)과 시점 ---------- */
function relRect(dev, el) { const a = el.getBoundingClientRect(), d = dev.getBoundingClientRect(); return { l: a.left - d.left, t: a.top - d.top, r: a.right - d.left, b: a.bottom - d.top }; }
function freeRect(dev, cfg) {
  const sa = SAFE[cfg.o], q = (s) => dev.querySelector(s), R = (el) => relRect(dev, el);
  let l, t, r, b;
  if (cfg.o === 'p') {
    l = 16; r = cfg.w - 16; t = R(q('.top-lane')).b + 8;
    const sheet = q('.psheet'), bl = q('.bottom-lane');
    b = (sheet ? R(sheet).t : bl ? R(bl).t : cfg.h - sa.b) - 8;
    if (sheet && sheet.classList.contains('full')) { t = sa.t + 8; b = cfg.h - sa.b - 8; }
  } else {
    const panel = q('.lpanel'), card = q('.side .card'), hdr = q('.side .hdr'), rcol = q('.rcol');
    r = rcol ? R(rcol).l - 8 : cfg.w - sa.r - 8; b = cfg.h - sa.b - 8; const mid = q('.mid:not(.midb)');
    const midB = mid && mid.children.length ? R(mid).b + 8 : 8, tb = q('.midb');
    if (tb) b = R(tb).t - 8;
    if (panel) { l = R(panel).r + 8; t = midB; } else if (card) { l = R(q('.side')).r + 8; t = midB; } else { l = sa.l + 8; t = Math.max(hdr ? R(hdr).b + 8 : 8, midB); }
  }
  return { x: l, y: t, w: Math.max(60, r - l), h: Math.max(60, b - t) };
}
function resolveView(sc, ctx, R) {
  const v = sc.view || { fit: 'all' };
  if (v.default) { const k = toKm(37.552, 126.99); return { s: v.s || 15, ox: R.x + R.w / 2 - k.x * (v.s || 15), oy: R.y + R.h / 2 - k.y * (v.s || 15) }; }
  if (v.center) { const k = kmOf(ctx.byId[v.center]); return { s: v.s, ox: R.x + R.w / 2 - k.x * v.s, oy: R.y + R.h / 2 - k.y * v.s }; }
  const ids = resolveIds(v.fit, ctx).filter((i) => ctx.byId[i]);
  const ks = ids.map((i) => kmOf(ctx.byId[i]));
  if (!ks.length) { const k = toKm(37.552, 126.99); return { s: 15, ox: R.x + R.w / 2 - k.x * 15, oy: R.y + R.h / 2 - k.y * 15 }; }
  const xs = ks.map((k) => k.x), ys = ks.map((k) => k.y), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const padX = v.padX || Math.min(50, R.w * 0.2), padY = v.padY || Math.min(32, R.h * 0.2);
  let s = Math.min((R.w - 2 * padX) / Math.max(x1 - x0, 0.05), (R.h - 2 * padY) / Math.max(y1 - y0, 0.05));
  s = Math.max(0.3, Math.min(s, v.max || 1600));
  if (v.min) s = Math.max(s, v.min);
  let cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (v.focusOn) { const k = kmOf(ctx.byId[v.focusOn]); cx = k.x; cy = k.y; }
  return { s, ox: R.x + R.w / 2 - cx * s, oy: R.y + R.h / 2 - cy * s };
}

/* ---------- 겹침·잘림 검사 ---------- */
function visRectOf(dev, el) {
  let r = relRect(dev, el), a = el.parentElement;
  while (a && a !== dev) { const cs = getComputedStyle(a); if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') { const pr = relRect(dev, a); r = { l: Math.max(r.l, pr.l), t: Math.max(r.t, pr.t), r: Math.min(r.r, pr.r), b: Math.min(r.b, pr.b) }; } a = a.parentElement; }
  return r;
}
function checkDevice(dev, cfg, sc) {
  const sa = SAFE[cfg.o], issues = [], W = cfg.w, H = cfg.h;
  const R = (el) => relRect(dev, el), area = (r) => Math.max(0, r.r - r.l) * Math.max(0, r.b - r.t);
  const kb = dev.querySelector('.kbd');
  const safe = { l: sa.l, t: sa.t, r: W - sa.r, b: kb ? H - cfg.kb : H - sa.b };
  const dlg = dev.querySelector('.dlg'), ed = dev.querySelector('.editor'), full = dev.querySelector('.psheet.full');
  const roots = dlg ? [dlg] : ed ? [ed] : full ? [full] : [dev.querySelector('.ui')];
  const inRoots = (el) => roots.some((r) => r.contains(el));
  const visRect = (el) => {
    let r = R(el), a = el.parentElement;
    while (a && a !== dev) { const cs = getComputedStyle(a); if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') { const pr = R(a); r = { l: Math.max(r.l, pr.l), t: Math.max(r.t, pr.t), r: Math.min(r.r, pr.r), b: Math.min(r.b, pr.b) }; } a = a.parentElement; }
    return r;
  };
  const name = (el) => (el.getAttribute('aria-label') || el.textContent || el.dataset.k || '').trim().replace(/\s+/g, ' ').slice(0, 24);
  const outSafe = (v) => v.l < safe.l - 0.5 || v.t < safe.t - 0.5 || v.r > safe.r + 0.5 || v.b > safe.b + 0.5;
  const hits = [...dev.querySelectorAll('.ui .hit')].filter((el) => inRoots(el) && el.getClientRects().length);
  const full2 = [];
  for (const el of hits) {
    const f = R(el), v = visRect(el), fa = area(f), va = area(v);
    if (va <= 1) continue;
    const clipped = va < fa * 0.98;
    if (!clipped) {
      if (f.r - f.l < 43.5 || f.b - f.t < 43.5) issues.push(`작은 터치 영역 ${Math.round(f.r - f.l)}×${Math.round(f.b - f.t)}: ${name(el)}`);
      full2.push({ el, r: f });
    }
    if (outSafe(v)) issues.push(`안전영역 침범: ${name(el)}`);
    if (el.scrollWidth > el.clientWidth + 1) issues.push(`글자 넘침: ${name(el)}`);
  }
  for (let i = 0; i < full2.length; i++) for (let j = i + 1; j < full2.length; j++) {
    const a = full2[i].r, b = full2[j].r;
    if (full2[i].el.contains(full2[j].el) || full2[j].el.contains(full2[i].el)) continue;
    const gap = Math.max(a.l - b.r, b.l - a.r, a.t - b.b, b.t - a.b);
    if (gap < 7.5) issues.push(`${gap < 0 ? '겹침' : '간격 ' + gap.toFixed(1) + 'px'}: ${name(full2[i].el)} ↔ ${name(full2[j].el)}`);
  }
  const blks = [...dev.querySelectorAll('.ui .blk')].filter((el) => inRoots(el) && el.getClientRects().length);
  for (let i = 0; i < blks.length; i++) {
    const a = R(blks[i]);
    if (a.l < -0.5 || a.t < -0.5 || a.r > W + 0.5 || a.b > H + 0.5) issues.push(`화면 밖으로 잘림: ${blks[i].className.split(' ')[0]}`);
    if (!blks[i].classList.contains('layer') && outSafe(a)) issues.push(`블록이 안전영역 침범: ${blks[i].className.split(' ')[0]}`);
    if (blks[i].classList.contains('card') && !blks[i].querySelector('.scroll') && blks[i].scrollHeight > blks[i].clientHeight + 1) issues.push(`카드 내용 잘림: ${blks[i].className.split(' ').slice(0, 2).join('.')}`);
    for (let j = i + 1; j < blks.length; j++) {
      if (blks[i].contains(blks[j]) || blks[j].contains(blks[i])) continue;
      if (ov(a, R(blks[j]), -0.5)) issues.push(`블록 겹침: ${blks[i].className.split(' ').slice(0, 2).join('.')} ↔ ${blks[j].className.split(' ').slice(0, 2).join('.')}`);
    }
  }
  return uniq(issues);
}

/* ---------- 프레임 ---------- */
function renderFrame(sc, sizeKey, o) {
  const cfg = SIZES[sizeKey], ctx = makeCtx(sc), sa = SAFE[cfg.o];
  const fig = document.createElement('figure');
  fig.className = 'frame'; fig.id = o.id; fig.style.setProperty('--fw', cfg.w + 'px');
  fig.innerHTML = `<div class="cap">${o.n === '' && !o.state ? '' : `<span class="n${o.state ? ' state' : ''}">${o.state ? '상태' : o.n}</span>`}<span>${o.title}</span></div>`;
  const dev = document.createElement('div');
  dev.className = `device ${cfg.o === 'p' ? 'portrait' : 'landscape'}${cfg.compact ? ' compact' : ''} sz-${cfg.key}${sc.panel && sc.panel.type === 'detail' ? ' nocol' : ''}`;
  const colW = cfg.o === 'l' ? (sc.panel ? cfg.panel : cfg.side) : 0;
  dev.style.cssText = `width:${cfg.w}px;height:${cfg.h}px;--st:${sa.t}px;--sb:${sa.b}px;--sl:${sa.l}px;--sr:${sa.r}px;--sideW:${cfg.side || 0}px;--panelW:${cfg.panel || 0}px;--colW:${colW}px;--kb:${cfg.kb}px;--gmax:${Math.round(cfg.h * (cfg.compact ? 0.4 : 0.42))}px`;
  dev.innerHTML = `<div class="map">${sc.mapFail ? '<div class="hatch"></div>' : ''}</div><div class="mk-layer"></div><div class="ui">${buildUI(sc, ctx, cfg)}</div>${safeHTML(cfg)}`;
  fig.appendChild(dev);
  const meta = document.createElement('div'); meta.className = 'meta'; fig.appendChild(meta);
  if (o.note) { const n = document.createElement('p'); n.className = 'note'; n.innerHTML = o.note; fig.appendChild(n); }
  const chk = document.createElement('div'); chk.className = 'chk'; fig.appendChild(chk);
  return { fig, dev, ctx, cfg, sc, meta, chk, id: o.id };
}
function finishFrame(F) {
  const { dev, ctx, cfg, sc } = F;
  if (!sc.kind || sc.kind === 'map') {
    const R = freeRect(dev, cfg), view = resolveView(sc, ctx, R), stage = stageOf(view.s);
    if (!sc.mapFail) dev.querySelector('.map').innerHTML = mapSVG(cfg, view, sc);
    drawMarkers(dev, ctx, view, stage, sc, cfg, R);
    F.stage = stage;
    F.meta.textContent = sc.mapFail ? '지도 없음(로드 실패)' : `지도 단계: ${STAGE_KO[stage]} · ${view.s < 10 ? view.s.toFixed(1) : Math.round(view.s)}px/km${sc.focus ? ' · 집중 표시' : ''}`;
    if (/[?&]debug/.test(location.search)) { const d = document.createElement('div'); d.className = 'dbg'; d.style.cssText = `left:${R.x}px;top:${R.y}px;width:${R.w}px;height:${R.h}px`; dev.appendChild(d); }
  } else F.meta.textContent = sc.kind === 'register' ? '범위 밖 화면(자리만 표시)' : sc.kind === 'external' ? '외부 앱(자리만 표시)' : '시스템 화면';
  const issues = checkDevice(dev, cfg, sc);
  F.issues = issues;
  F.chk.className = 'chk' + (issues.length ? ' bad' : '');
  F.chk.innerHTML = issues.length ? `검사 문제 ${issues.length}건<ul>${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '검사 통과: 터치 44px·간격 8px·안전영역·블록 겹침';
}
function applyTap(F, onNext) {
  const t = F.sc.tap; if (!t) return;
  let el = null;
  for (const a of [].concat(t)) {
    const i = a.indexOf(':'), k = a.slice(0, i), v = a.slice(i + 1);
    if (k === 'k') el = F.dev.querySelector(`.ui [data-k="${v}"]`);
    else if (k === 'p') el = F.dev.querySelector(`.ui [data-p="${v}"]`) || F.dev.querySelector(`.mk[data-p="${v}"]`);
    else if (k === 'g') el = [...F.dev.querySelectorAll('.mk.pill')].find((x) => x.dataset.g === v);
    else if (k === 'gp') el = [...F.dev.querySelectorAll('.mk.pill')].find((x) => x.dataset.ids.split(',').includes(v));
    if (el && el.getClientRects().length) {
      const box = el.closest('.scroll');
      if (box) { const r = el.getBoundingClientRect(), b = box.getBoundingClientRect(); if (r.top < b.top || r.bottom > b.bottom) box.scrollTop += r.top - b.top - 6; }
      const v = visRectOf(F.dev, el); if ((v.r - v.l) > 20 && (v.b - v.t) > 20) break;
    }
    el = null;
  }
  if (!el) { F.chk.insertAdjacentHTML('beforeend', ' · (탭 위치 없음)'); return; }
  el.classList.add('tap');
  const r = relRect(F.dev, el), fd = document.createElement('div');
  fd.className = 'finger'; fd.style.left = (r.l + r.r) / 2 + 'px'; fd.style.top = (r.t + r.b) / 2 + 'px';
  F.dev.appendChild(fd);
  if (onNext) el.addEventListener('click', onNext);
}

/* ---------- 페이지 ---------- */
const NAV = [['index.html', '개요'], ['clusters.html', '묶음 단계'], ['s1.html', 'S1 처음 열기'], ['s2.html', 'S2 둘러보기'], ['s3.html', 'S3 등록 후 1곳'], ['s4.html', 'S4 등록 후 여러 곳'], ['s5.html', 'S5 상대의 새 장소'], ['s6.html', 'S6 필터'], ['s7.html', 'S7 상세 편집'], ['s8.html', 'S8 길찾기']];
function navHTML(cur) { return `<nav class="topnav" aria-label="시안 A 페이지">${NAV.map(([h, t]) => `<a href="${h}"${h.startsWith(cur + '.') ? ' class="on" aria-current="page"' : ''}>${t}</a>`).join('')}</nav>`; }
const solo = new URLSearchParams(location.search).get('solo');

function summarize(all, el) {
  const bad = all.filter((F) => F.issues && F.issues.length);
  const total = bad.reduce((s, F) => s + F.issues.length, 0);
  document.body.dataset.check = JSON.stringify({ frames: all.length, bad: bad.map((F) => ({ id: F.id, issues: F.issues })) });
  if (!el) return;
  el.className = 'sum' + (bad.length ? ' bad' : '');
  el.innerHTML = `자동 검사: 프레임 ${all.length}개 · 문제 ${total}건${bad.length ? `<details open><summary>문제 있는 프레임</summary>${bad.map((F) => `<div><a href="#${F.id}">${F.id}</a>: ${F.issues.map(esc).join(' / ')}</div>`).join('')}</details>` : ' — 모든 프레임에서 터치 44px, 간격 8px, 안전영역, 블록 겹침, 글자 넘침 통과'}`;
}
function goTo(id) { const f = document.getElementById(id); if (!f) return; f.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); f.classList.remove('flash'); void f.offsetWidth; f.classList.add('flash'); }

function sequence(seq) {
  const app = document.getElementById('app');
  document.title = `시안 A · ${seq.title}`;
  if (solo) document.body.classList.add('solo');
  app.innerHTML = solo ? '<div id="rows"></div>' : `${navHTML(seq.id)}<div class="wrap"><h1>${seq.title}</h1><p class="lead">${seq.lead}</p><div id="sum" class="sum">검사 중…</div><div id="rows"></div></div>`;
  const rows = document.getElementById('rows'), Fs = [];
  for (const sz of seq.sizes) {
    const row = document.createElement('section'); row.className = 'size-row';
    if (!solo) row.innerHTML = `<h2 id="${seq.id}-${sz}">${SIZES[sz].label}</h2>`;
    const fr = document.createElement('div'); fr.className = 'frames'; row.appendChild(fr);
    seq.frames.forEach((f, i) => {
      const id = `${seq.id}-${sz}-${i + 1}`; if (solo && solo !== id) return;
      if (f.only && !f.only.includes(sz)) return;
      const F = renderFrame(f.sc, sz, { id, n: i + 1, title: f.t, note: f.note, state: f.state });
      F.next = f.tapTo ? `${seq.id}-${sz}-${f.tapTo}` : `${seq.id}-${sz}-${i + 2}`;
      if (fr.children.length && !solo) { const a = document.createElement('div'); a.className = 'arrow'; a.textContent = f.state ? '·' : '→'; fr.appendChild(a); }
      fr.appendChild(F.fig); Fs.push(F);
    });
    if (fr.children.length) rows.appendChild(row);
  }
  Fs.forEach(finishFrame);
  Fs.forEach((F) => applyTap(F, () => goTo(F.next)));
  summarize(Fs, document.getElementById('sum'));
  if (location.hash) setTimeout(() => goTo(location.hash.slice(1)), 50);
  return Fs;
}
function embed(container, sc, sizeKey, o) {
  const F = renderFrame(sc, sizeKey, Object.assign({ id: 'e' + Math.random().toString(36).slice(2, 7), n: '' }, o || {}));
  container.appendChild(F.fig); finishFrame(F); applyTap(F); return F;
}

window.LAB = { SIZES, BASE, EXTRA, IDS, LONGMEMO, ST, glyph, icon, sequence, embed, renderFrame, finishFrame, applyTap, summarize, navHTML, goTo, groupOrder, makeCtx, solo };
})();

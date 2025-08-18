// frontend/src/shared/columnOrder.js

// 내가 고정으로 왼쪽에 두고 싶은 기본 컬럼(이미 정적으로 렌더 중: row_id, source, code, name, unit, qty)
// 동적 _raw 컬럼에는 관여하지 않지만, 참고용으로 둡니다.
export const PIN_LEFT = [];   // 동적 _raw 영역에서는 비워둠
export const PIN_RIGHT = [];  // 맨 오른쪽으로 보낼 컬럼이 있으면 여기에

// ✅ 내가 원하는 _raw 컬럼 우선순위 (원하는 대로 순서만 바꾸면 됨)
export const RAW_ORDER = [
  "Description__2",
  "Description__3",
  "Discipline",
  "Category(Large) Code",
  "Description",
  "Category(Middle) Code",
  "Category(Small) Code",
  "Attribute Specifications Code",
  "Attr1",
  "Code",
  "Attr2",
  "Code__2",
  "Attr3",
  "Code__3",
  "Attr4",
  "Code__4",
  "Attr5",
  "Code__5",
  "Attr6",
  "UoM UoM1",
  "UoM2",
  "Work Group\nCode",
  "Work Master\nCode",
  "New / Old\nCode",
];

// 키 라벨 표시용: 개행 등 보기 불편한 라벨 치환
export function normalizeLabel(k) {
  return String(k).replace(/\s*\n\s*/g, " ").trim();
}

// items(행들)에서 _raw 키들을 모으고, RAW_ORDER(+핀) 기준으로 정렬
export function buildOrderedRawColumns(items, {
  preferred = RAW_ORDER,
  pinLeft = PIN_LEFT,
  pinRight = PIN_RIGHT,
} = {}) {
  const all = new Set();
  for (const r of items || []) {
    const raw = r?._raw || r?.raw || {};
    Object.keys(raw).forEach(k => all.add(k));
  }
  const keys = Array.from(all);

  // 1) pinLeft → 2) preferred 순으로 정렬 → 3) 나머지 → 4) pinRight
  const inSet = (arr) => keys.filter(k => arr.includes(k));
  const notIn = (arr) => keys.filter(k => !arr.includes(k));

  const left = inSet(pinLeft);
  const pref = preferred.filter(k => keys.includes(k) && !left.includes(k)); // 중복 제거
  const consumed = new Set([...left, ...pref, ...pinRight]);
  // 나머지는 원래 keys 순서(or 알파벳)로. 알파벳 정렬로 바꾸고 싶으면 .sort() 추가.
  const middle = keys.filter(k => !consumed.has(k) && !pinRight.includes(k));
  const right = inSet(pinRight);

  return [...left, ...pref, ...middle, ...right];
}

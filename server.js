'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');

// ─────────────────────────────────────────────────────────────
// 설정값 (튜닝할 상수는 여기에 모아 둠)
// ─────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_API_KEY = (process.env.PUBLIC_API_KEY || '').trim();
const KAKAO_REST_API_KEY = (process.env.KAKAO_API_KEY || '').trim();
const BASE_URL = 'https://apis.data.go.kr/B552657/ErmctInfoInqireService';

const MAX_RADIUS_KM = 50;
const MILD_RADII_KM = [15, 30, 50];                // KTAS 3~5: 단계적 반경 확장
const BED_CACHE_TTL_MS = 45 * 1000;                // 실시간 병상: 45초 캐시
const DETAIL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;   // 병원 상세정보(거의 안 바뀜): 24시간 캐시
const BED_STALE_MINUTES = 180;                     // 병상 정보가 이보다 오래되면 감점
const DETAIL_CONCURRENCY = 8;                      // 상세조회 동시 호출 수
const ETA_CANDIDATES = 5;                          // ETA를 계산할 후보 수

const WEIGHTS = { ktas: 0.3, time: 0.4, bed: 0.3 };

// KTAS별로 "병원이 갖춰야 할 중증 대응 역량(0~100)"의 목표치.
// ※ 팀에서 정한 가정값이며 의학적 근거가 있는 수치가 아님 → 발표 때 '가정'으로 설명하거나 근거 자료로 교체할 것.
const KTAS_TARGET_CAPABILITY = { 1: 100, 2: 90, 3: 60, 4: 35, 5: 25 };

if (!PUBLIC_API_KEY) console.error('⚠️  PUBLIC_API_KEY가 .env에 없습니다.');
if (!KAKAO_REST_API_KEY) console.error('⚠️  KAKAO_API_KEY가 .env에 없습니다. (ETA는 추정값으로 대체됨)');
console.log(`🔑 공공데이터 키: ${PUBLIC_API_KEY ? `설정됨(${PUBLIC_API_KEY.length}자)` : '없음'} | 카카오 키: ${KAKAO_REST_API_KEY ? '설정됨' : '없음'}`);

// ─────────────────────────────────────────────────────────────
// 공통 유틸
// ─────────────────────────────────────────────────────────────
class UpstreamError extends Error {}          // 외부 API 장애 → 503으로 응답

const num = v => { const n = parseInt(v, 10); return Number.isNaN(n) ? 0 : n; };
const round2 = x => Math.round(x * 100) / 100;
const toArray = x => (x == null || x === '' ? [] : Array.isArray(x) ? x : [x]);

class TTLCache {
  constructor(ttlMs) { this.ttlMs = ttlMs; this.map = new Map(); }
  get(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (Date.now() > e.expires) { this.map.delete(key); return undefined; }
    return e.value;
  }
  set(key, value) { this.map.set(key, { value, expires: Date.now() + this.ttlMs }); }
  delete(key) { this.map.delete(key); }
}

// Promise 자체를 캐시해서 동시에 들어온 같은 요청도 한 번만 호출. 실패하면 캐시에서 제거.
function cached(cache, key, loader) {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const promise = loader().catch(err => { cache.delete(key); throw err; });
  cache.set(key, promise);
  return promise;
}

// 동시 실행 개수를 제한하는 map
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

// ─────────────────────────────────────────────────────────────
// 공공데이터 API 호출
// ─────────────────────────────────────────────────────────────
// validateStatus: 403 등 오류 응답도 본문(XML)을 읽어서 원인 코드를 확인하기 위함
const http = axios.create({ timeout: 5000, validateStatus: () => true, responseType: 'text' });
const kakaoHttp = axios.create({ timeout: 4000 });
const parser = new xml2js.Parser({ explicitArray: false });

async function callApi(path, params = {}) {
  const res = await http.get(`${BASE_URL}/${path}`, { params: { serviceKey: PUBLIC_API_KEY, ...params } });

  let parsed;
  try {
    parsed = await parser.parseStringPromise(res.data);
  } catch {
    throw new UpstreamError(`공공API 응답 해석 실패 (HTTP ${res.status})`);
  }

  // 인증키 오류·트래픽 초과 등: 루트가 OpenAPI_ServiceResponse로 옴
  if (parsed?.OpenAPI_ServiceResponse) {
    const h = parsed.OpenAPI_ServiceResponse.cmmMsgHeader || {};
    throw new UpstreamError(`공공API 오류 코드 ${h.returnReasonCode ?? '?'} (${h.returnAuthMsg || h.errMsg || 'unknown'})`);
  }

  const header = parsed?.response?.header;
  if (!header) throw new UpstreamError(`공공API 응답 형식 오류 (HTTP ${res.status})`);
  if (header.resultCode && header.resultCode !== '00') {
    throw new UpstreamError(`공공API resultCode ${header.resultCode} (${header.resultMsg || header.resultMag || ''})`);
  }

  const body = parsed.response.body || {};
  return { items: toArray(body.items?.item), totalCount: num(body.totalCount) };
}

// 페이지를 넘기며 전부 가져오기 (한 번에 numOfRows 최대치를 넘는 경우 대비)
async function callApiAll(path, params = {}, pageSize = 100, maxPages = 5) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const { items, totalCount } = await callApi(path, { ...params, pageNo: page, numOfRows: pageSize });
    all.push(...items);
    if (items.length < pageSize || (totalCount > 0 && all.length >= totalCount)) break;
  }
  return all;
}

const bedCache = new TTLCache(BED_CACHE_TTL_MS);
const detailCache = new TTLCache(DETAIL_CACHE_TTL_MS);

// [API 1] 위치 기반 응급의료기관 (거리 포함)
const fetchNearbyHospitals = (lat, lon) =>
  callApiAll('getEgytLcinfoInqire', { WGS84_LON: lon, WGS84_LAT: lat });

// [API 2] 시도 단위 실시간 가용병상 → hpid로 찾을 수 있는 Map (STAGE2 생략 시 시도 전체가 조회됨을 확인함)
function fetchBedMap(stage1) {
  return cached(bedCache, stage1, async () => {
    const items = await callApiAll('getEmrrmRltmUsefulSckbdInfoInqire', { STAGE1: stage1 });
    if (items.length === 0) throw new UpstreamError(`병상 데이터 0건 (${stage1})`);
    return new Map(items.map(b => [b.hpid, b]));
  });
}

// [API 3] 병원 기본정보 (진료과목, 응급실 운영여부, 중증질환 수용 가능 여부 등)
function fetchDetail(hpid) {
  return cached(detailCache, hpid, async () => {
    const { items } = await callApi('getEgytBassInfoInqire', { HPID: hpid });
    if (!items[0]) throw new UpstreamError(`상세정보 없음 (${hpid})`);
    return items[0];
  });
}

// [API 4] 카카오모빌리티 ETA(분). 실패하면 null
async function getKakaoETA(originLat, originLon, destLat, destLon) {
  if (!KAKAO_REST_API_KEY) return null;
  try {
    const res = await kakaoHttp.get('https://apis-navi.kakaomobility.com/v1/directions', {
      params: { origin: `${originLon},${originLat}`, destination: `${destLon},${destLat}` },
      headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` },
    });
    const sec = res.data?.routes?.[0]?.summary?.duration;
    return Number.isFinite(sec) ? Math.round(sec / 60) : null;
  } catch (e) {
    console.error('🚨 카카오 길찾기 실패:', e.response?.status || '', e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// 데이터 해석 · 필수 시설 검증 · 점수 계산
// ─────────────────────────────────────────────────────────────
// 진료과목은 "내과,외과,..." 형태 → 콤마로 쪼개 '정확히 일치'로 검사 ('외과'가 정형외과 등에 걸리는 문제 방지)
const parseDepts = detail =>
  new Set(String(detail?.dgidIdName || '').split(',').map(s => s.trim()).filter(Boolean));

// 중증질환 수용 가능 항목 (MKioskTy1~11, 값은 Y/N)
const kiosk = (detail, n) => detail?.[`MKioskTy${n}`] ?? detail?.[`mkioskty${n}`];
const isYes = v => String(v ?? '').trim().toUpperCase().startsWith('Y');

const SURGICAL_DEPTS = ['외과', '정형외과', '신경외과', '흉부외과', '심장혈관흉부외과'];

// 필수 시설 규칙: 실시간 자원 + 정적 역량은 모두 충족해야 통과 (하나라도 부족하면 탈락)
const FACILITY_CHECKS = {
  // 일반/신경/흉부 중환자 병상 중 하나라도 가용 (신생아 중환자는 제외). 진료과목은 보지 않음.
  '중환자실': ({ bed }) => num(bed.hvicc) > 0 || num(bed.hvcc) > 0 || num(bed.hvccc) > 0,
  '응급수술실': ({ bed, depts }) => num(bed.hvoc) > 0 && SURGICAL_DEPTS.some(d => depts.has(d)),
  // 심근경색 재관류 가능 여부(MKioskTy3)가 있으면 그것을 우선, 없으면 진료과목으로 대체
  '심혈관센터': ({ detail, depts }) => {
    const v = kiosk(detail, 3);
    if (v !== undefined) return isYes(v);
    return depts.has('심장혈관흉부외과') || depts.has('흉부외과');
  },
};

// 중증 대응 역량 점수(0~100): 수용 가능한 중증질환 비율. 데이터가 없으면 null
function capabilityScore(detail) {
  let known = 0, yes = 0;
  for (let n = 1; n <= 11; n++) {
    const v = kiosk(detail, n);
    if (v === undefined) continue;
    known++;
    if (isYes(v)) yes++;
  }
  return known === 0 ? null : Math.round((yes / known) * 100);
}

// 환자 중증도가 요구하는 역량 수준과 병원 역량의 근접도 (중증은 높은 역량, 경증은 낮은 역량 선호 → 쏠림 방지)
function ktasFitScore(ktas, capability) {
  if (capability === null) return 50; // 정보 없음 → 중립
  return Math.max(0, 100 - Math.abs(capability - KTAS_TARGET_CAPABILITY[ktas]));
}

// hvidate: yyyyMMddHHmmss (KST)
function parseHvidate(s) {
  const t = String(s ?? '');
  if (!/^\d{14}$/.test(t)) return null;
  return new Date(`${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)}+09:00`);
}

// 병원 1곳 평가: 탈락 사유(out) 또는 후보(candidate) 반환
function makeEvaluator({ ktas, requiredFacilities, bedByHpid, warnings }) {
  return async function evaluate(h) {
    const bed = bedByHpid.get(h.hpid);
    if (!bed) return { out: 'noBedData' };          // 병상 데이터가 없는 병원은 가짜 값을 만들지 않고 제외

    const erBeds = num(bed.hvec);
    if (erBeds <= 0) return { out: 'noBeds' };       // 음수(초과 수용)도 여기서 걸러짐

    let detail = null;
    try {
      detail = await fetchDetail(h.hpid);
    } catch (e) {
      warnings.add(`상세정보 조회 실패: ${h.dutyName}`);
    }

    if (detail && String(detail.dutyEryn).trim() === '2') return { out: 'erClosed' }; // 응급실 미운영

    const depts = parseDepts(detail);
    if (requiredFacilities.length > 0) {
      if (!detail) return { out: 'detailError' };    // 확인 불가 → 안전하게 제외
      const ctx = { bed, detail, depts };
      if (!requiredFacilities.every(f => FACILITY_CHECKS[f](ctx))) return { out: 'facility' };
    }

    const capability = capabilityScore(detail);
    const ktasFit = ktasFitScore(ktas, capability);

    const updatedAt = parseHvidate(bed.hvidate);
    const ageMin = updatedAt ? (Date.now() - updatedAt.getTime()) / 60000 : null;
    const bedStale = ageMin !== null && ageMin > BED_STALE_MINUTES;

    let bedScore = Math.min(erBeds, 10) * 10;
    if (erBeds === 1) bedScore = Math.max(0, bedScore - 30);  // 이송 중 마지막 병상을 뺏길 위험
    if (bedStale) bedScore = Math.round(bedScore * 0.5);       // 오래된 정보는 신뢰도 감점

    // 1차 점수: ETA 계산 전 직선거리 기반 (Top N 선별용)
    const distScore = Math.max(0, 100 - h.distanceKm * 2);
    const preScore = ktasFit * WEIGHTS.ktas + distScore * WEIGHTS.time + bedScore * WEIGHTS.bed;

    return {
      out: 'ok',
      candidate: {
        hpid: h.hpid,
        dutyName: h.dutyName,
        dutyAddr: h.dutyAddr,
        dutyTel1: h.dutyTel1 ?? null,
        dutyTel3: detail?.dutyTel3 ?? bed.dutyTel3 ?? null,   // 응급실 직통전화
        distanceKm: h.distanceKm,
        latitude: parseFloat(h.latitude),
        longitude: parseFloat(h.longitude),
        availableBeds: erBeds,
        // 👇 바로 이 위치에 프론트엔드용 3줄을 끼워 넣어 주시면 됩니다!
        icuBeds: num(bed.hvicc),
        surgeryBeds: num(bed.hvoc),
        departments: String(detail?.dgidIdName || ''),
        // 👆 -----------------------------------------------------
        capability,
        bedUpdatedAt: bed.hvidate ?? null,
        bedStale,
        ktasFit,
        bedScore,
        preScore,
      },
    };
  };
}

// ─────────────────────────────────────────────────────────────
// 서버
// ─────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// 폰 브라우저로 http://<PC주소>:3000 접속해 연결 여부를 확인하는 용도
app.get('/', (req, res) => res.send('B파트 응급 매칭 서버 정상 동작 중'));

app.post('/api/match', async (req, res) => {
  try {
    // ── 입력 검증 (400) ──
    const body = req.body || {};
    const ktas = Number(body.ktas);
    const lat = Number(body.lat);
    const lon = Number(body.lon ?? body.lng);   // 앱이 lng로 보내도 허용
    const requiredFacilities = body.requiredFacilities ?? [];

    if (!Number.isInteger(ktas) || ktas < 1 || ktas > 5) {
      return res.status(400).json({ success: false, message: '유효하지 않은 KTAS 등급입니다. (1~5 정수)' });
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 33 || lat > 39 || lon < 124 || lon > 132) {
      return res.status(400).json({ success: false, message: '위치 정보(lat, lon)가 없거나 올바르지 않습니다.' });
    }
    if (!Array.isArray(requiredFacilities) || !requiredFacilities.every(f => Object.hasOwn(FACILITY_CHECKS, f))) {
      return res.status(400).json({
        success: false,
        message: `requiredFacilities는 배열이며 다음 값만 허용됩니다: ${Object.keys(FACILITY_CHECKS).join(', ')}`,
      });
    }

    console.log(`\n🚑 [매칭 요청] KTAS ${ktas} | 필수시설 [${requiredFacilities.join(', ')}] | 위치 ${lat}, ${lon}`);

    // ── 1. 주변 병원 ──
    const nearby = (await fetchNearbyHospitals(lat, lon))
      .map(h => ({ ...h, distanceKm: parseFloat(h.distance) }))
      .filter(h => Number.isFinite(h.distanceKm) && h.distanceKm <= MAX_RADIUS_KM)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    if (nearby.length === 0) {
      return res.json({ success: true, message: '반경 50km 내 응급의료기관 정보가 없습니다.', hospitals: [] });
    }
    const maxNearbyKm = nearby[nearby.length - 1].distanceKm;

    // ── 2. 시도 단위로 병상 조회 (병렬 + 캐시). 일부 실패는 경고, 전부 실패는 503 ──
    const warnings = new Set();
    const stage1List = [...new Set(nearby.map(h => String(h.dutyAddr || '').trim().split(/\s+/)[0]).filter(Boolean))];
    const bedByHpid = new Map();
    let bedFailures = 0;

    await Promise.all(stage1List.map(async stage1 => {
      try {
        for (const [hpid, bed] of await fetchBedMap(stage1)) bedByHpid.set(hpid, bed);
      } catch (e) {
        bedFailures++;
        warnings.add(`병상 조회 실패(${stage1}): ${e.message}`);
        console.error(`🚨 병상 조회 실패 (${stage1}): ${e.message}`);
      }
    }));
    if (stage1List.length === 0 || bedFailures === stage1List.length) {
      throw new UpstreamError('실시간 병상 정보를 가져오지 못했습니다.');
    }

    // ── 3. 후보 탐색 ──
    // 중증(1~2): 50km 전체를 한 번에 비교 / 경증(3~5): 15→30→50km 단계 확장, 3곳 확보 시 중단
    const radii = ktas <= 2 ? [MAX_RADIUS_KM] : MILD_RADII_KM;
    const evaluate = makeEvaluator({ ktas, requiredFacilities, bedByHpid, warnings });
    const memo = new Map();
    const evalOnce = h => {
      if (!memo.has(h.hpid)) memo.set(h.hpid, evaluate(h));
      return memo.get(h.hpid);
    };

    let appliedRadius = radii[0];
    let candidates = [];
    let tierResults = [];
    for (const radius of radii) {
      appliedRadius = radius;
      const inRadius = nearby.filter(h => h.distanceKm <= radius);
      tierResults = await mapLimit(inRadius, DETAIL_CONCURRENCY, evalOnce);
      candidates = tierResults.filter(r => r.out === 'ok').map(r => r.candidate);
      if (ktas >= 3 && candidates.length >= 3) break;
    }

    const excluded = {};
    for (const r of tierResults) if (r.out !== 'ok') excluded[r.out] = (excluded[r.out] || 0) + 1;
    const meta = {
      nearbyCount: nearby.length,
      maxNearbyKm,
      appliedRadiusKm: appliedRadius,
      excluded,
      partial: bedFailures > 0,
      warnings: [...warnings],
    };

    // ── 4. 결과 없음: 가까운 병원 목록을 폴백으로 제공 (직접 전화 확인용) ──
    if (candidates.length === 0) {
      console.log('⚠️ 조건 충족 병원 없음', excluded);
      return res.json({
        success: true,
        message: '조건을 만족하는 가용 병원이 없습니다. 가까운 응급의료기관에 직접 연락해 확인하세요.',
        hospitals: [],
        fallbackHospitals: nearby.slice(0, 3).map(h => ({
          hpid: h.hpid,
          dutyName: h.dutyName,
          dutyAddr: h.dutyAddr,
          dutyTel1: h.dutyTel1 ?? null,
          distanceKm: h.distanceKm,
          latitude: parseFloat(h.latitude),
          longitude: parseFloat(h.longitude),
        })),
        meta,
      });
    }

    // ── 5. 1차 점수로 Top N 선별 → ETA 병렬 조회 → ETA 반영해 재정렬 ──
    candidates.sort((a, b) => b.preScore - a.preScore);
    const top = candidates.slice(0, ETA_CANDIDATES);

    await Promise.all(top.map(async h => {
      const eta = await getKakaoETA(lat, lon, h.latitude, h.longitude);
      h.etaEstimated = eta === null;                                   // 추정값이면 true
      h.etaMinutes = eta ?? Math.round((h.distanceKm / 40) * 60);      // 실패 시 시속 40km 가정
      h.etaScore = Math.max(0, 100 - h.etaMinutes * 2);                // 0분=100점, 50분=0점
      h.finalScore = round2(h.ktasFit * WEIGHTS.ktas + h.etaScore * WEIGHTS.time + h.bedScore * WEIGHTS.bed);
    }));

    top.sort((a, b) => b.finalScore - a.finalScore);
    const hospitals = top.slice(0, 3).map(({ preScore, ktasFit, bedScore, etaScore, ...rest }) => ({
      ...rest,
      scoreBreakdown: { ktasFit, etaScore, bedScore },
    }));

    console.log('✅ 매칭 완료 (Top 3):', hospitals.map(h => `${h.dutyName}(${h.etaMinutes}분${h.etaEstimated ? '·추정' : ''}, ${h.finalScore}점)`));

    return res.json({ success: true, ktas, requiredFacilities, hospitals, meta });
  } catch (e) {
    console.error('🚨 /api/match 오류:', e.message);
    if (e instanceof UpstreamError) {
      return res.status(503).json({
        success: false,
        message: '공공 응급의료 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        detail: e.message,
      });
    }
    return res.status(500).json({ success: false, message: '병원 매칭 중 내부 오류가 발생했습니다.' });
  }
});

// 잘못된 JSON 본문 등 미들웨어 단계 오류도 JSON으로 응답
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: '요청 본문이 올바른 JSON 형식이 아닙니다.' });
  }
  console.error('🚨 처리되지 않은 오류:', err.message);
  return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
});

// 비동기 에러가 새어 나가도 프로세스가 죽지 않도록 로그만 남김 (시연 안정성)
process.on('unhandledRejection', reason => console.error('🚨 unhandledRejection:', reason));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 B파트 백엔드 서버가 ${PORT}번 포트에서 실행 중입니다.`);
});

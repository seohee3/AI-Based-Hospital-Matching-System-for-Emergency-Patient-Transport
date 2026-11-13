require('dotenv').config();
console.log("🔑 카카오 키 앞 5자리:", process.env.KAKAO_API_KEY ? process.env.KAKAO_API_KEY.substring(0, 5) : "undefined (로드 실패)");
console.log("🔑 공공데이터 키 앞 5자리:", process.env.PUBLIC_API_KEY ? process.env.PUBLIC_API_KEY.substring(0, 5) : "undefined (로드 실패)");
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');

const app = express();
app.use(cors());
app.use(express.json());

// 🚨 API 키 설정 (엔터나 공백이 들어가지 않도록 주의하세요)
const KAKAO_REST_API_KEY = process.env.KAKAO_API_KEY;
const PUBLIC_API_KEY = process.env.PUBLIC_API_KEY;

// 구급차 현재 위치 (기본값: 단국대)
const DEFAULT_LAT = 37.3216;
const DEFAULT_LON = 127.1268;

const parser = new xml2js.Parser({ explicitArray: false });
const BASE_URL = "https://apis.data.go.kr/B552657/ErmctInfoInqireService";

// [함수 1] 위치 기반 응급의료기관 조회 (거리순 목록 확보)
async function fetchNearbyHospitals(lat, lon) {
  const url = `${BASE_URL}/getEgytLcinfoInqire?serviceKey=${PUBLIC_API_KEY}&WGS84_LON=${lon}&WGS84_LAT=${lat}&numOfRows=100`;
  const res = await axios.get(url);
  const parsed = await parser.parseStringPromise(res.data);
  const items = parsed?.response?.body?.items?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

// [함수 2] 시도·시군구 단위 실시간 가용병상 조회
async function fetchAvailableBeds(stage1, stage2) {
  try {
    const url = `${BASE_URL}/getEmrrmRltmUsefulSckbdInfoInqire?serviceKey=${PUBLIC_API_KEY}&STAGE1=${encodeURIComponent(stage1)}&STAGE2=${encodeURIComponent(stage2)}&numOfRows=100`;
    const res = await axios.get(url);
    const parsed = await parser.parseStringPromise(res.data);
    const items = parsed?.response?.body?.items?.item;
    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  } catch (e) {
    console.error(`가용병상 조회 실패 (${stage1} ${stage2}):`, e.message);
    return [];
  }
}

// [함수 3] 기관 ID(hpid)로 병원 기본정보(진료과목 등) 상세 조회
async function fetchHospitalDetail(hpid) {
  try {
    const url = `${BASE_URL}/getEgytBassInfoInqire?serviceKey=${PUBLIC_API_KEY}&HPID=${hpid}`;
    const res = await axios.get(url);
    const parsed = await parser.parseStringPromise(res.data);
    return parsed?.response?.body?.items?.item || null;
  } catch (e) {
    return null;
  }
}

// [함수 4] 카카오모빌리티 내비게이션 ETA(분) 계산
async function getKakaoETA(originLat, originLon, destLat, destLon) {
  try {
    const url = `https://apis-navi.kakaomobility.com/v1/directions?origin=${originLon},${originLat}&destination=${destLon},${destLat}`;
    const res = await axios.get(url, {
      headers: { "Authorization": `KakaoAK ${KAKAO_REST_API_KEY}` }
    });
    const seconds = res.data.routes[0].summary.duration;
    return Math.round(seconds / 60);
  } catch (e) {
    console.error("카카오 내비 호출 에러:", e.message);
    return null;
  }
}

// [보조 함수] 병원 주소에서 시도(STAGE1), 시군구(STAGE2) 추출
function extractRegion(addr) {
  if (!addr) return null;
  const parts = addr.trim().split(/\s+/);
  if (parts.length < 2) return null;
  // '경기도 성남시 분당구'처럼 시+구가 나뉜 경우와 일반 '경기도 용인시' 형태 모두 대응
  return { stage1: parts[0], stage2: parts[1] };
}

// [메인 엔드포인트] A파트 -> B파트 병원 매칭 요청 처리
app.post('/api/match', async (req, res) => {
  const { ktas, requiredFacilities = [], lat = DEFAULT_LAT, lon = DEFAULT_LON } = req.body;
  console.log(`\n🚑 [매칭 요청 수신] KTAS: ${ktas}등급 | 필수시설: [${requiredFacilities.join(', ')}]`);

  try {
    // 1. 내 주변 병원 목록 조회 (거리 포함)
    const rawHospitals = await fetchNearbyHospitals(lat, lon);
    const within50km = rawHospitals
      .map(h => ({ ...h, distanceKm: parseFloat(h.distance) }))
      .filter(h => h.distanceKm <= 50);

    // 2. 탐색 대상 병원들의 지역(시도/시군구)을 추출해 실시간 가용병상 정보 한 번에 수집
    const regionMap = new Map();
    within50km.slice(0, 30).forEach(h => {
      const reg = extractRegion(h.dutyAddr);
      if (reg) regionMap.set(`${reg.stage1}|${reg.stage2}`, reg);
    });

    const bedDataByHpid = {};
    for (const reg of regionMap.values()) {
      const beds = await fetchAvailableBeds(reg.stage1, reg.stage2);
      beds.forEach(b => { bedDataByHpid[b.hpid] = b; });
    }

    // 3. 반경 자동 확장 로직 (15km -> 30km -> 50km)
    const radii = [15, 30, 50];
    let matchedCandidates = [];
    let appliedRadius = 15;

    for (const radius of radii) {
      appliedRadius = radius;
      const inRadius = within50km.filter(h => h.distanceKm <= radius);
      matchedCandidates = [];

      for (const h of inRadius) {
        const bedInfo = bedDataByHpid[h.hpid];
        const erBeds = bedInfo ? parseInt(bedInfo.hvec || 0, 10) : 1; // 가용병상 API에 없으면 기본 1로 간주
        const icuBeds = bedInfo ? parseInt(bedInfo.hvicc || 0, 10) : 0; // 일반중환자실
        const surgeryBeds = bedInfo ? parseInt(bedInfo.hvoc || 0, 10) : 0; // 수술실

        // 기본 조건: 응급실 가용병상이 최소 1개 이상이어야 함
        if (erBeds <= 0) continue;

        // 필수 시설 조건 검사
        let facilityOk = true;
        let departments = "";

        if (requiredFacilities.length > 0) {
          const detail = await fetchHospitalDetail(h.hpid);
          departments = detail?.dgidIdName || "";

          for (const fac of requiredFacilities) {
            if (fac === '중환자실' && icuBeds <= 0 && !departments.includes('중환자')) {
              facilityOk = false;
            }
            if (fac === '응급수술실' && surgeryBeds <= 0 && !departments.includes('외과')) {
              facilityOk = false;
            }
            if (fac === '심혈관센터' && !departments.includes('순환기내과') && !departments.includes('흉부외과')) {
              facilityOk = false;
            }
          }
        }

        if (facilityOk) {
          matchedCandidates.push({
            hpid: h.hpid,
            dutyName: h.dutyName,
            dutyAddr: h.dutyAddr,
            dutyTel3: h.dutyTel3,
            distanceKm: h.distanceKm,
            latitude: parseFloat(h.latitude),
            longitude: parseFloat(h.longitude),
            availableBeds: erBeds,
            icuBeds: icuBeds,
            surgeryBeds: surgeryBeds,
            departments: departments
          });
        }
      }

      console.log(`🔍 반경 ${radius}km 탐색 결과: 조건 충족 병원 ${matchedCandidates.length}곳 발견`);
      if (matchedCandidates.length >= 3) break; // 3곳 이상 확보되면 반경 확장 중단!
    }

    // 4. 직선거리 기준 오름차순 정렬 후 상위 3곳 컷 (최적화)
    matchedCandidates.sort((a, b) => a.distanceKm - b.distanceKm);
    const top3 = matchedCandidates.slice(0, 3);

    // 5. 최종 Top 3 병원에 대해서만 카카오 내비게이션 API 호출하여 실시간 ETA(분) 계산
    for (const hosp of top3) {
      hosp.etaMinutes = await getKakaoETA(lat, lon, hosp.latitude, hosp.longitude);
    }

    console.log(`✅ 최종 매칭 완료 (적용 반경: ${appliedRadius}km):`, top3.map(h => `${h.dutyName}(${h.etaMinutes}분)`));

    // 6. C파트(UI)로 전달할 최종 JSON 응답
    res.json({
      success: true,
      appliedRadiusKm: appliedRadius,
      ktas,
      requiredFacilities,
      hospitals: top3
    });

  } catch (error) {
    console.error("매칭 처리 중 서버 오류:", error.message);
    res.status(500).json({ success: false, message: "병원 매칭 중 오류가 발생했습니다." });
  }
});

app.listen(3000, () => {
  console.log("🚀 B파트 백엔드 서버가 3000번 포트에서 실행 중입니다.");
});
// 백엔드 없이 앱이 Groq 를 직접 호출합니다 (해커톤 시연용).
import { File } from 'expo-file-system';
import { buildMultipart } from './multipart';
import { FACILITIES } from './constants';

// 키는 코드에 넣지 않고 .env 의 EXPO_PUBLIC_GROQ_API_KEY 에서 읽습니다 (.env.example 참고).
const GROQ_KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY;
const BASE = 'https://api.groq.com/openai/v1';
const STT_MODEL = 'whisper-large-v3-turbo';
const LLM_MODEL = 'openai/gpt-oss-120b';

const SYSTEM_PROMPT = `너는 119 구급대원의 현장 음성 브리핑(음성 인식 결과 텍스트)을 응급실 전달용 보고서 항목으로 정리하는 도우미다.
반드시 아래 JSON 객체 하나만 출력한다. 설명, 마크다운, 코드블록은 쓰지 않는다.
{
  "age": "예: 65세 (언급 없으면 빈 문자열)",
  "sex": "남성 | 여성 | 미상",
  "chiefComplaints": ["핵심 증상을 짧은 명사형으로, 예: 흉통, 식은땀"],
  "bloodPressure": "수축기/이완기 형태, 예: 150/90 (언급 없으면 빈 문자열)",
  "consciousness": "명료 | 기면 | 혼미 | 혼수 | 미상",
  "requiredFacilities": ["필수 의료시설 목록"]
}
규칙:
- 말한 내용에 근거해서만 채우고, 없는 사실을 지어내지 않는다.
- "혈압 150에 90" 같은 말은 "150/90"으로 변환한다.
- 의식 상태는 위 네 가지 중 하나로 매핑한다. 언급이 없으면 "미상".
- requiredFacilities 는 반드시 아래 3개 중에서만, 환자 상태에 꼭 필요한 것만 고른다(필요 없으면 빈 배열):
  중환자실, 응급수술실, 심혈관센터
- KTAS 등급은 판단하지 않는다(대원이 직접 선택한다).`;

async function check(res, step) {
  if (!res.ok) throw new Error(`${step} 실패 (${res.status}): ${await res.text()}`);
  return res.json();
}

// A01 로그인 (시연용: 빈 값만 아니면 통과)
export async function login(center, employeeId, password) {
  if (!center?.trim() || !employeeId?.trim() || !password?.trim()) {
    throw new Error('센터, 사번, 비밀번호를 모두 입력해 주세요.');
  }
  return { teamName: '119 구급1팀', center: center.trim() };
}

// 녹음 → 텍스트 (whisper-large-v3-turbo)
const STT_FIELDS = {
  model: STT_MODEL,
  language: 'ko',
  temperature: '0',
  response_format: 'json',
  prompt: '119 구급 현장 브리핑. 환자 나이, 성별, 흉통, 식은땀, 혈압, 의식 상태, 호흡곤란, 심근경색, 뇌졸중.',
};

// 방법 1: expo-file-system 의 File 을 FormData 에 그대로 첨부
async function sttViaFormData(uri) {
  const form = new FormData();
  for (const [k, v] of Object.entries(STT_FIELDS)) form.append(k, v);
  form.append('file', new File(uri), 'briefing.m4a');
  const res = await fetch(`${BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_KEY}` },
    body: form,
  });
  return (await check(res, '음성 변환')).text;
}

// 방법 2: 파일 바이트를 읽어 multipart 본문을 직접 만들어 전송
async function sttViaBytes(uri) {
  const file = new File(uri);
  const bytes = file.bytes ? await file.bytes() : new Uint8Array(await file.arrayBuffer());
  const { body, contentType } = buildMultipart(STT_FIELDS, 'file', 'briefing.m4a', 'audio/m4a', bytes);
  const res = await fetch(`${BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': contentType },
    body,
  });
  return (await check(res, '음성 변환')).text;
}

export async function transcribe(uri) {
  const errors = [];
  for (const run of [sttViaFormData, sttViaBytes]) {
    try {
      const text = await run(uri);
      return (text || '').trim();
    } catch (e) {
      errors.push(`${run.name}: ${e.message}`);
    }
  }
  throw new Error(`음성 변환에 실패했습니다.\n${errors.join('\n')}`);
}

// 텍스트 → 보고서 항목 (openai/gpt-oss-120b)
export async function makeReport(transcript) {
  const payload = {
    model: LLM_MODEL,
    temperature: 0.2,
    reasoning_effort: 'low',
    max_completion_tokens: 4000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: transcript },
    ],
  };
  const call = (extra) =>
    fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, ...extra }),
    });
  // JSON 모드로 먼저 시도하고, 400 이면 JSON 모드 없이 재시도 (프롬프트가 JSON 만 출력하도록 지시함)
  let res = await call({ response_format: { type: 'json_object' } });
  if (res.status === 400) res = await call({});
  const json = await check(res, '보고서 정리');
  const content = json.choices?.[0]?.message?.content || '';
  const s = content.indexOf('{');
  const e = content.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.');
  const d = JSON.parse(content.slice(s, e + 1));
  const str = (v) => (v == null ? '' : String(v).trim());
  const arr = (v) => (Array.isArray(v) ? v.map(String) : []);
  return {
    age: str(d.age), sex: str(d.sex), chiefComplaints: arr(d.chiefComplaints),
    bloodPressure: str(d.bloodPressure), consciousness: str(d.consciousness),
    requiredFacilities: arr(d.requiredFacilities).filter((f) => FACILITIES.includes(f)),
  };
}

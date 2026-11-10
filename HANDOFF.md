# 인수인계 문서 (A04 이후 개발자용)

## 1. 한 줄 요약
A01~A04 까지 구현되어 있고, A04 의 **"병원 매칭 및 호출"** 버튼을 누르면 아래 **두 값만** 전달됩니다.
환자 보고서(나이/증상/혈압/의식/특이사항)는 **어디에도 저장·전송하지 않으며** 앱 메모리에만 있습니다.

## 2. 전달되는 데이터 (핵심)
```ts
type Handoff = {
  ktas: 1 | 2 | 3 | 4 | 5;          // 대원이 A03 에서 직접 선택. 1 = 가장 위급 ... 5 = 비응급
  requiredFacilities: Facility[];   // 대원이 A03 에서 선택한 필수 시설. 0~3개 (선택 안 하면 빈 배열)
};
type Facility = '중환자실' | '응급수술실' | '심혈관센터';   // 값은 이 한글 문자열 그대로
```
예시
```json
{ "ktas": 2, "requiredFacilities": ["중환자실", "심혈관센터"] }
```
- `ktas` 는 항상 숫자 1~5 입니다 (선택 전에는 A03 의 다음 버튼이 비활성화되어 도달 불가).
- `requiredFacilities` 는 항상 배열이며 `FACILITIES` 순서(중환자실 → 응급수술실 → 심혈관센터)로 정렬됩니다. 비어 있을 수 있으니 빈 배열 처리 필요.
- 시설 상수: `src/constants.js` 의 `FACILITIES`. 백엔드/DB 코드값이 필요하면 이 한글 값을 키로 매핑하세요.

## 3. 값을 받는 방법
파일: `src/handoff.js`
```js
import { subscribeHandoff, getHandoff } from './src/handoff';

const unsubscribe = subscribeHandoff((payload) => { /* { ktas, requiredFacilities } */ });
const last = getHandoff();   // 마지막 전달값, 없으면 null (읽기 전용 객체)
```
호출 시점: `App.js` 의 `handleHandoff(payload)` 가 `sendHandoff()` 를 부르는 순간.
**이어서 개발할 위치**: `handleHandoff()` 안의 `TODO(다음 담당자)` 주석. 지금은 확인용 `Alert` 만 띄웁니다.
(예: `setScreen('home')` 후 A05 렌더링 추가)

## 4. 화면 흐름과 상태 (App.js)
| 화면 | screen 값 | 파일 |
|---|---|---|
| A01 로그인 | `login` | `src/screens/Login.js` |
| A02 AI 현장 브리핑 | `voice` | `src/screens/Voice.js` |
| A03 리포트 검수 | `review` | `src/screens/Review.js` |
| A04 특이사항 | `notes` | `src/screens/Notes.js` |

화면 전환은 라이브러리 없이 `App.js` 의 `useState('screen')` 로 합니다. 이전(←) 버튼과 안드로이드 뒤로가기는 `goBack()` 하나로 처리합니다.
A05 이후를 `react-navigation` 으로 바꿀 거라면 `App.js` 의 screen 분기를 Stack 으로 옮기면 됩니다.

App.js 의 상태:
- `user` : `{ teamName: '119 구급1팀', center }` (A01 결과)
- `draft` : AI 초안 (아래 5-1)
- `report` : 대원이 검수한 최종 보고서 (아래 5-2). **메모리에만 존재, 저장하지 않음**

## 5. 내부 데이터 구조
### 5-1. draft (AI 초안, `makeReport()` 반환값)
```ts
{ age: string, sex: string, chiefComplaints: string[], bloodPressure: string,
  consciousness: string,            // 명료|기면|혼미|혼수|미상
  requiredFacilities: Facility[] }  // AI 추천. 3개 외의 값은 api.js 에서 걸러짐
```
KTAS 는 AI 가 판단하지 않습니다.
### 5-2. report (A03 확인 후)
```ts
{ patient: string, symptoms: string, bp: string, consciousness: string,
  ktas: 1~5, requiredFacilities: Facility[], notes?: string /* A04 에서 직접 입력, 기본값 빈 문자열 */ }
```
이 중 **다음 단계로 넘어가는 것은 `ktas`, `requiredFacilities` 뿐**입니다. 나머지를 추가로 넘겨야 하면 `Notes.js` 의 `onHandoff(...)` 인자와 `handoff.js` 를 함께 수정하세요.

## 6. 외부 API (Groq) — 파일: `src/api.js`
백엔드 없이 앱이 직접 호출합니다. Base: `https://api.groq.com/openai/v1`, 헤더 `Authorization: Bearer <GROQ_KEY>`
| 용도 | 엔드포인트 | 모델 |
|---|---|---|
| 음성→텍스트 | `POST /audio/transcriptions` (multipart, `language=ko`) | `whisper-large-v3-turbo` |
| 텍스트→보고서 항목(JSON) | `POST /chat/completions` (`response_format: json_object`, 400 이면 해당 옵션 없이 재시도) | `openai/gpt-oss-120b` |

- 파일 업로드는 최신 Expo 의 `fetch` 제약 때문에 2단계 폴백(`File`을 FormData 에 첨부 → 실패 시 `multipart.js` 로 본문 직접 생성)입니다. 건드릴 때 주의하세요.
- `transcribe(uri)`, `makeReport(text)`, `login(...)` 이 공개 함수입니다.

## 7. 알려진 제한 / 이어서 할 일
- Groq API 키는 `.env` 의 `EXPO_PUBLIC_GROQ_API_KEY` 로 읽습니다. `EXPO_PUBLIC_` 값은 앱 번들에 포함되어 앱을 풀면 노출되므로, 실서비스는 반드시 서버로 옮기세요. 예전 버전 코드에 하드코딩됐던 키는 폐기·재발급을 권장합니다.
- **로그인은 가짜**입니다(빈 값만 아니면 통과, 토큰 없음). 인증 서버 연동 필요.
- A05(홈/인근 응급실), A06(병원 호출 진행)은 **미구현**. 병원 매칭은 `Handoff` 의 KTAS·필수시설을 조건으로 사용하면 됩니다.
- 보고서 자체를 병원에 보내야 한다면 현재 구조상 `report` 를 `handleHandoff` 로 함께 넘기도록 확장해야 합니다(지금은 의도적으로 제외).
- 선택사항: Spring Boot 버전 백엔드가 `optional-backend/` 에 있습니다(`/api/auth/login`, `/api/briefing/transcribe`, `/api/briefing/report`). 현재 앱은 사용하지 않습니다.

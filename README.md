# ER-Sync (A01~A04)

119 구급대원 음성 브리핑 → AI 보고서 초안 → KTAS/필수시설 선택 → 병원 매칭 호출까지의 Expo(React Native) 앱입니다.
이어서 개발할 내용(A05~)은 **HANDOFF.md** 를 먼저 읽어주세요.

## 준비물
- Node.js 22.13 이상 (Expo SDK 57 기준)
- VS Code
- 폰에 **Expo Go** 앱 (폰과 PC는 같은 Wi-Fi. 행사장 Wi-Fi가 막히면 폰 핫스팟에 PC 연결)

## 처음 실행 (한 번만)
1. 이 폴더(`ersync-app`)를 VS Code 로 엽니다. (파일 → 폴더 열기)
2. 터미널(Ctrl+`)에서:
   ```
   npm run setup
   ```
   `npm install` 후 Expo SDK 57 에 맞는 패키지 버전으로 자동 정렬합니다. 끝나면 `package.json` 의 `*` 가 실제 버전으로 바뀌고 `package-lock.json` 이 생기니, 두 파일 모두 커밋하세요.
3. `.env` 에 Groq API 키가 이미 들어 있습니다. (`EXPO_PUBLIC_GROQ_API_KEY`)
   `.env` 는 `.gitignore` 에 있어서 git 에 올라가지 않습니다. 키가 바뀌면 `.env` 만 고치세요. (형식은 `.env.example` 참고)

## 실행
```
npm start
```
뜨는 QR 코드를 폰의 Expo Go 로 스캔하세요. 코드를 바꿨는데 반영이 안 되면 `npm run start:clear`.
`.env` 를 수정했다면 반드시 `start:clear` 로 다시 시작해야 합니다.

시연 흐름: 로그인(아무 값) → 녹음 → KTAS 선택 → 특이사항 → 병원 매칭 및 호출

## 폴더 구조
```
App.js                 화면 전환/상태 (login → voice → review → notes)
index.js               앱 진입점
src/api.js             Groq 호출 (음성→텍스트, 텍스트→보고서 JSON)
src/handoff.js         A04 → 다음 단계로 { ktas, requiredFacilities } 전달
src/constants.js       시설 상수
src/screens/           Login(A01) Voice(A02) Review(A03) Notes(A04)
optional-backend/      Spring Boot 버전 (현재 앱에서는 사용 안 함)
```

## 참고
- Expo Go 에서 안 되는 네이티브 기능을 쓰게 되면 development build 가 필요합니다.
- 보안: `EXPO_PUBLIC_` 값은 앱에 포함됩니다. 실서비스는 서버를 거치도록 바꾸세요.

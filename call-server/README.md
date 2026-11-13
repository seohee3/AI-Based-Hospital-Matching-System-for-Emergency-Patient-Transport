# C 호출 서버

Java 17, Maven, MySQL 8을 사용한다. 한 팀이 한 기기로 확인하는 로컬 시연용이며 기본 주소는 `127.0.0.1:8082`이다.

## 서버 실행

MySQL에 빈 데이터베이스와 전용 계정을 준비한다. 계정에는 해당 DB의 테이블 생성·참조·조회·입력·수정 권한이 필요하다. 서버 시작 시 `schema.sql`이 두 테이블을 생성한다. 기존 호출은 유지된다.

`call-server` 폴더에서 PowerShell을 열고 연결 정보를 지정한다.

```powershell
$env:CALL_DB_URL = 'jdbc:mysql://127.0.0.1:3306/ersync_calls'
$env:CALL_DB_USER = 'ersync_calls'
$env:CALL_DB_PASSWORD = [System.Net.NetworkCredential]::new('', (Read-Host 'MySQL password' -AsSecureString)).Password
mvn spring-boot:run
```

폰에서 A04와 연결할 때는 서버 시작 전에 `CALL_SERVER_ADDRESS`를 노트북의 Wi-Fi IPv4 주소로 지정한다. 앱 루트의 `.env`에는 `EXPO_PUBLIC_CALL_URL=http://<같은 IPv4>:8082/api/calls`를 넣고 Expo Go를 리로드한다. B의 후보 조회 주소는 기존 `EXPO_PUBLIC_MATCH_URL`을 사용한다. MySQL 연결은 노트북 내부에서만 이뤄진다.

## 호출 생성과 상세 조회

서버가 실행 중일 때 같은 폴더의 두 번째 PowerShell에서 실행한다.

```powershell
$key = [guid]::NewGuid().ToString()
$call = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8082/api/calls' -Headers @{'Idempotency-Key'=$key} -ContentType 'application/json; charset=utf-8' -InFile '.\example-call.json'
$call | ConvertTo-Json -Depth 8
Invoke-RestMethod "http://127.0.0.1:8082/api/calls/$($call.callId)" | ConvertTo-Json -Depth 8
```

처음 생성하면 `201 Created`와 상세 조회용 `Location`을 반환한다. 같은 키와 내용으로 재전송하면 기존 호출을 `200 OK`로 돌려준다. 다른 내용에 같은 키를 쓰면 `409 Conflict`다. 요청 키는 영문·숫자와 `._:-` 문자로 구성된 1~128자 문자열이다.

보고서에는 KTAS 1~5와 문자열 배열 `requiredFacilities`가 필요하다. 후보는 1~3곳이며 각 후보의 `hpid`는 고유하고 `dutyName`은 필수다. 서버는 배열 순서대로 순위를 매기고 원래 보고서와 병원 속성을 보관한다. 생성 직후 호출과 후보는 모두 `PENDING`이다. 입력 오류는 `400`, 없는 호출 ID 조회는 `404`다.

## 병원 응답

`POST /api/calls/{callId}/hospitals/{hpid}/response`에 `{"decision":"ACCEPT"}` 또는 `{"decision":"DECLINE"}`을 보낸다.
처리한 결과와 동일한 응답의 재전송에는 현재 상세와 HTTP 200을 반환한다. 이미 확정된 다른 병원이 수락하는 등 기존 상태와 충돌하면 같은 형태의 현재 상세와 HTTP 409를 반환한다.
호출 행의 잠금을 먼저 획득한 수락이 확정되며 남은 대기 후보는 종료된다. 모든 후보가 거절하면 호출은 `ALL_DECLINED`가 된다.

## 병원 PC 시연 (H02~H05)

C 서버 실행 후 PC에서 `http://<CALL_SERVER_ADDRESS>:8082/hospital/index.html`을 연다. 앱 폴더의 로컬 `.env`에 `EXPO_PUBLIC_HOSPITAL_MODE=manual`을 설정하고 Expo 앱을 리로드하면 구급대원 화면은 병원의 응답을 기다린다. 한 기기 자동 시연으로 복귀하려면 값을 `demo`로 바꾸고 리로드한다.

앱에서 호출을 생성한 뒤 PC에서 후보 병원을 선택한다. 두 브라우저 탭에서 서로 다른 후보를 선택하면 한 병원의 수락으로 다른 탭의 대기 팝업이 닫히는 것을 확인할 수 있다. 병원별 종료 이력은 같은 페이지 하단에서 조회한다. 병원 선택기는 시연용이며 계정 인증은 제공하지 않는다.

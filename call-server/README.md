# C 호출 서버

Java 17, Maven, MySQL 8을 사용한다. 한 팀이 한 기기로 확인하는 로컬 시연용이며 기본 주소는 `127.0.0.1:8082`이다.

## 서버 실행

MySQL에 빈 데이터베이스와 전용 계정을 준비한다. 계정에는 해당 DB의 테이블 생성·참조·조회·입력·수정 권한이 필요하다. 서버 시작 시 `schema.sql`이 두 테이블을 생성한다. 기존 호출은 유지된다.

`call-server` 폴더에서 PowerShell을 열고 연결 정보와 접근 키를 지정한다. 아래 예시는 임시 키를 생성한다. 같은 계정으로 다시 접속하려면 기존 키를 다시 설정한다.

```powershell
$env:CALL_DB_URL = 'jdbc:mysql://127.0.0.1:3306/ersync_calls'
$env:CALL_DB_USER = 'ersync_calls'
$env:CALL_DB_PASSWORD = [System.Net.NetworkCredential]::new('', (Read-Host 'MySQL password' -AsSecureString)).Password
$env:CALL_AMBULANCE_KEY = [guid]::NewGuid().ToString('N')
$hospitalKey = [guid]::NewGuid().ToString('N')
$env:CALL_HOSPITAL_KEYS = "A2100020=$hospitalKey"
mvn spring-boot:run
```

폰에서 A04와 연결할 때는 서버 시작 전에 `CALL_SERVER_ADDRESS`를 노트북의 Wi-Fi IPv4 주소로 지정한다. 앱 루트의 `.env`에는 `EXPO_PUBLIC_CALL_URL=http://<같은 IPv4>:8082/api/calls`를 넣고 Expo Go를 리로드한다. B의 후보 조회 주소는 기존 `EXPO_PUBLIC_MATCH_URL`을 사용한다. MySQL 연결은 노트북 내부에서만 이뤄진다.

## 시연 노트북에서 병원 키 추가

기존 시연 키 파일을 쓰는 서버는 시작할 때 `CALL_HOSPITAL_KEY_FILE`을 해당 파일의 절대 경로로 설정한다. 위의 대원 키에는 같은 파일 둘째 줄의 기존 값을 사용한다. 파일은 시연자만 읽을 수 있는 폴더에 둔다. 파일 모드에서는 병원 인증 요청마다 해당 파일의 병원 목록을 읽는다. 파일을 지정하지 않은 서버는 기존 환경변수 방식을 사용한다.

파일 모드에서는 C 서버가 약 3초 간격으로 MySQL에 저장된 호출 후보를 확인해 누락된 hpid만 자동 발급한다. 호출 후 키 파일을 다시 열어 새 병원 키를 확인한다. 즉시 수동 동기화가 필요할 때만 `call-server` 폴더의 PowerShell에서 다음 명령을 실행한다.

```powershell
.\sync-hospital-keys.ps1
```

이 노트북의 기본 키 파일은 `%LOCALAPPDATA%\ER-Sync\call-server-demo\access-keys\demo-keys.txt`이고 시연 MySQL 포트는 33307이다. 다른 환경은 `-KeyFile`, `-Port`, `-Database`, `-DbUser`와 환경변수 `CALL_DB_PASSWORD`를 지정한다. 명령은 호출 후보 테이블을 읽고 새 hpid만 파일에 추가한다. 출력에는 추가 건수만 표시한다. 새 키로 대시보드에 접속할 때 서버를 재시작할 필요가 없다.

## 호출 생성과 상세 조회

서버가 실행 중일 때 같은 폴더의 두 번째 PowerShell에서 실행한다. 대원에게 별도로 전달한 접근 키를 입력한다.

```powershell
$key = [guid]::NewGuid().ToString()
$access = [System.Net.NetworkCredential]::new('', (Read-Host '대원 접근 키' -AsSecureString)).Password
$headers = @{Authorization="Bearer $access"; 'Idempotency-Key'=$key}
$call = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8082/api/calls' -Headers $headers -ContentType 'application/json; charset=utf-8' -InFile '.\example-call.json'
$call | ConvertTo-Json -Depth 8
Invoke-RestMethod "http://127.0.0.1:8082/api/calls/$($call.callId)" -Headers $headers | ConvertTo-Json -Depth 8
```

처음 생성하면 `201 Created`와 상세 조회용 `Location`을 반환한다. 같은 키와 내용으로 재전송하면 기존 호출을 `200 OK`로 돌려준다. 다른 내용에 같은 키를 쓰면 `409 Conflict`다. 요청 키는 영문·숫자와 `._:-` 문자로 구성된 1~128자 문자열이다.

보고서에는 KTAS 1~5와 문자열 배열 `requiredFacilities`가 필요하다. 후보는 1~3곳이며 각 후보의 `hpid`는 고유하고 `dutyName`은 필수다. 서버는 배열 순서대로 순위를 매기고 원래 보고서와 병원 속성을 보관한다. 생성 직후 호출과 후보는 모두 `PENDING`이다. 입력 오류는 `400`, 없는 호출 ID 조회는 `404`다.

## 병원 응답

병원 키를 Bearer 헤더에 넣고 `POST /api/hospitals/me/requests/{callId}/response`에 `{"decision":"ACCEPT"}` 또는 `{"decision":"DECLINE"}`을 보낸다. 성공과 동일 응답 재전송은 204, 충돌은 409다. 보고서는 해당 병원의 `GET /api/hospitals/me/requests`에서만 조회한다.
호출 행의 잠금을 먼저 획득한 수락이 확정되며 남은 대기 후보는 종료된다. 모든 후보가 거절하면 호출은 `ALL_DECLINED`가 된다.

## 병원 PC 시연 (H02~H05)

C 서버 실행 후 PC에서 `http://<CALL_SERVER_ADDRESS>:8082/hospital/index.html`을 열고 병원 키로 접속한다. 앱 로그인 화면에는 대원 키를 입력한다. 병원 키는 실제 후보 병원 hpid별로 하나씩 발급해 서버에 `hpid1=키1,hpid2=키2` 형태로 설정한다. 키는 각각 별도로 전달하고 서버 재시작 시 교체할 수 있다. 키를 Git이나 Expo 공개 환경변수에 넣지 않는다.

수동 시연은 앱의 `EXPO_PUBLIC_HOSPITAL_MODE=manual`로 설정한다. 두 브라우저 탭에 서로 다른 후보 병원 키를 입력하면 최초 수락과 타 병원 팝업 종료를 확인할 수 있다. 자동 시연은 앱의 `demo`와 C 서버의 `CALL_DEMO_ENABLED=true`를 함께 설정해야 한다. 병원 응답을 직접 받는 환경에서는 서버의 자동 시연 권한을 끈다. 핫스팟 HTTP는 가상 데이터 로컬 시연용이며 외부 배포 시 HTTPS가 필요하다.

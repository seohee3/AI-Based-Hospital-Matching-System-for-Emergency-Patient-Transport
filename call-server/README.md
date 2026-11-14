# C 호출 서버

구급대원 앱에서 보낸 호출과 병원별 응답을 MySQL에 저장하고, 병원 PC에 대시보드를 제공하는 Spring Boot 서버다. Java 17, Maven, MySQL 8을 사용한다.

## 시연 서버 실행 (Windows PowerShell)

MySQL에 `ersync_calls` 데이터베이스와 전용 계정을 준비한다. 계정에는 해당 DB의 테이블 생성·참조·조회·입력·수정 권한이 필요하다. 서버가 시작되면 `schema.sql`이 필요한 테이블을 생성한다.

`call-server` 폴더에서 다음 명령을 실행한다. 처음 사용하는 노트북에서는 사용자 전용 폴더에 키 파일을 만들고, 다음 실행부터는 같은 파일을 사용한다.

```powershell
$keyDir = Join-Path $env:LOCALAPPDATA 'ER-Sync/call-server-demo/access-keys'
$env:CALL_HOSPITAL_KEY_FILE = Join-Path $keyDir 'demo-keys.txt'
if (!(Test-Path -LiteralPath $env:CALL_HOSPITAL_KEY_FILE)) {
    New-Item -ItemType Directory -Force -Path $keyDir | Out-Null
    $lines = @('구급대원 접근 키', [guid]::NewGuid().ToString('N'), '', '병원 이름 / 병원 ID / 병원 접근 키')
    [IO.File]::WriteAllLines($env:CALL_HOSPITAL_KEY_FILE, $lines)
}
$env:CALL_AMBULANCE_KEY = [IO.File]::ReadAllLines($env:CALL_HOSPITAL_KEY_FILE)[1].Trim()
$env:CALL_DB_URL = 'jdbc:mysql://127.0.0.1:3306/ersync_calls'
$env:CALL_DB_USER = 'ersync_calls'
$env:CALL_DB_PASSWORD = [System.Net.NetworkCredential]::new('', (Read-Host 'MySQL 비밀번호' -AsSecureString)).Password
$env:CALL_SERVER_ADDRESS = Read-Host '노트북 Wi-Fi IPv4 주소'
mvn spring-boot:run
```

위 예시는 MySQL 포트 `3306`, 호출 서버 포트 `8082`를 사용한다. 기존 시연 노트북의 MySQL은 `33307`이므로 DB 주소의 포트를 바꾼다. 호출 서버가 `8083`을 사용하면 실행 전에 `$env:CALL_SERVER_PORT = '8083'`을 지정한다. 앱의 `.env`에도 같은 IP와 호출 서버 포트로 `EXPO_PUBLIC_CALL_URL=http://<노트북 IPv4>:<호출 서버 포트>/api/calls`를 설정하고 Expo를 다시 실행한다.

## 새 병원으로 첫 호출 보내기

1. 키 파일 둘째 줄의 대원 키로 앱에 로그인하고 A04에서 **병원 매칭 및 호출**을 누른다.
2. 서버는 약 3초마다 MySQL의 호출 후보를 확인한다. 처음 등장한 병원 ID(`hpid`)에만 키를 발급한다.
3. 노트북에서 `%LOCALAPPDATA%\ER-Sync\call-server-demo\access-keys\demo-keys.txt`를 다시 연다. 후보 병원의 키로 대시보드에 로그인하면 앞서 보낸 대기 호출을 확인할 수 있다.

즉시 동기화하려면 별도 PowerShell에서 `.\sync-hospital-keys.ps1 -Port 3306`을 실행한다. 실제 MySQL 포트와 DB 접속 정보를 사용한다. 키 파일 경로가 다르면 `-KeyFile`로 지정한다. 자동 발급을 사용하려면 서버에 `CALL_HOSPITAL_KEY_FILE`이 설정되어 있어야 한다.

## 호출 생성과 상세 조회

서버가 실행 중일 때 같은 폴더의 두 번째 PowerShell에서 실행한다. 아래 주소는 서버에 설정한 IP와 포트로 바꾼다. 대원에게 별도로 전달한 접근 키를 입력한다.

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

C 서버 실행 후 PC에서 `http://<CALL_SERVER_ADDRESS>:8082/hospital/index.html`을 열고 병원 키로 접속한다. 앱 로그인 화면에는 대원 키를 입력한다. 각 병원에는 해당 병원의 키만 전달한다. 환경변수로 병원 키를 직접 관리하는 경우에는 키 파일 경로를 설정하지 않고 `CALL_HOSPITAL_KEYS`를 `hpid1=키1,hpid2=키2` 형태로 지정한다. 키를 Git이나 Expo 공개 환경변수에 넣지 않는다.

수동 시연은 앱의 `EXPO_PUBLIC_HOSPITAL_MODE=manual`로 설정한다. 두 브라우저 탭에 서로 다른 후보 병원 키를 입력하면 최초 수락과 타 병원 팝업 종료를 확인할 수 있다. 자동 시연은 앱의 `demo`와 C 서버의 `CALL_DEMO_ENABLED=true`를 함께 설정해야 한다. 병원 응답을 직접 받는 환경에서는 서버의 자동 시연 권한을 끈다. 핫스팟 HTTP는 가상 데이터 로컬 시연용이며 외부 배포 시 HTTPS가 필요하다.

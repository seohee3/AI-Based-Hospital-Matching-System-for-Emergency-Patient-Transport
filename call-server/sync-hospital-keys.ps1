param(
    [string]$KeyFile = $env:CALL_HOSPITAL_KEY_FILE,
    [string]$Mysql = 'mysql',
    [string]$Database = 'ersync_calls',
    [string]$DbUser = 'ersync_calls',
    [int]$Port = 3306
)
$ErrorActionPreference = 'Stop'
$demo = Join-Path $env:LOCALAPPDATA 'ER-Sync/call-server-demo'
if (!$KeyFile) { $KeyFile = Join-Path $demo 'access-keys/demo-keys.txt' }
$KeyFile = (Resolve-Path -LiteralPath $KeyFile).Path
if (!$PSBoundParameters.ContainsKey('Port') -and $KeyFile -eq (Join-Path $demo 'access-keys\demo-keys.txt').Replace('/','\')) { $Port = 33307 }
if (!(Get-Command $Mysql -ErrorAction SilentlyContinue)) { $Mysql = "$env:ProgramFiles/MySQL/MySQL Server 8.0/bin/mysql.exe" }
$lock = [IO.File]::Open("$KeyFile.lock", 'OpenOrCreate', 'Write', 'None')
$temp = "$KeyFile.$([guid]::NewGuid()).tmp"
$oldPassword = $env:MYSQL_PWD
try {
    $lines = [IO.File]::ReadAllLines($KeyFile)
    if ($lines.Count -lt 4 -or $lines[1] -cnotmatch '^[A-Za-z0-9_-]{32,128}$') { throw 'Invalid key file header' }
    $ids = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $tokens = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    [void]$tokens.Add($lines[1])
    foreach ($line in ($lines | Select-Object -Skip 4)) {
        if (!$line.Trim()) { continue }
        if ($line -cnotmatch '^.+ / ([A-Za-z0-9_-]{1,64}) / ([A-Za-z0-9_-]{32,128})$' -or
            !$ids.Add($Matches[1]) -or !$tokens.Add($Matches[2])) { throw 'Invalid or duplicate key file entry' }
    }
    if ($env:CALL_DB_PASSWORD) { $env:MYSQL_PWD = $env:CALL_DB_PASSWORD }
    elseif (!$env:MYSQL_PWD) {
        $secure = ConvertTo-SecureString ([IO.File]::ReadAllText("$demo/db-user.dpapi").Trim())
        $env:MYSQL_PWD = [Net.NetworkCredential]::new('', $secure).Password
    }
    $sql = "SELECT hpid, HEX(MAX(hospital_snapshot->>'$.dutyName')) FROM transport_call_hospital GROUP BY hpid ORDER BY hpid"
    $rows = & $Mysql --host=127.0.0.1 "--port=$Port" "--user=$DbUser" --batch --skip-column-names $Database -e $sql
    if ($LASTEXITCODE) { throw 'Could not read hospital candidates' }
    $new = @(
        foreach ($row in $rows) {
            $id, $hex = $row -split "`t", 2
            if ($id -cnotmatch '^[A-Za-z0-9_-]{1,64}$' -or $hex -notmatch '^(?:[0-9a-fA-F]{2})+$') { throw 'Invalid hospital candidate' }
            if (!$ids.Add($id)) { continue }
            $bytes = for ($i=0; $i -lt $hex.Length; $i+=2) { [Convert]::ToByte($hex.Substring($i,2),16) }
            $name = [Text.Encoding]::UTF8.GetString([byte[]]$bytes) -replace '[\p{C}\s]+',' ' -replace ' / ','/'
            do { $token = [guid]::NewGuid().ToString('N') } until ($tokens.Add($token))
            "$name / $id / $token"
        }
    )
    if ($new.Count) {
        [IO.File]::WriteAllLines($temp, [string[]]($lines + $new), [Text.UTF8Encoding]::new($true))
        [IO.File]::Replace($temp, $KeyFile, [System.Management.Automation.Language.NullString]::Value)
    }
    Write-Output "Hospital keys added: $($new.Count)"
} finally {
    $env:MYSQL_PWD = $oldPassword
    if ([IO.File]::Exists($temp)) { [IO.File]::Delete($temp) }
    $lock.Dispose()
}

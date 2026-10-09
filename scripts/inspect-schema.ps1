param(
    [string]$SupabaseUrl = (Get-Content "$PSScriptRoot\..\.env.local" | Where-Object { $_ -like 'VITE_SUPABASE_URL=*' } | ForEach-Object { ($_ -replace '^VITE_SUPABASE_URL=','') })
)
$ErrorActionPreference = 'Stop'

if (-not $SupabaseUrl) { throw 'VITE_SUPABASE_URL not found in .env.local' }
$ref = [uri]$SupabaseUrl | Select-Object -ExpandProperty Host
$ref = $ref -replace '\.supabase\.co$',''

if (-not $env:SUPABASE_ACCESS_TOKEN) { throw 'SUPABASE_ACCESS_TOKEN env not set' }
$tok = $env:SUPABASE_ACCESS_TOKEN

$hdr = @{ Authorization = "Bearer $tok"; 'Content-Type' = 'application/json' }

function Invoke-Sql($sql) {
    $body = @{ query = $sql } | ConvertTo-Json -Compress
    $r = Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$ref/database/query" -Headers $hdr -Body $body -TimeoutSec 90
    return $r
}

Write-Output "=== project ref: $ref ==="

Write-Output "`n=== help_request_documents columns ==="
Invoke-Sql "select column_name, data_type, udt_name, is_nullable, column_default, is_identity from information_schema.columns where table_schema='public' and table_name='help_request_documents' order by ordinal_position;" | ForEach-Object { "{0}  {1}({2})  nullable={3}  default={4}  identity={5}" -f $_.column_name, $_.data_type, $_.udt_name, $_.is_nullable, $_.column_default, $_.is_identity }
Write-Output "`n=== help_requests columns ==="
Invoke-Sql "select column_name, data_type, udt_name, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name='help_requests' order by ordinal_position;" | ForEach-Object { "{0}  {1}({2})  nullable={3}  default={4}" -f $_.column_name, $_.data_type, $_.udt_name, $_.is_nullable, $_.column_default }
Write-Output "`n=== help_requests primary key ==="
Invoke-Sql "select tc.constraint_name, kcu.column_name from information_schema.table_constraints tc join information_schema.key_column_usage kcu on tc.constraint_name=kcu.constraint_name where tc.table_schema='public' and tc.constraint_type='PRIMARY KEY' and tc.table_name in ('help_requests','help_request_documents','help_request_documents');"
Write-Output "`n=== enum types in public ==="
Invoke-Sql "select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) as labels from pg_type t join pg_enum e on e.enumtypid=t.oid where t.typnamespace='public'::regnamespace group by t.typname;"
Write-Output "`n=== default document_type (udt urls) ==="
Invoke-Sql "select column_name, udt_name from information_schema.columns where table_schema='public' and table_name='help_request_documents';"

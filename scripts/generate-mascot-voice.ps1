$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskPython = Join-Path $taskRoot '.cache/mascot/venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) {
  throw 'Prepare o ambiente de voz neural descrito no README.md.'
}
& $taskPython (Join-Path $PSScriptRoot 'generate-mascot-voice.py') @args
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível gerar a narração neural.' }

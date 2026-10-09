$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskAudioDirectory = Join-Path $taskRoot '.cache/mascot'
New-Item -ItemType Directory -Force -Path $taskAudioDirectory | Out-Null
$taskPhrases = @(
  'Oi, amiguinho!',
  'Eu sou a Lumi, sua amiga da NeuroBloom.',
  'Que tal brincar comigo?',
  'Vamos pular pelos jardins, correr entre estrelas e descobrir poderes incríveis!',
  'Aqui, você brinca no seu ritmo.',
  'Escolha uma aventura e venha florescer com a gente!'
)
$taskSpeech = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $taskVoice = $taskSpeech.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'pt-BR' -and $_.Enabled } | Select-Object -First 1
  if (-not $taskVoice) { throw 'Instale uma voz de português brasileiro para gerar a narração.' }
  $taskSpeech.SelectVoice($taskVoice.VoiceInfo.Name)
  $taskSpeech.Volume = 92
  $taskSpeech.Rate = 1
  for ($taskPhraseIndex = 0; $taskPhraseIndex -lt $taskPhrases.Count; $taskPhraseIndex++) {
    $taskPhraseFile = Join-Path $taskAudioDirectory ('phrase-' + $taskPhraseIndex + '.wav')
    $taskSpeech.SetOutputToWaveFile($taskPhraseFile)
    $taskText = [System.Security.SecurityElement]::Escape($taskPhrases[$taskPhraseIndex])
    # SSML gives the original mascot a soft, bright voice without copying a real person.
    $taskSpeech.SpeakSsml('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="pt-BR"><prosody pitch="+12%">' + $taskText + '</prosody></speak>')
    $taskSpeech.SetOutputToNull()
  }
  [System.IO.File]::WriteAllText((Join-Path $taskAudioDirectory 'phrases.json'), (ConvertTo-Json -InputObject $taskPhrases -Compress), (New-Object System.Text.UTF8Encoding($false)))
  Write-Output ('Narração gerada com ' + $taskVoice.VoiceInfo.Name)
} finally { $taskSpeech.Dispose() }

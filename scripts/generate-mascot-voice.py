"""Generate Lumi's Brazilian Portuguese neural narration with Kokoro.

No browser speech engine, credentials or paid API are used. Model weights and
working WAVs stay in .cache/mascot; only the rendered video is published.
See README.md for the isolated environment and model download instructions.
"""
from pathlib import Path
import argparse
from dataclasses import asdict
import hashlib
import importlib.metadata
import json
import time
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.cache' / 'mascot'
MODELS = CACHE / 'models'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--voice', default='pf_dora')
parser.add_argument('--model', type=Path, default=MODELS / 'kokoro-v1.0.onnx')
parser.add_argument('--voices', type=Path, default=MODELS / 'voices-v1.0.bin')
args = parser.parse_args()
for model_file in (args.model, args.voices):
    if not model_file.is_file():
        parser.error(f'Modelo ausente: {model_file}. Consulte README.md.')
story = json.loads((ROOT / 'scripts' / 'mascot-story.json').read_text(encoding='utf-8'))
assert len(story) == 12 and len({s['scene'] for s in story}) == len(story)
CACHE.mkdir(parents=True, exist_ok=True)
engine = Kokoro(str(args.model), str(args.voices))
if args.voice not in engine.get_voices():
    parser.error('A voz escolhida não está neste pacote de vozes.')
start = time.monotonic()
metadata = []
for index, segment in enumerate(story):
    # Spoken spelling prevents the Portuguese phonemizer from guessing English
    # brand pronunciation; captions and the published transcript retain brands.
    spoken = segment['text'].replace('NeuroBloom', 'Neuro blum').replace('NeuroBand', 'Neuro bénd').replace('Lumi', 'Lúmi')
    speed = .88 if segment['scene'] in ('intro', 'launch') else .92
    samples, rate, phonemes = engine.create_timed(
        spoken, voice=args.voice, speed=speed, lang='pt-br',
        sentence_pause=.28, clause_pause=.12)
    samples = np.asarray(samples, dtype=np.float32).reshape(-1)
    if not np.all(np.isfinite(samples)) or len(samples) < rate * .5:
        raise RuntimeError(f'Áudio inválido na cena {segment["scene"]}')
    peak = float(np.max(np.abs(samples)))
    if peak < .01:
        raise RuntimeError(f'Narração inaudível na cena {segment["scene"]}')
    # Keep comfortable headroom, without raising quiet phrases unnecessarily.
    samples *= min(1.0, .82 / peak)
    fade = min(round(rate * .008), len(samples) // 4)
    samples[:fade] *= np.linspace(0, 1, fade)
    samples[-fade:] *= np.linspace(1, 0, fade)
    temporary = CACHE / f'phrase-{index}.tmp.wav'
    destination = CACHE / f'phrase-{index}.wav'
    sf.write(str(temporary), samples, rate, subtype='PCM_16')
    temporary.replace(destination)
    metadata.append({'scene': segment['scene'], 'text': segment['text'], 'spoken': spoken,
                     'seconds': round(len(samples) / rate, 3), 'sampleRate': rate,
                     'speed': speed, 'peak': round(float(np.max(np.abs(samples))), 4),
                     'phonemes': [asdict(p) for p in phonemes]})
    print(f'{index + 1}/{len(story)}: {segment["scene"]} ({len(samples) / rate:.1f}s)', flush=True)
(CACHE / 'phrases.json').write_text(json.dumps([s['text'] for s in story], ensure_ascii=False), encoding='utf-8')
report = {'engine': 'Kokoro-82M v1.0 / ONNX', 'packageVersion': importlib.metadata.version('kokoro-onnx'),
          'voice': args.voice, 'language': 'pt-BR', 'license': 'Apache-2.0 (model), MIT (inference)',
          'modelSha256': hashlib.file_digest(args.model.open('rb'), 'sha256').hexdigest(),
          'voicesSha256': hashlib.file_digest(args.voices.open('rb'), 'sha256').hexdigest(),
          'generatedInSeconds': round(time.monotonic() - start, 2), 'segments': metadata}
(CACHE / 'voice.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print('Narração neural em português brasileiro concluída.', flush=True)

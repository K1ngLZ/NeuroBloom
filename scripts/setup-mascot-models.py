"""Download the documented Kokoro release with published SHA-256 verification."""
from pathlib import Path
import hashlib
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / '.cache' / 'mascot' / 'models'
OUTPUT.mkdir(parents=True, exist_ok=True)
BASE = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/'
FILES = {
    'kokoro-v1.0.onnx': 'beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a',
    'voices-v1.0.bin': 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d',
}

def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()

for filename, expected in FILES.items():
    destination = OUTPUT / filename
    if destination.is_file() and digest(destination) == expected:
        print(f'{filename}: SHA-256 verificado.', flush=True)
        continue
    temporary = OUTPUT / (filename + '.download')
    request = urllib.request.Request(BASE + filename, headers={'User-Agent': 'NeuroBloom-Lumi-build'})
    with urllib.request.urlopen(request, timeout=60) as source, temporary.open('wb') as target:
        while block := source.read(1024 * 1024):
            target.write(block)
    if digest(temporary) != expected:
        temporary.unlink()
        raise RuntimeError(f'Integridade inválida para {filename}.')
    temporary.replace(destination)
    print(f'{filename}: baixado e verificado.', flush=True)

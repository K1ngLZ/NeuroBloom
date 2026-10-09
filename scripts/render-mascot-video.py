"""Render the original Lumi welcome clip from local Portuguese narration.

Run generate-mascot-voice.ps1 first. Requires Pillow, NumPy and imageio-ffmpeg.
Only the finished MP4, poster and captions are public assets.
"""
from pathlib import Path
import json
import math
import subprocess
import wave
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.cache' / 'mascot'
OUTPUT = ROOT / 'assets' / 'mascot'
OUTPUT.mkdir(parents=True, exist_ok=True)
W, H, SCALE, FPS = 960, 540, 2, 24
phrases = json.loads((CACHE / 'phrases.json').read_text(encoding='utf-8-sig'))
clips, segments, sample_rate, cursor = [], [], None, .55
for index, text in enumerate(phrases):
    with wave.open(str(CACHE / f'phrase-{index}.wav'), 'rb') as reader:
        assert reader.getnchannels() == 1 and reader.getsampwidth() == 2
        rate = reader.getframerate()
        sample_rate = sample_rate or rate
        assert rate == sample_rate
        samples = np.frombuffer(reader.readframes(reader.getnframes()), dtype='<i2').astype(np.float32) / 32768
    duration = len(samples) / rate
    segments.append({'start': cursor, 'end': cursor + duration, 'text': text})
    clips.append(samples)
    cursor += duration + .28
duration = cursor + 2.0
audio = np.zeros(math.ceil(duration * sample_rate), np.float32)
for segment, samples in zip(segments, clips):
    start = round(segment['start'] * sample_rate)
    audio[start:start + len(samples)] += samples * .9
# A quiet, original three-note greeting, fading before narration starts.
for start, frequency in [(0.02, 523.25), (.16, 659.25), (.30, 783.99)]:
    times = np.arange(round(sample_rate * .25)) / sample_rate
    bell = .027 * np.sin(2 * math.pi * frequency * times) * np.exp(-times * 18)
    offset = round(start * sample_rate)
    audio[offset:offset + len(bell)] += bell
np.clip(audio, -.97, .97, out=audio)
with wave.open(str(CACHE / 'narration.wav'), 'wb') as writer:
    writer.setnchannels(1)
    writer.setsampwidth(2)
    writer.setframerate(sample_rate)
    writer.writeframes((audio * 32767).astype('<i2').tobytes())

font_cache = {}
def font(size, bold=False):
    key = (size, bold)
    if key not in font_cache:
        filename = 'segoeuib.ttf' if bold else 'segoeui.ttf'
        font_cache[key] = ImageFont.truetype(str(Path('C:/Windows/Fonts') / filename), size * SCALE)
    return font_cache[key]

def rect(draw, box, color, radius=0, outline=None, width=1):
    box = tuple(round(v * SCALE) for v in box)
    if radius:
        draw.rounded_rectangle(box, radius=round(radius * SCALE), fill=color, outline=outline, width=width * SCALE)
    else:
        draw.rectangle(box, fill=color, outline=outline, width=width * SCALE)

def oval(draw, box, color, outline=None, width=1):
    draw.ellipse(tuple(round(v * SCALE) for v in box), fill=color, outline=outline, width=width * SCALE)

def line(draw, points, color, width=2):
    draw.line([(round(x * SCALE), round(y * SCALE)) for x, y in points], fill=color, width=width * SCALE, joint='curve')

def text(draw, xy, content, size, color, bold=False, anchor='la'):
    draw.text(tuple(round(v * SCALE) for v in xy), content, font=font(size, bold), fill=color, anchor=anchor)

def star(draw, x, y, radius, color):
    points = []
    for index in range(10):
        angle = index * math.pi / 5 - math.pi / 2
        r = radius if index % 2 == 0 else radius * .46
        points.append(((x + math.cos(angle) * r) * SCALE, (y + math.sin(angle) * r) * SCALE))
    draw.polygon(points, fill=color)

def flower(draw, x, y, radius, color):
    for i in range(5):
        a = i * math.tau / 5
        px, py = x + math.cos(a) * radius, y + math.sin(a) * radius
        oval(draw, (px - radius*.7, py - radius*.7, px + radius*.7, py + radius*.7), color)
    oval(draw, (x-radius*.55,y-radius*.55,x+radius*.55,y+radius*.55), '#fff0b8')

yy = np.linspace(0, 1, H*SCALE)[:, None, None]
top, bottom = np.array([239, 234, 250]), np.array([251, 244, 231])
gradient = np.broadcast_to((top * (1 - yy) + bottom * yy).astype(np.uint8), (H*SCALE,W*SCALE,3)).copy()
background = Image.fromarray(gradient)
d = ImageDraw.Draw(background)
oval(d, (730, -95, 1080, 235), '#f7eadf')
oval(d, (-200, 360, 635, 710), '#dae9e1')
oval(d, (290, 402, 1170, 785), '#c6dfd0')
oval(d, (-210, 465, 980, 815), '#b1d4c1')
for x, y, size, color in [(73,474,9,'#d5bce6'),(460,496,10,'#f1c9d0'),(844,465,12,'#dac4e7'),(927,488,8,'#efd79e')]:
    line(d, [(x,y+25),(x,y)], '#8ab29c', 3)
    flower(d,x,y,size,color)
flower(d, 60, 52, 8, '#b79bd8')
text(d, (83, 41), 'NeuroBloom', 20, '#6d558a', True)
text(d, (899, 49), 'UM OI DA LUMI', 12, '#9480a8', True, 'ra')
for x,y,r in [(112,144,9),(857,113,6),(444,87,5)]:
    star(d,x,y,r,'#dfbd80')

def wrap(content, size, maximum=355, bold=False):
    lines, current = [], ''
    for word in content.split():
        candidate = (current + ' ' + word).strip()
        if current and font(size,bold).getlength(candidate) > maximum*SCALE:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines

def draw_frame(t, poster=False):
    image = background.copy()
    draw = ImageDraw.Draw(image)
    current = next((i for i,s in enumerate(segments) if s['start'] <= t <= s['end']+.25), None)
    speaking = current is not None and t < segments[current]['end'] and not poster
    sample = round(t * sample_rate)
    window = audio[max(0,sample-350):min(len(audio),sample+350)]
    energy = float(np.sqrt(np.mean(window**2))) if len(window) else 0
    mouth = max(.08, min(1, energy * 13)) if speaking else 0
    bob = 2.4*math.sin(t*2.2) if not poster else 0
    wave_amount = math.sin(t*5.5) * 13 if (t < 5 or t > duration-5) and not poster else -3
    oval(draw,(201,436,360,466),'#90b8a2')
    # Rounded little boots, legs and a mint outfit.
    line(draw,[(247,390),(244,438)],'#a586c7',24)
    line(draw,[(303,390),(308,438)],'#a586c7',24)
    oval(draw,(218,431,260,455),'#9070b4')
    oval(draw,(296,431,340,455),'#9070b4')
    line(draw,[(230,328+bob),(197,360+bob),(166,356+bob)],'#b79bd8',22)
    oval(draw,(151,342+bob,178,368+bob),'#f8e1cb')
    line(draw,[(319,325+bob),(374,305+bob),(405+wave_amount,263+bob)],'#b79bd8',22)
    oval(draw,(389+wave_amount,240+bob,421+wave_amount,276+bob),'#f8e1cb')
    for i in range(3):
        line(draw,[(398+wave_amount+i*8,250+bob),(396+wave_amount+i*8,233+bob+i*2)],'#f8e1cb',7)
    rect(draw,(224,306+bob,326,409+bob),'#bfa5df',36)
    rect(draw,(228,355+bob,322,413+bob),'#91c3ae',24)
    rect(draw,(241,328+bob,309,384+bob),'#a8d2bd',15)
    line(draw,[(240,318+bob),(250,368+bob)],'#a8d2bd',12)
    line(draw,[(309,318+bob),(301,368+bob)],'#a8d2bd',12)
    oval(draw,(246,349+bob,254,357+bob),'#f7e8b7')
    oval(draw,(297,349+bob,305,357+bob),'#f7e8b7')
    star(draw,275,364+bob,13,'#fff1c9')
    # Petal hair makes Lumi an original flower companion, matching the Bloom logo.
    for i in range(8):
        angle = i*math.tau/8-math.pi/2
        x,y=275+math.cos(angle)*79,212+bob+math.sin(angle)*79
        oval(draw,(x-34,y-34,x+34,y+34),['#bda0de','#c7afe4','#b699d5'][i%3], '#aa8bc8',1)
    oval(draw,(195,132+bob,355,292+bob),'#fbeddd','#cfb5e6',4)
    oval(draw,(199,206+bob,231,226+bob),'#efd0cf')
    oval(draw,(319,206+bob,351,226+bob),'#efd0cf')
    blink = not poster and (t%4.7 > 4.55)
    if blink:
        line(draw,[(227,199+bob),(243,199+bob)],'#554165',4)
        line(draw,[(307,199+bob),(323,199+bob)],'#554165',4)
    else:
        oval(draw,(227,184+bob,245,207+bob),'#554165')
        oval(draw,(305,184+bob,323,207+bob),'#554165')
        oval(draw,(231,187+bob,237,194+bob),'#fff9f0')
        oval(draw,(309,187+bob,315,194+bob),'#fff9f0')
    oval(draw,(269,210+bob,281,218+bob),'#e4c3c6')
    if mouth > .12:
        height=9+mouth*19
        oval(draw,(257,229+bob,293,229+bob+height),'#70506c')
        oval(draw,(266,230+bob+height*.5,286,230+bob+height*.93),'#d993a7')
        rect(draw,(263,229+bob,287,233+bob),'#fff6e9',2)
    else:
        draw.arc((257*SCALE,(220+bob)*SCALE,293*SCALE,(242+bob)*SCALE),0,180,fill='#70506c',width=3*SCALE)
    for i in range(2):
        x,y=419+i*19,187+math.sin(t*2+i)*7
        star(draw,x,y,7-i*2,'#d7bd8c')
    # A large speech bubble carries the same words as the narration.
    rect(draw,(469,123,923,419),'#dfd1e8',32)
    rect(draw,(467,117,921,413),'#fffcf4',32,'#dfd1e8',2)
    draw.polygon([(468*SCALE,266*SCALE),(435*SCALE,287*SCALE),(469*SCALE,303*SCALE)],fill='#fffcf4')
    text(draw,(501,143),'LUMI',12,'#9b80b3',True)
    if poster or t<segments[0]['start']:
        caption='Oi, amiguinho!'
        index=0
    elif current is not None:
        caption=segments[current]['text']
        index=current
    elif t > segments[-1]['end']:
        caption='Vamos jogar?'
        index=0
    else:
        prior=max(i for i,s in enumerate(segments) if t>s['end'])
        caption=segments[prior]['text']
        index=prior
    size=42 if index==0 else 27
    lines=wrap(caption,size,362,True)
    line_height=size*1.26
    first_y=248-(len(lines)-1)*line_height/2
    for i, phrase_line in enumerate(lines):
        text(draw,(694,first_y+i*line_height),phrase_line,size,'#594368',True,'mm')
    text(draw,(694,379),'Toda aventura começa com um oi.',14,'#aa91b5',False,'mm')
    # Quiet, colorful tokens suggest the games without overwhelming the scene.
    for x,label,color in [(512,'Jardins','#c8e4d3'),(651,'Estrelas','#f3dfb1'),(797,'Poderes','#dbc6ed')]:
        rect(draw,(x,442,x+122,477),color,17)
        text(draw,(x+61,459),label,14,'#65526d',True,'mm')
    return image.resize((W,H),Image.Resampling.LANCZOS)

def stamp(seconds):
    ms=round(seconds*1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}.{ms%1000:03}'
captions='WEBVTT\n\n'+''.join(f'{i+1}\n{stamp(s["start"])} --> {stamp(s["end"])}\n{s["text"]}\n\n' for i,s in enumerate(segments))
(OUTPUT/'welcome.vtt').write_text(captions,encoding='utf-8')
draw_frame(1.0,poster=True).save(OUTPUT/'welcome-poster.jpg',quality=94,optimize=True)
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
command=[ffmpeg,'-y','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-i',str(CACHE/'narration.wav'),'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','fast','-crf','22','-pix_fmt','yuv420p','-c:a','aac','-b:a','112k','-ar','44100','-movflags','+faststart','-t',str(duration),str(OUTPUT/'welcome.mp4')]
with (CACHE/'ffmpeg.log').open('w',encoding='utf-8') as log:
    process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=log)
    try:
        for frame in range(math.ceil(duration*FPS)):
            process.stdin.write(draw_frame(frame/FPS).tobytes())
        process.stdin.close()
        if process.wait()!=0:
            raise RuntimeError('FFmpeg failed; inspect .cache/mascot/ffmpeg.log')
    except Exception:
        process.kill()
        raise
(CACHE/'render.json').write_text(json.dumps({'duration':round(duration,2),'width':W,'height':H,'fps':FPS,'audioPeak':float(np.max(np.abs(audio))),'segments':segments},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'durationSeconds':round(duration,2),'frames':math.ceil(duration*FPS),'videoBytes':(OUTPUT/'welcome.mp4').stat().st_size,'audioPeak':round(float(np.max(np.abs(audio))),3)},ensure_ascii=False))

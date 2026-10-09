from pathlib import Path
import math
from PIL import Image, ImageDraw, ImageFont
SCALE=2
duration=65
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


def mascot(t, mouth=0, phoneme="", poster=False):
    image=Image.new("RGBA",(500*SCALE,500*SCALE),(0,0,0,0))
    draw=ImageDraw.Draw(image)
    bob = 2.4*math.sin(t*2.2) if not poster else 0
    wave_amount = math.sin(t*5.5) * 13 if (t < 5 or t > duration-5) and not poster else -3
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
        rounded=any(c in phoneme for c in 'ouɔʊ')
        spread=any(c in phoneme for c in 'ieɛɪ')
        half_width=10 if rounded else 21 if spread else 18
        height=9+mouth*(13 if spread else 22)
        oval(draw,(275-half_width,229+bob,275+half_width,229+bob+height),'#70506c')
        oval(draw,(275-half_width*.65,230+bob+height*.5,275+half_width*.65,230+bob+height*.93),'#d993a7')
        if not rounded:rect(draw,(275-half_width*.67,229+bob,275+half_width*.67,233+bob),'#fff6e9',2)
    else:
        draw.arc((257*SCALE,(220+bob)*SCALE,293*SCALE,(242+bob)*SCALE),0,180,fill='#70506c',width=3*SCALE)
    for i in range(2):
        x,y=419+i*19,187+math.sin(t*2+i)*7
        star(draw,x,y,7-i*2,'#d7bd8c')
    return image.crop((140*SCALE,92*SCALE,445*SCALE,465*SCALE))

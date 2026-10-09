"""Render Lumi's neural narrated rocket tour; intermediates remain private.

Generate voice first. --preview-only creates a storyboard without changing
published assets. Pillow, NumPy and imageio-ffmpeg are required.
"""
from pathlib import Path
import argparse
import importlib.util
import json
import math
import subprocess
import wave
import numpy as np
from PIL import Image, ImageDraw, ImageChops
import imageio_ffmpeg

ROOT=Path(__file__).resolve().parent.parent
CACHE=ROOT/'.cache'/'mascot'
OUTPUT=ROOT/'assets'/'mascot'
OUTPUT.mkdir(parents=True,exist_ok=True)
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--preview-only',action='store_true')
args=parser.parse_args()
spec=importlib.util.spec_from_file_location('lumi_art',ROOT/'scripts'/'lumi-art.py')
art=importlib.util.module_from_spec(spec)
spec.loader.exec_module(art)
rect,oval,line,text,star,flower=art.rect,art.oval,art.line,art.text,art.star,art.flower
S=art.SCALE
W,H,FPS=960,540,24
story=json.loads((ROOT/'scripts'/'mascot-story.json').read_text(encoding='utf-8'))
phrases=json.loads((CACHE/'phrases.json').read_text(encoding='utf-8-sig'))
voice=json.loads((CACHE/'voice.json').read_text(encoding='utf-8'))
assert phrases==[s['text'] for s in story], 'Generate the current narration first.'
clips,segments,rate,cursor=[],[],None,.6
for i,scene in enumerate(story):
    with wave.open(str(CACHE/f'phrase-{i}.wav'),'rb') as reader:
        assert reader.getnchannels()==1 and reader.getsampwidth()==2
        rate=rate or reader.getframerate()
        assert rate==reader.getframerate()
        samples=np.frombuffer(reader.readframes(reader.getnframes()),dtype='<i2').astype(np.float32)/32768
    seconds=len(samples)/rate
    phonemes=voice['segments'][i]['phonemes']
    segments.append(dict(scene,start=cursor,end=cursor+seconds,phonemes=phonemes))
    clips.append(samples)
    cursor+=seconds+(.65 if scene['scene']=='launch' else .38)
duration=cursor+2
art.duration=duration
voice_audio=np.zeros(math.ceil(duration*rate),np.float32)
for segment,samples in zip(segments,clips):
    start=round(segment['start']*rate)
    voice_audio[start:start+len(samples)]+=samples*.9
# The music-free sound bed keeps the narration clear. Soft original bell notes
# mark the greeting and takeoff; no loud engines or rapid flashes.
audio=voice_audio.copy()
for offset,frequency in [(0.03,523.25),(.18,659.25),(.33,783.99)]:
    times=np.arange(round(rate*.23))/rate
    bell=.021*np.sin(2*math.pi*frequency*times)*np.exp(-times*19)
    start=round(offset*rate)
    audio[start:start+len(bell)]+=bell
np.clip(audio,-.97,.97,out=audio)

def wrap(content,size,maximum,bold=False):
    rows,current=[],''
    for word in content.split():
        candidate=(current+' '+word).strip()
        if current and art.font(size,bold).getlength(candidate)>maximum*S:
            rows.append(current);current=word
        else: current=candidate
    if current:rows.append(current)
    return rows

def block(draw,content,x,y,width,size=25,color='#594368',bold=True):
    rows=wrap(content,size,width,bold)
    for i,row in enumerate(rows):text(draw,(x,y+i*size*1.25),row,size,color,bold,'ma')
    return len(rows)*size*1.25

def gradient(top,bottom):
    yy=np.linspace(0,1,H*S)[:,None,None]
    return Image.fromarray(np.broadcast_to((np.array(top)*(1-yy)+np.array(bottom)*yy).astype(np.uint8),(H*S,W*S,3)).copy()).convert('RGBA')

garden=gradient([239,234,250],[251,244,231])
d=ImageDraw.Draw(garden)
oval(d,(730,-95,1080,235),'#f7eadf')
oval(d,(-200,360,635,710),'#dae9e1')
oval(d,(290,402,1170,785),'#c6dfd0')
oval(d,(-210,465,980,815),'#b1d4c1')
for x,y,r,c in [(73,474,9,'#d5bce6'),(460,496,10,'#f1c9d0'),(844,465,12,'#dac4e7'),(927,488,8,'#efd79e')]:
    line(d,[(x,y+25),(x,y)],'#8ab29c',3);flower(d,x,y,r,c)
space=gradient([106,86,151],[186,169,213])
d=ImageDraw.Draw(space)
oval(d,(620,-115,1040,160),'#bca1d9')
oval(d,(646,-95,1016,142),'#c4afd9')
oval(d,(-230,310,150,690),'#aecfc7')
oval(d,(-214,330,132,670),'#b8dbce')

def active_index(t):
    return max([0]+[i for i,s in enumerate(segments) if t>=s['start']])

def mouth_at(t,index):
    seg=segments[index]
    local=t-seg['start']
    if not 0<=local<=seg['end']-seg['start']:return 0,''
    center=round(t*rate)
    window=voice_audio[max(0,center-round(rate*.035)):min(len(audio),center+round(rate*.035))]
    rms=float(np.sqrt(np.mean(window*window))) if len(window) else 0
    phoneme=next((p['phoneme'] for p in seg['phonemes'] if p['start']<=local<p['end']),'')
    closed=any(c in phoneme for c in 'pbm')
    mouth=0 if closed else max(0,min(1,(rms-.009)*10))
    return mouth,phoneme

def paste_sprite(image,t,x,y,width=250,mouth=0,phoneme='',poster=False):
    sprite=art.mascot(t,mouth,phoneme,poster)
    sprite=sprite.resize((round(width*S),round(width*sprite.height/sprite.width*S)),Image.Resampling.LANCZOS)
    image.alpha_composite(sprite,(round(x*S),round(y*S)))

def heading(draw,label,space_mode=False):
    color='#fff5e9' if space_mode else '#6d558a'
    flower(draw,54,38,7,'#d5bce6' if space_mode else '#b79bd8')
    text(draw,(74,25),'NeuroBloom',19,color,True)
    text(draw,(909,34),label.upper(),12,color,True,'ra')

def rocket(t,mouth=0,phoneme='',onboard=True,flame=True,horizontal=False):
    rocket_image=Image.new('RGBA',(210*S,340*S),(0,0,0,0))
    draw=ImageDraw.Draw(rocket_image)
    # Flame changes its length gently; the colors remain constant.
    if flame:
        flick=5*math.sin(t*6)
        draw.polygon([(77*S,270*S),(105*S,(322+flick)*S),(133*S,270*S)],fill='#f0c791')
        draw.polygon([(89*S,271*S),(105*S,(301+flick)*S),(122*S,271*S)],fill='#fff0ba')
    draw.polygon([(64*S,190*S),(25*S,257*S),(69*S,247*S)],fill='#a6cebe')
    draw.polygon([(146*S,190*S),(185*S,257*S),(141*S,247*S)],fill='#a6cebe')
    rect(draw,(58,79,152,269),'#fffaed',47,'#d0b7e7',3)
    draw.polygon([(59*S,96*S),(105*S,22*S),(151*S,96*S)],fill='#bb9ddd')
    rect(draw,(63,241,147,272),'#b29bd6',9)
    oval(draw,(66,105,144,183),'#8abbab','#b29bd6',4)
    oval(draw,(71,110,139,178),'#e7f0e7')
    if onboard:
        sprite=art.mascot(t,mouth,phoneme)
        # Crop the face, preserving the same Lumi design in the porthole.
        face=sprite.crop((20*S,0,245*S,221*S)).resize((72*S,72*S),Image.Resampling.LANCZOS)
        if horizontal:face=face.rotate(90,resample=Image.Resampling.BICUBIC)
        mask=Image.new('L',face.size,0)
        ImageDraw.Draw(mask).ellipse((0,0,72*S-1,72*S-1),fill=255)
        rocket_image.paste(face,(69*S,108*S),mask)
    else:
        oval(draw,(78,118,132,172),'#b0d0c1')
        line(draw,[(116,118),(82,157)],'#eff6e9',4)
    star(draw,105,208,15,'#d5bce6')
    line(draw,[(73,229),(137,229)],'#b1d4c1',3)
    return rocket_image

def fly_rocket(image,t,mouth,phoneme,x=36,y=176,width=270):
    sprite=rocket(t,mouth,phoneme,horizontal=True).rotate(-90,expand=True,resample=Image.Resampling.BICUBIC)
    height=round(width*sprite.height/sprite.width)
    sprite=sprite.resize((width*S,height*S),Image.Resampling.LANCZOS)
    image.alpha_composite(sprite,(round(x*S),round((y+5*math.sin(t*1.5))*S)))

def space_frame(t):
    image=space.copy();draw=ImageDraw.Draw(image)
    for i in range(34):
        x=(i*137.7-t*(7+(i%3)*5))%1020-30
        y=68+(i*79)%358
        if i%3==0:star(draw,x,y,3+i%3,'#eee3cf')
        else:oval(draw,(x-1,y-1,x+1,y+1),'#e6dced')
    # Warm slow orbit, no pulsing lights.
    oval(draw,(205,62,263,120),'#f4d6ae')
    draw.arc((189*S,80*S,281*S,110*S),0,340,fill='#dcc0df',width=5*S)
    return image

def tiny_hero(draw,x,y,color='#a085ce',sword=False):
    line(draw,[(x-6,y+20),(x-9,y+32)],'#9a79b5',6)
    line(draw,[(x+6,y+20),(x+12,y+31)],'#9a79b5',6)
    rect(draw,(x-13,y,x+13,y+24),color,9)
    oval(draw,(x-14,y-22,x+14,y+3),'#fbeddd',color,3)
    oval(draw,(x-7,y-12,x-3,y-7),'#554165')
    oval(draw,(x+4,y-12,x+8,y-7),'#554165')
    if sword:line(draw,[(x+12,y+6),(x+36,y-15)],'#ecd5a2',6)

def tree(draw,x,y,r=27):
    line(draw,[(x,y),(x,y+42)],'#a78e91',8)
    oval(draw,(x-r,y-r,x+r,y+r),'#8db8a6')
    oval(draw,(x-r+5,y-r-7,x+r-8,y+r-10),'#a8cebb')

def crystal(draw,x,y,color='#bea1e0',radius=11):
    draw.polygon([(x*S,(y-radius)*S),((x+radius*.7)*S,y*S),(x*S,(y+radius)*S),((x-radius*.7)*S,y*S)],fill=color)
    line(draw,[(x,y-radius+3),(x-3,y)],'#fffaed',2)

GAME_NAMES={'platform':'Jardins de Aurora','speed':'Rastro Solar','sword':'Espada da Aurora','ninja':'Ninja do Vento','energy':'Arena Cósmica'}
GAME_SUB={'platform':'Salte entre ilhas e encontre cristais','speed':'Corra, pule e alcance os anéis','sword':'Explore, aprimore e ajude a guardiã','ninja':'Salte nas paredes e domine o vento','energy':'Voe, faça combos e descubra poderes'}

def tour_card(image,scene,t,local):
    draw=ImageDraw.Draw(image)
    rect(draw,(326,78,918,425),'#c8b6df',28)
    rect(draw,(322,72,914,419),'#fffaf0',28,'#ddd0e9',2)
    text(draw,(350,88),'BLOOM ARCADE' if scene in GAME_NAMES else 'SEU UNIVERSO NEUROBLOOM',11,'#a28ab9',True)
    title=GAME_NAMES.get(scene,{'profile':'Uma aventura com seu nome','band':'Conheça a NeuroBand','family':'Sua família pertinho'}[scene] if scene not in GAME_NAMES else '')
    text(draw,(350,109),title,26,'#624b7d',True)
    if scene in GAME_NAMES:
        text(draw,(350,144),GAME_SUB[scene],15,'#967d9f')
        rect(draw,(346,177,890,397),'#ede6f5',18)
        game_art=Image.new('RGBA',image.size,(0,0,0,0))
        draw=ImageDraw.Draw(game_art)
    if scene=='platform':
        oval(draw,(354,301,674,514),'#d7e9dd')
        oval(draw,(678,304,995,503),'#c8decf')
        for x,y in [(414,309),(595,277),(765,319)]:
            rect(draw,(x-58,y,x+58,y+31),'#b7d2bf',14)
            rect(draw,(x-59,y-5,x+59,y+6),'#89b39a',6)
            crystal(draw,x+12,y-34,'#bf9fde',13)
        phase=(local*.5)%1
        x=413+phase*185;y=285-75*math.sin(phase*math.pi)
        tiny_hero(draw,x,y)
        flower(draw,842,272,14,'#e4b4ce')
    elif scene=='speed':
        oval(draw,(343,271,943,488),'#d2e6d9')
        line(draw,[(363,350),(550,350),(650,293),(868,293)],'#a2c5b1',13)
        for k in range(5):
            x=522+k*64;y=274+12*math.sin(k*.8+local*.8)
            oval(draw,(x-12,y-16,x+12,y+16),None,'#e7c287',5)
        x=415+((local*.45)%1)*205
        line(draw,[(x-90,333),(x-36,333)],'#c7abe8',5)
        line(draw,[(x-67,347),(x-30,347)],'#d4bdee',3)
        tiny_hero(draw,x,322,'#bd9ddf')
        rect(draw,(826,277,850,295),'#e4b4bb',5)
        line(draw,[(832,294),(844,304),(832,313),(844,322)],'#d59fab',4)
    elif scene=='sword':
        rect(draw,(348,178,888,394),'#dbe9df',18)
        line(draw,[(432,385),(553,300),(700,328),(818,212)],'#f1dfc5',36)
        for x,y in [(396,212),(473,230),(527,369),(841,350),(744,223),(680,378)]:tree(draw,x,y,23)
        for x,y in [(597,230),(731,344),(806,279)]:crystal(draw,x,y+math.sin(local*2+x)*3,'#b8a4de',13)
        tiny_hero(draw,605,313+math.sin(local*2)*3,sword=True)
        oval(draw,(817,190,861,234),'#d1b9e9')
        flower(draw,839,211,10,'#ae91d0')
    elif scene=='ninja':
        oval(draw,(700,191,861,309),'#f6dec0')
        for x,y,height in [(397,307,90),(571,244,150),(752,304,93)]:
            rect(draw,(x,y,x+70,397),'#bfafd6',6)
            draw.polygon([((x-13)*S,y*S),((x+35)*S,(y-28)*S),((x+83)*S,y*S)],fill='#8f9aae')
            rect(draw,(x+21,y+12,x+49,y+39),'#f8efd6',6)
        phase=(local*.43)%1
        x=448+phase*160;y=279-65*math.sin(phase*math.pi)
        tiny_hero(draw,x,y,'#a6b6c7')
        line(draw,[(x-60,y+10),(x-29,y+6)],'#aecdbb',4)
        star(draw,799+math.sin(local)*20,229,12,'#8a9eae')
    elif scene=='energy':
        for x,y in [(433,330),(693,333),(822,343)]:
            oval(draw,(x-65,y-19,x+65,y+22),'#fffcf7')
            oval(draw,(x-37,y-42,x+27,y+18),'#fffcf7')
        tiny_hero(draw,460,273+math.sin(local*2)*12,'#b5a0dc')
        tiny_hero(draw,802,289+math.sin(local*1.5)*9,'#e4b3c1')
        for r in [34,25]:oval(draw,(558-r,265-r,558+r,265+r),'#d8c9ed' if r==34 else '#e9def9')
        star(draw,558,265,16,'#fff3cb')
        line(draw,[(597,265),(733,286)],'#c1b1df',9)
        line(draw,[(597,265),(733,286)],'#eee2ff',3)
        text(draw,(367,372),'Voo  •  Combos  •  Energia',15,'#8d75a2',True)
    elif scene=='profile':
        oval(draw,(352,159,433,240),'#dcc7ed')
        flower(draw,391,200,20,'#b598d4')
        text(draw,(455,164),'SEU APELIDO',12,'#a28ab9',True)
        rect(draw,(451,187,867,232),'#f0e9f7',13)
        text(draw,(472,197),'Explorador Estelar',21,'#775b91',True)
        text(draw,(354,259),'Cada conquista fica com você.',19,'#8f759f',True)
        for x,color in [(411,'#e8c98f'),(530,'#b3d4c2'),(649,'#c9afe6')]:
            oval(draw,(x-30,292,x+30,352),'#f1e8f7');star(draw,x,322,20,color)
        rect(draw,(713,300,868,348),'#b4d6c2',15)
        text(draw,(790,324),'Continuar  →',15,'#577f6b',True,'mm')
        text(draw,(358,373),'Seu progresso • Suas aventuras',14,'#987fa7')
    elif scene=='band':
        # A friendly wrist with the same mint band/rounded screen as the site.
        rect(draw,(387,227,597,299),'#f0d7c0',34)
        rect(draw,(455,174,523,346),'#9fc7b5',22)
        rect(draw,(437,216,543,309),'#af98cd',26)
        rect(draw,(447,226,533,299),'#eff6ea',20)
        flower(draw,490,260,15,'#b599d4')
        for j in range(4):
            x=580+j*24
            oval(draw,(x,258,x+5,263),'#b5cdbd')
        rect(draw,(702,193,855,340),'#b6a2d0',20)
        rect(draw,(710,201,847,331),'#fbf7ed',14)
        flower(draw,776,242,13,'#b399d0')
        text(draw,(778,280),'Conexão',16,'#85699e',True,'mm')
        text(draw,(778,303),'NeuroBand',12,'#a08dab',False,'mm')
        text(draw,(612,376),'Os registros aparecem quando conectada.',16,'#947b9f',False,'mm')
    elif scene=='family':
        rect(draw,(348,159,887,393),'#f1eafa',18)
        text(draw,(371,177),'PAINEL DA FAMÍLIA',13,'#997aad',True)
        rect(draw,(368,209,626,357),'#fffcf5',17)
        text(draw,(389,225),'NeuroBand',18,'#795a92',True)
        text(draw,(395,255),'—',36,'#987eab',True)
        text(draw,(389,306),'Aguardando leitura',14,'#a593aa')
        text(draw,(389,332),'Histórico de registros',12,'#a593aa')
        oval(draw,(674,215,715,256),'#bfdccb')
        oval(draw,(733,221,766,254),'#e3d0ef')
        line(draw,[(693,265),(692,318)],'#a5cdb7',28)
        line(draw,[(749,263),(749,313)],'#c7ade0',23)
        line(draw,[(706,277),(734,278)],'#eed6bf',8)
        text(draw,(727,349),'Juntos, no seu ritmo.',13,'#927ba2',True,'mm')
    if scene in GAME_NAMES:
        mask=Image.new('L',image.size,0)
        ImageDraw.Draw(mask).rounded_rectangle((346*S,177*S,890*S,397*S),radius=18*S,fill=255)
        game_art.putalpha(ImageChops.multiply(game_art.getchannel('A'),mask))
        image.alpha_composite(game_art)


def subtitle(image,content):
    draw=ImageDraw.Draw(image)
    rows=wrap(content,24,864,True)
    # Three lines at most; a generous full-width strip keeps narration legible.
    height=20+len(rows)*30
    rect(draw,(26,H-height-10,934,H-10),'#fff9ef',18)
    for i,row in enumerate(rows):text(draw,(480,H-height+2+i*30),row,24,'#645075',True,'ma')


def scene_frame(t,index,poster=False):
    segment=segments[index]
    scene=segment['scene'];local=max(0,t-segment['start'])
    mouth,phoneme=mouth_at(t,index)
    if poster:mouth,phoneme=0,''
    if scene in ('intro','invite'):
        image=garden.copy();draw=ImageDraw.Draw(image)
        heading(draw,'Um passeio com a Lumi')
        oval(draw,(156,440,340,468),'#98bea8')
        paste_sprite(image,t,106,100,290,mouth,phoneme,poster)
        rect(draw,(465,117,921,415),'#fffaf2',32,'#dfd1e8',2)
        draw.polygon([(466*S,265*S),(437*S,287*S),(466*S,304*S)],fill='#fffaf2')
        text(draw,(495,141),'LUMI',12,'#9b80b3',True)
        content='Oi, amiguinho!' if poster else segment['text']
        size=40 if poster else 28
        rows=wrap(content,size,376,True)
        y=257-len(rows)*size*.625
        for i,row in enumerate(rows):text(draw,(694,y+i*size*1.25),row,size,'#594368',True,'ma')
        text(draw,(694,382),'Uma viagem cheia de descobertas.',14,'#aa91b5',False,'mm')
        for x,label,color in [(492,'Jogos','#c8e4d3'),(632,'Foguete','#f3dfb1'),(772,'NeuroBand','#dbc6ed')]:
            rect(draw,(x,443,x+122,478),color,17);text(draw,(x+61,460),label,14,'#65526d',True,'mm')
    elif scene=='launch':
        progress=min(1,local/(segment['end']-segment['start']))
        image=garden.copy()
        if progress>.72:image=Image.blend(garden,space_frame(t),min(1,(progress-.72)/.25))
        draw=ImageDraw.Draw(image);heading(draw,'Três, dois, um... vamos explorar!')
        rect(draw,(526,422,787,443),'#accbb6',11)
        boarded=progress>.48
        rise=max(0,(progress-.68)/.32)**1.5*550
        vehicle=rocket(t,mouth,phoneme,onboard=boarded,flame=progress>.62)
        vehicle=vehicle.resize((189*S,306*S),Image.Resampling.LANCZOS)
        image.alpha_composite(vehicle,(562*S,round((134-rise)*S)))
        if progress<=.48:
            step=min(1,progress/.48)
            jump=max(0,(step-.75)/.25)
            paste_sprite(image,t,164+step*448,220-jump*57,152*(1-.35*jump),mouth,phoneme)
            # A visible open hatch invites Lumi aboard.
            rect(draw,(617,304,687,385),'#9bb6b1',13)
            line(draw,[(603,388),(685,388)],'#d0b5e3',7)
        if .48<progress<.68:
            number='3' if progress<.55 else '2' if progress<.62 else '1'
            oval(draw,(338,170,452,284),'#fff8ed')
            text(draw,(395,227),number,58,'#a78aca',True,'mm')
        subtitle(image,segment['text'])
    elif scene=='outro':
        image=garden.copy();draw=ImageDraw.Draw(image)
        heading(draw,'Sua próxima aventura começa aqui')
        vehicle=rocket(t,onboard=False,flame=False).resize((105*S,170*S),Image.Resampling.LANCZOS)
        image.alpha_composite(vehicle,(783*S,266*S))
        paste_sprite(image,t,82,108,267,mouth,phoneme)
        text(draw,(624,119),'Gostou do passeio?',33,'#6b4e87',True,'mm')
        text(draw,(624,162),'Escolha sua aventura!',22,'#9a7bb1',True,'mm')
        for i,(key,name) in enumerate(GAME_NAMES.items()):
            y=197+i*36
            flower(draw,412,y+14,5,'#b99bd8')
            text(draw,(432,y),name,19,'#82649b',True)
        rect(draw,(425,390,759,444),'#aeceb9',22)
        text(draw,(592,416),'Vamos jogar!  →',25,'#496e5b',True,'mm')
        subtitle(image,segment['text'])
    else:
        image=space_frame(t);draw=ImageDraw.Draw(image)
        heading(draw,'Um universo para explorar',True)
        fly_rocket(image,t,mouth,phoneme)
        text(draw,(166,362),'LUMI A BORDO',12,'#fff1e4',True,'mm')
        tour_card(image,scene,t,local)
        subtitle(image,segment['text'])
    return image


def draw_frame(t,poster=False):
    index=active_index(t)
    image=scene_frame(t,index,poster)
    if not poster and index>0:
        elapsed=t-segments[index]['start']
        if elapsed<.35:
            previous=scene_frame(segments[index]['start']-.01,index-1)
            image=Image.blend(previous,image,max(0,elapsed/.35))
    return image.convert('RGB').resize((W,H),Image.Resampling.LANCZOS)

def stamp(seconds):
    ms=round(seconds*1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}.{ms%1000:03}'

# Storyboard snapshots are never part of the public build.
shots=[]
for i,seg in enumerate(segments):
    time=seg['start']+min(2.1,(seg['end']-seg['start'])*.6)
    shot=draw_frame(time);shots.append((seg['scene'],shot))
    shot.save(CACHE/f'scene-{i:02}-{seg["scene"]}.jpg',quality=92)
launch=segments[2]
for label,progress in [('boarding',.3),('aboard',.58),('takeoff',.8)]:
    shot=draw_frame(launch['start']+(launch['end']-launch['start'])*progress)
    shot.save(CACHE/f'launch-{label}.jpg',quality=92)
    shots.append((label,shot))
sheet=Image.new('RGB',(960,math.ceil(len(shots)/3)*202),'#ede5f4')
for i,(label,shot) in enumerate(shots):
    x=(i%3)*320;y=(i//3)*202
    sheet.paste(shot.resize((320,180),Image.Resampling.LANCZOS),(x,y))
    ImageDraw.Draw(sheet).text((x+8,y+183),label,fill='#655175')
sheet.save(CACHE/'storyboard.jpg',quality=94)
if args.preview_only:
    print(json.dumps({'preview':str(CACHE/'storyboard.jpg'),'durationSeconds':round(duration,2),'scenes':len(segments)},ensure_ascii=False))
else:
    with wave.open(str(CACHE/'narration.wav'),'wb') as writer:
        writer.setnchannels(1);writer.setsampwidth(2);writer.setframerate(rate)
        writer.writeframes((audio*32767).astype('<i2').tobytes())
    captions='WEBVTT\n\n'+''.join(f'{i+1}\n{stamp(s["start"])} --> {stamp(s["end"])}\n{s["text"]}\n\n' for i,s in enumerate(segments))
    (OUTPUT/'welcome.vtt').write_text(captions,encoding='utf-8')
    draw_frame(1,poster=True).save(OUTPUT/'welcome-poster.jpg',quality=94,optimize=True)
    target=CACHE/'welcome-render.mp4'
    command=[imageio_ffmpeg.get_ffmpeg_exe(),'-y','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-i',str(CACHE/'narration.wav'),'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','fast','-crf','22','-pix_fmt','yuv420p','-c:a','aac','-b:a','112k','-ar','44100','-movflags','+faststart','-t',str(duration),str(target)]
    with (CACHE/'ffmpeg.log').open('w',encoding='utf-8') as log:
        process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=log)
        try:
            count=math.ceil(duration*FPS)
            for frame in range(count):
                process.stdin.write(draw_frame(frame/FPS).tobytes())
                if frame%(FPS*5)==0:print(f'Render: {round(frame/count*100)}%',flush=True)
            process.stdin.close()
            if process.wait()!=0:raise RuntimeError('FFmpeg failed; inspect .cache/mascot/ffmpeg.log')
        except Exception:
            process.kill();raise
    target.replace(OUTPUT/'welcome.mp4')
    report={'duration':round(duration,3),'width':W,'height':H,'fps':FPS,'voice':voice['voice'],'audioPeak':float(np.max(np.abs(audio))),'segments':segments}
    (CACHE/'render.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'durationSeconds':round(duration,2),'frames':count,'videoBytes':(OUTPUT/'welcome.mp4').stat().st_size,'audioPeak':round(float(np.max(np.abs(audio))),3)},ensure_ascii=False))

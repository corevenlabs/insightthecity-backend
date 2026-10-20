"""Design composition using the production banner assets and exact bundled fonts.
Not a browser screenshot; HTML previews are saved separately for email-client QA.
"""
from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import json
root=Path(__file__).resolve().parent.parent
out=root/'output/payment-failed-preview'; out.mkdir(parents=True,exist_ok=True)
fontpath=root/'public/brand/fonts/RobotoCondensed_900Black.ttf'
for lang,lines in {'es':['Tu pago necesita','atención.'],'en':['Your payment','needs attention.'],'pt':['Seu pagamento','precisa de atenção.']}.items():
 im=Image.open(root/'public/email/membership-phone-background-v1.png').convert('RGB').resize((1200,565))
 d=ImageDraw.Draw(im); f=ImageFont.truetype(str(fontpath),82 if lang!='pt' else 74)
 for i,line in enumerate(lines):d.text((48,135+i*94),line,font=f,fill='white' if i==0 else '#FDDD56')
 im.save(root/f'public/email/membership-payment-failed-{lang}-v1.png')
# Layout mirrors the email's 600px table, 32px content padding and Arial body.
S=2; canvas=Image.new('RGB',(680*S,1800*S),'#080808');d=ImageDraw.Draw(canvas)
font=lambda size,bold=False:ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial'+(' Bold' if bold else '')+'.ttf',round(size*S))
def rect(box,fill,outline=None,radius=0):
 box=tuple(round(v*S) for v in box)
 if radius:d.rounded_rectangle(box,radius=radius*S,fill=fill,outline=outline,width=S)
 else:d.rectangle(box,fill=fill,outline=outline,width=S)
def text(x,y,t,size=16,color='#dddddd',bold=False):d.text((round(x*S),round(y*S)),t,font=font(size,bold),fill=color)
def para(y,t,size=16,color='#ddd',bold=False):
 f=font(size,bold);line='';lines=[]
 for word in t.split():
  candidate=(line+' '+word).strip()
  if d.textlength(candidate,font=f)>536*S:lines.append(line);line=word
  else:line=candidate
 lines.append(line)
 for line in lines:text(72,y,line,size,color,bold);y+=size*1.65
 return y+22
fixture=json.loads((out/'fixture.json').read_text());c=fixture['copy']
rect((40,24,640,1700),'#0a0a0a')
logo=Image.open(root/'public/email/itc-club-logo-v1.png').convert('RGBA');lh=round(150*logo.height/logo.width)
logo=logo.resize((300,lh*S));canvas.paste(logo,(265*S,52*S),logo)
y=52+lh+28
banner=Image.open(root/'public/email/membership-payment-failed-es-v1.png').resize((1200,565));canvas.paste(banner,(40*S,round(y*S)));y+=282.5+32
y=para(y,'Hola, Rafa,',bold=True,color='#FDDD56');y=para(y,c['body'])
rect((72,y,608,y+96),'#151515','#333333',10);text(92,y+18,c['amount'],14,'#bbb');text(92,y+44,'$4.99',28,'#FDDD56',True);y+=120
rect((72,y,608,y+56),'#FDDD56',radius=10)
w=d.textlength(c['button'],font=font(16,True))/S;text(340-w/2,y+18,c['button'],16,'#0a0a0a',True);y+=80
y=para(y,c['secure']);y=para(y,c['note']);y+=6
d.line((72*S,round(y*S),608*S,round(y*S)),fill='#333',width=S);y+=28
text(72,y,c['help'],18,'white',True);y+=34;y=para(y,c['support']);text(72,y,'ITCClub@insightthecity.com',14,'#FDDD56');y+=52
for line in ['ITC CLUB · Insight The City','Términos · Privacidad']:
 w=d.textlength(line,font=font(12))/S;text(340-w/2,y,line,12,'#999');y+=22
y+=28
# Remove unused canvas and draw the border at the actual content height.
canvas=canvas.crop((0,0,680*S,round((y+24)*S)));d=ImageDraw.Draw(canvas);d.rectangle((40*S,24*S,640*S,round(y*S)),outline='#303030',width=S)
canvas.save(out/'correo-pago-fallido-es.png')

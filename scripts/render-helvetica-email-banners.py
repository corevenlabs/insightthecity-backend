"""Render branded email banners with a locally supplied Helvetica Neue Condensed Black font.
No font binaries are copied to public assets. Requires fonttools, reportlab and pdftoppm.
Usage: python scripts/render-helvetica-email-banners.py /path/to/font.ttc /path/to/spec.json
"""
import json,sys,subprocess,tempfile,os
from pathlib import Path
from fontTools.ttLib import TTCollection,TTFont
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont as RLFont
ROOT=Path(__file__).resolve().parents[1]
font_path=Path(sys.argv[1]);spec=json.loads((Path(sys.argv[2]) if len(sys.argv)>2 else ROOT/'config/email-banner-spec.json').read_text())
if font_path.suffix.lower()=='.ttc':
 collection=TTCollection(str(font_path))
 matches=[font for font in collection.fonts if any(n.nameID==6 and n.toUnicode()=='HelveticaNeue-CondensedBlack' for n in font['name'].names)]
 if not matches:raise ValueError('Exact Condensed Black face not found')
 font=matches[0]
else:font=TTFont(str(font_path))
extra=[
 ['membership-payment-failed-es-v1.png',['Tu pago necesita','atención.'],'',1,50,130,86],
 ['membership-payment-failed-en-v1.png',['Your payment needs','attention.'],'',1,50,130,86],
 ['membership-payment-failed-pt-v1.png',['Seu pagamento precisa','de atenção.'],'',1,50,130,86],
]
spec+=extra
all_spec=spec[:]
selected=set(filter(None,os.environ.get("BANNER_FILTER", "").split(",")))
if selected: spec=[item for item in spec if item[0] in selected]
with tempfile.TemporaryDirectory(prefix='itc-font-render-') as temp:
 temp=Path(temp);font.save(str(temp/'local-font.ttf'));pdfmetrics.registerFont(RLFont('ITC-HNCB',str(temp/'local-font.ttf')))
 pdf=temp/'banners.pdf';c=canvas.Canvas(str(pdf),pagesize=(1200,564))
 for name,lines,subtitle,gold,x,y,size in spec:
  c.drawImage(str(ROOT/'public/email/membership-phone-background-v1.png'),0,0,width=1200,height=564)
  while max(pdfmetrics.stringWidth(line,'ITC-HNCB',size) for line in lines)>565 and size>35:size-=1
  if max(pdfmetrics.stringWidth(line,'ITC-HNCB',size) for line in lines)>565:raise ValueError(name)
  baseline=564-y-size*.86
  for i,line in enumerate(lines):
   c.setFont('ITC-HNCB',size);c.setFillColorRGB(*( (253/255,221/255,86/255) if i==gold else (1,1,1)))
   c.drawString(x,baseline-i*size*1.04,line)
  if subtitle:
   subsize=min(29,565/max(pdfmetrics.stringWidth(subtitle,'ITC-HNCB',1),1));c.setFont('ITC-HNCB',subsize);c.setFillColorRGB(1,1,1)
   sub_y=baseline-(len(lines)-1)*size*1.04-size*.25-24-subsize
   if sub_y<20:raise ValueError('Subtitle overflow: '+name)
   c.drawString(x,sub_y,subtitle)
  c.showPage()
 c.save();subprocess.run(['pdftoppm','-r','108','-png',str(pdf),str(temp/'banner')],check=True)
 pngs=sorted(temp.glob('banner-*.png'))
 assert len(pngs)==len(spec)
 mapping={item[0]:item[0][:-4]+'-hncb-v3.png' for item in all_spec}
 for item,png in zip(spec,pngs):
  old=item[0];new=old[:-4]+'-hncb-v3.png';(ROOT/'public/email'/new).write_bytes(png.read_bytes());mapping[old]=new
 (ROOT/'config/email-helvetica-banners.json').write_text(json.dumps(mapping,indent=2)+'\n')
 print('Rendered',len(mapping),'banners with exact Helvetica Neue Condensed Black')

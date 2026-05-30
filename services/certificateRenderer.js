const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const puppeteer = require('puppeteer');

const uploadsBase = ()=>path.resolve(process.env.UPLOAD_DIR||'uploads');

const readAsDataUrl=(absolutePath)=>{
  if(!absolutePath||!fs.existsSync(absolutePath)) return null;
  const ext=path.extname(absolutePath).toLowerCase();
  const mime=ext==='.png'?'image/png':ext==='.jpg'||ext==='.jpeg'?'image/jpeg':ext==='.webp'?'image/webp':'application/octet-stream';
  const b64=fs.readFileSync(absolutePath).toString('base64');
  return `data:${mime};base64,${b64}`;
};

const esc=(v='')=>String(v)
  .replace(/&/g,'&amp;')
  .replace(/</g,'&lt;')
  .replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;')
  .replace(/'/g,'&#39;');

const formatInlineBoldHtml=text=>{
  const raw=String(text??'');
  const matches=raw.match(/\*\*/g);
  if(!matches||matches.length%2!==0) return esc(raw);
  return esc(raw).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
};

const renderTextValue=(element,payload)=>{
  const value=resolveTextValue(element,payload);
  return element?.key==='custom'
    ? formatInlineBoldHtml(value)
    : esc(value);
};

const num=(value,fallback=0)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};

const EDITOR_PAGE_SIZE={ width:1920, height:1358 };
const PDF_PAGE_SIZE={ width:3508, height:2480 };

const scaleValue=(value,scale,fallback)=>value==null?fallback:Math.round(num(value,fallback)*scale);
const scaleElementToPage=(e,scaleX,scaleY)=>{
  if(!e||typeof e!=='object') return e;
  return {
    ...e,
    x:scaleValue(e.x,scaleX,0),
    y:scaleValue(e.y,scaleY,0),
    width:e.width==null?e.width:scaleValue(e.width,scaleX,e.width),
    height:e.height==null?e.height:scaleValue(e.height,scaleY,e.height),
    maxWidth:e.maxWidth==null?e.maxWidth:scaleValue(e.maxWidth,scaleX,e.maxWidth),
    fontSize:e.fontSize==null?e.fontSize:scaleValue(e.fontSize,scaleY,e.fontSize),
    titleGap:e.titleGap==null?e.titleGap:scaleValue(e.titleGap,scaleY,e.titleGap),
    spaceGap:e.spaceGap==null?e.spaceGap:scaleValue(e.spaceGap,scaleY,e.spaceGap),
    spaceHeight:e.spaceHeight==null?e.spaceHeight:scaleValue(e.spaceHeight,scaleY,e.spaceHeight),
    nameGap:e.nameGap==null?e.nameGap:scaleValue(e.nameGap,scaleY,e.nameGap),
    nipGap:e.nipGap==null?e.nipGap:scaleValue(e.nipGap,scaleY,e.nipGap)
  };
};

const scaleLayoutForPdf=(layout)=>{
  const source=layout||{};
  const page1=source.page1||{};
  const page2=source.page2||{};
  const sourceWidth=Math.max(1,num(page1.width,EDITOR_PAGE_SIZE.width));
  const sourceHeight=Math.max(1,num(page1.height,EDITOR_PAGE_SIZE.height));
  const scaleX=PDF_PAGE_SIZE.width/sourceWidth;
  const scaleY=PDF_PAGE_SIZE.height/sourceHeight;
  const mapPage=page=>({
    ...page,
    width:PDF_PAGE_SIZE.width,
    height:PDF_PAGE_SIZE.height,
    elements:(page?.elements||[]).map(e=>scaleElementToPage(e,scaleX,scaleY))
  });
  return {
    page1:mapPage(page1),
    page2:mapPage(page2)
  };
};

const normalizeText=(e={})=>({
  ...e,
  kind:'text',
  key:String(e.key||'custom'),
  customText:String(e.customText||''),
  x:num(e.x),
  y:num(e.y),
  fontSize:num(e.fontSize,24),
  fontFamily:String(e.fontFamily||'Arial'),
  fontWeight:num(e.fontWeight,400),
  color:String(e.color||'#1f2937'),
  align:['left','center','right'].includes(e.align)?e.align:'left',
  maxWidth:e.maxWidth==null||e.maxWidth===''?undefined:num(e.maxWidth)
});

const normalizeVisualElement=(e={})=>({
  ...e,
  x:num(e.x),
  y:num(e.y),
  width:num(e.width,160),
  height:num(e.height,80),
  key:String(e.key||'signer1')
});

const normalizeTtdGroup=(e={})=>({
  ...e,
  kind:'ttd_group',
  key:String(e.key||'signer1'),
  x:num(e.x),
  y:num(e.y),
  width:num(e.width,e.key==='signer1'?360:320),
  height:num(e.height,e.key==='signer1'?290:230),
  fontSize:num(e.fontSize,22),
  fontFamily:String(e.fontFamily||'Arial'),
  titleGap:num(e.titleGap,e.key==='signer1'?38:0),
  spaceGap:num(e.spaceGap,e.key==='signer1'?84:46),
  spaceHeight:num(e.spaceHeight,e.key==='signer1'?120:110),
  nameGap:num(e.nameGap,e.key==='signer1'?214:166),
  nipGap:num(e.nipGap,e.key==='signer1'?248:200)
});

const normalizeElement=e=>{
  if(!e||typeof e!=='object') return null;
  if(e.kind==='text') return normalizeText(e);
  if(['cap_image','sign_image','ttd_space','participant_photo'].includes(e.kind)) return normalizeVisualElement(e);
  if(e.kind==='ttd_group') return normalizeTtdGroup(e);
  return e;
};

const resolveTextValue=(element,payload={})=>{
  if(!element||element.kind!=='text') return '';
  if(element.key==='custom') return String(element.customText||'');
  const valueMap={
    full_name:payload.full_name,
    full_name_with_title:payload.full_name_with_title,
    nidn:payload.nidn,
    birthplace:payload.birthplace,
    city:payload.city,
    institution:payload.institution,
    unit_kerja:payload.unit_kerja,
    certificate_no:payload.certificate_no,
    issued_date:payload.issued_date,
    sample_date_text:payload.sample_date_text,
    signer1_name:payload.signer1_name,
    signer1_title:payload.signer1_title,
    signer1_nip:payload.signer1_nip,
    signer2_name:payload.signer2_name,
    signer2_title:payload.signer2_title,
    signer2_nip:payload.signer2_nip,
    certificate_type:payload.certificate_type
  };
  return String(valueMap[element.key]??'');
};

const validateLayout=(layout)=>{
  const l=layout||{};
  const page1=l.page1||{};
  const page2=l.page2||{};
  const els1=Array.isArray(page1.elements)?page1.elements:[];
  const els2=Array.isArray(page2.elements)?page2.elements:[];

  const hasInvalidSigner1=els2.some(e=>e?.kind==='signer'&&e?.key==='signer1');
  const hasInvalidSigner2=els1.some(e=>e?.kind==='signer'&&e?.key==='signer2');
  if(hasInvalidSigner1||hasInvalidSigner2){
    const err=new Error('Penempatan tanda tangan tidak valid: signer1 hanya boleh di halaman 1 dan signer2 hanya boleh di halaman 2');
    err.statusCode=400;
    throw err;
  }

  const visualEls=[...els1,...els2].filter(e=>['cap_image','sign_image'].includes(e?.kind));
  const hasInvalidVisualSignerKey=visualEls.some(e=>!['signer1','signer2'].includes(e?.key));
  if(hasInvalidVisualSignerKey){
    const err=new Error('Elemen CAP atau gambar TTD harus memakai key signer1 atau signer2');
    err.statusCode=400;
    throw err;
  }

  return {
    page1:{ width:page1.width||1920, height:page1.height||1358, elements:els1.map(normalizeElement).filter(Boolean) },
    page2:{ width:page2.width||1920, height:page2.height||1358, elements:els2.map(normalizeElement).filter(Boolean) }
  };
};

const styleFor=(e)=>{
  const left=num(e.x||0);
  const top=num(e.y||0);
  const width=e.width!=null?`width:${num(e.width)}px;`:'';
  const height=e.height!=null?`height:${num(e.height)}px;`:'';
  const fsz=e.fontSize!=null?`font-size:${num(e.fontSize)}px;`:'';
  const ff=e.fontFamily?`font-family:${esc(e.fontFamily)};`:'';
  const fw=e.fontWeight?`font-weight:${esc(e.fontWeight)};`:'';
  const color=e.color?`color:${esc(e.color)};`:'';
  const align=e.align?`text-align:${esc(e.align)};`:'';
  const maxWidth=e.maxWidth!=null?`max-width:${num(e.maxWidth)}px;`:'';
  const lh=e.lineHeight!=null?`line-height:${num(e.lineHeight)};`:'';
  return `position:absolute;left:${left}px;top:${top}px;${width}${height}${fsz}${ff}${fw}${color}${align}${maxWidth}${lh}`;
};

const renderText=(e,payload)=>{
  const value=renderTextValue(e,payload);
  const textWidth=e.width!=null?`width:${num(e.width)}px;`:e.maxWidth!=null?`width:${num(e.maxWidth)}px;`:'';
  return `<div style="${styleFor(e)}${textWidth}white-space:pre-wrap;">${value}</div>`;
};

const renderSigner=(e,signers,payload={})=>{
  const s=signers[e.key];
  if(!s) return '';
  const isSigner1=e.key==='signer1';
  const dateText=isSigner1?String(payload.sample_date_text||'').trim():'';
  const nipRaw=isSigner1?payload.signer1_nip:payload.signer2_nip;
  const nipText=String(nipRaw||'').trim();
  const normalizedNip=nipText?(/^nip\.?/i.test(nipText)?nipText:`NIP. ${nipText}`):'';
  const signerFontSize=Math.max(10,num(e.fontSize,12));
  const signerFontFamily=e.fontFamily?esc(e.fontFamily):'Arial';
  const signatureAreaHeight=Math.max(90,num(e.height||160)-72);
  const capMarkup=s.capDataUrl?`<img src="${s.capDataUrl}" style="position:absolute;left:10px;top:50%;width:38%;max-height:100%;transform:translateY(-50%);object-fit:contain;opacity:.95;z-index:1;"/>`:'';
  const signMarkup=s.imageDataUrl?`<img src="${s.imageDataUrl}" style="position:absolute;left:24%;top:54%;width:86%;max-height:125%;transform:translateY(-50%);object-fit:contain;z-index:2;"/>`:'';
  const dateLine=dateText?`<div style="width:100%;font-size:${signerFontSize}px;font-family:${signerFontFamily};line-height:1.25;margin-bottom:4px;text-align:left;">${esc(dateText)}</div>`:'';
  const titleLine=s.title?`<div style="width:100%;font-size:${signerFontSize}px;font-family:${signerFontFamily};line-height:1.25;text-transform:none;margin-bottom:10px;text-align:left;">${esc(s.title)}</div>`:'';
  const nameLine=s.name?`<div style="width:100%;font-weight:700;font-size:${signerFontSize}px;font-family:${signerFontFamily};line-height:1.25;margin-top:10px;text-align:left;">${esc(s.name)}</div>`:'';
  const nipLine=normalizedNip?`<div style="width:100%;font-size:${Math.max(10,signerFontSize-1)}px;font-family:${signerFontFamily};line-height:1.25;margin-top:4px;text-align:left;">${esc(normalizedNip)}</div>`:'';
  return `<div style="${styleFor(e)}display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-start;text-align:left;font-family:${signerFontFamily};">
    ${dateLine}
    ${titleLine}
    <div style="position:relative;width:100%;height:${signatureAreaHeight}px;display:flex;align-items:center;justify-content:flex-start;overflow:visible;">
      ${capMarkup}
      ${signMarkup}
    </div>
    ${nameLine}
    ${nipLine}
  </div>`;
};

const renderTtdSpace=e=>`<div style="${styleFor(e)}"></div>`;

const renderTtdGroup=(e,payload={})=>{
  const isSigner1=e.key==='signer1';
  const dateText=isSigner1?String(payload.sample_date_text||'').trim():'';
  const titleText=String(isSigner1?payload.signer1_title:payload.signer2_title||'').trim();
  const nameText=String(isSigner1?payload.signer1_name:payload.signer2_name||'').trim();
  const nipRaw=isSigner1?payload.signer1_nip:payload.signer2_nip;
  const nipText=String(nipRaw||'').trim();
  const normalizedNip=nipText?(/^nip\.?/i.test(nipText)?nipText:`NIP. ${nipText}`):'';
  const fontSize=Math.max(10,num(e.fontSize,22));
  const fontFamily=e.fontFamily?esc(e.fontFamily):'Arial';
  const width=Math.max(120,num(e.width,isSigner1?360:320));
  const spaceHeight=Math.max(40,num(e.spaceHeight,isSigner1?120:110));
  const titleGap=num(e.titleGap,isSigner1?38:0);
  const spaceGap=num(e.spaceGap,isSigner1?84:46);
  const nameGap=num(e.nameGap,isSigner1?214:166);
  const nipGap=num(e.nipGap,isSigner1?248:200);
  const dateLine=dateText?`<div style="position:absolute;left:0;top:0;width:${width}px;font-size:${fontSize}px;font-family:${fontFamily};line-height:1.25;text-align:left;white-space:pre-wrap;">${esc(dateText)}</div>`:'';
  const titleLine=titleText?`<div style="position:absolute;left:0;top:${titleGap}px;width:${width}px;font-size:${fontSize}px;font-family:${fontFamily};line-height:1.25;text-align:left;white-space:nowrap;">${esc(titleText)}</div>`:'';
  const spaceLine=`<div style="position:absolute;left:0;top:${spaceGap}px;width:${width}px;height:${spaceHeight}px;"></div>`;
  const nameLine=nameText?`<div style="position:absolute;left:0;top:${nameGap}px;width:${width}px;font-size:${fontSize}px;font-family:${fontFamily};font-weight:700;line-height:1.25;text-align:left;white-space:nowrap;">${esc(nameText)}</div>`:'';
  const nipLine=normalizedNip?`<div style="position:absolute;left:0;top:${nipGap}px;width:${width}px;font-size:${Math.max(10,fontSize-2)}px;font-family:${fontFamily};line-height:1.25;text-align:left;white-space:pre-wrap;">${esc(normalizedNip)}</div>`:'';
  return `<div style="${styleFor(e)}">${dateLine}${titleLine}${spaceLine}${nameLine}${nipLine}</div>`;
};

const renderCapImage=(e,signers)=>{
  const src=signers?.[e.key]?.capDataUrl;
  if(!src) return '';
  return `<div style="${styleFor(e)}"><img src="${src}" style="width:100%;height:100%;display:block;object-fit:contain;"/></div>`;
};

const renderSignImage=(e,signers)=>{
  const src=signers?.[e.key]?.imageDataUrl;
  if(!src) return '';
  return `<div style="${styleFor(e)}"><img src="${src}" style="width:100%;height:100%;display:block;object-fit:contain;"/></div>`;
};

const renderParticipantPhoto=(e,participantPhotoDataUrl)=>{
  if(!participantPhotoDataUrl) return '';
  return `<div style="${styleFor(e)}overflow:hidden;"><img src="${participantPhotoDataUrl}" style="width:100%;height:100%;display:block;object-fit:cover;"/></div>`;
};

const renderQr=(e,qrDataUrl)=>{
  if(!qrDataUrl) return '';
  const side=Math.max(1,Math.min(num(e.width,200),num(e.height,200)));
  const left=num(e.x||0)+Math.max(0,(num(e.width,side)-side)/2);
  const top=num(e.y||0)+Math.max(0,(num(e.height,side)-side)/2);
  return `<div style="position:absolute;left:${left}px;top:${top}px;width:${side}px;height:${side}px;display:flex;align-items:center;justify-content:center;background:#fff;padding:10px;border-radius:8px;"><img src="${qrDataUrl}" style="width:${Math.max(1,side-20)}px;height:${Math.max(1,side-20)}px;display:block;image-rendering:crisp-edges;object-fit:contain;"/></div>`;
};

const renderPageHtml=({ page, bgDataUrl, payload, signers, qrDataUrl, participantPhotoDataUrl })=>{
  const elements=(page.elements||[]).map(e=>{
    if(e.kind==='text') return renderText(e,payload);
    if(e.kind==='signer') return renderSigner(e,signers,payload);
    if(e.kind==='ttd_group') return renderTtdGroup(e,payload);
    if(e.kind==='ttd_space') return renderTtdSpace(e);
    if(e.kind==='cap_image') return renderCapImage(e,signers);
    if(e.kind==='sign_image') return renderSignImage(e,signers);
    if(e.kind==='participant_photo') return renderParticipantPhoto(e,participantPhotoDataUrl);
    if(e.kind==='qr') return renderQr(e,qrDataUrl);
    return '';
  }).join('');

  const bg = bgDataUrl
    ? `background-image:url('${bgDataUrl}');background-size:cover;background-position:center;`
    : 'background:#fff;';

  return `<section class="certificate-page" style="width:${page.width}px;height:${page.height}px;${bg}">${elements}</section>`;
};

const buildHtml=({ layout, page1BgDataUrl, page2BgDataUrl, payload, signers, qrDataUrl, participantPhotoDataUrl })=>{
  const p1=renderPageHtml({page:layout.page1,bgDataUrl:page1BgDataUrl,payload,signers,qrDataUrl,participantPhotoDataUrl});
  const p2=renderPageHtml({page:layout.page2,bgDataUrl:page2BgDataUrl,payload,signers,qrDataUrl,participantPhotoDataUrl});

  return `<!doctype html><html><head><meta charset="utf-8"/>
  <style>
    @page{size:${PDF_PAGE_SIZE.width}px ${PDF_PAGE_SIZE.height}px;margin:0;}
    *{box-sizing:border-box;}
    body{margin:0;padding:0;font-family:Arial,sans-serif;background:#fff;}
    .certificate-page{position:relative;overflow:hidden;page-break-after:always;}
    .certificate-page:last-child{page-break-after:auto;}
  </style></head><body>${p1}${p2}</body></html>`;
};

const renderCertificatePdf = async ({ template, settings, payload, verificationUrl, outputFileName }) => {
  const layout = scaleLayoutForPdf(validateLayout(template.layout_json));

  const base=uploadsBase();
  const page1Abs=path.resolve(base,path.basename(template.page1_background_file||''));
  const page2Abs=path.resolve(base,path.basename(template.page2_background_file||''));

  if(!fs.existsSync(page1Abs)||!fs.existsSync(page2Abs)){
    const err=new Error('Background template sertifikat tidak ditemukan');
    err.statusCode=400;
    throw err;
  }

  const signer1Path=settings?.signer1_signature_file?path.resolve(base,path.basename(settings.signer1_signature_file)):null;
  const signer1CapPath=settings?.signer1_cap_file?path.resolve(base,path.basename(settings.signer1_cap_file)):null;
  const signer2Path=settings?.signer2_signature_file?path.resolve(base,path.basename(settings.signer2_signature_file)):null;
  const signer2CapPath=settings?.signer2_cap_file?path.resolve(base,path.basename(settings.signer2_cap_file)):null;

  const signer1CapDataUrl=readAsDataUrl(signer1CapPath);
  if(!signer1CapDataUrl){
    const err=new Error('Cap TTD 1 belum tersedia');
    err.statusCode=400;
    throw err;
  }

  const signers={
    signer1:{
      name: settings?.signer1_name || '',
      title: settings?.signer1_title || '',
      imageDataUrl: readAsDataUrl(signer1Path),
      capDataUrl: signer1CapDataUrl
    },
    signer2:{
      name: settings?.signer2_name || '',
      title: settings?.signer2_title || '',
      imageDataUrl: readAsDataUrl(signer2Path),
      capDataUrl: readAsDataUrl(signer2CapPath)
    }
  };

  const avatarPath=payload?.avatar_url?path.resolve(base,path.basename(payload.avatar_url)):null;
  const participantPhotoDataUrl=readAsDataUrl(avatarPath);
  const qrDataUrl=await QRCode.toDataURL(verificationUrl,{errorCorrectionLevel:'H',margin:2,width:800,color:{dark:'#000000',light:'#FFFFFF'}});
  const page1BgDataUrl=readAsDataUrl(page1Abs);
  const page2BgDataUrl=readAsDataUrl(page2Abs);

  const html=buildHtml({layout,page1BgDataUrl,page2BgDataUrl,payload,signers,qrDataUrl,participantPhotoDataUrl});

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox']
  });
  try{
    const page=await browser.newPage();
    await page.setContent(html,{waitUntil:'networkidle0'});

    const outName=outputFileName || `${Date.now()}-certificate.pdf`;
    const outAbs=path.resolve(base,outName);
    await page.pdf({
      path: outAbs,
      printBackground: true,
      width: `${PDF_PAGE_SIZE.width}px`,
      height: `${PDF_PAGE_SIZE.height}px`,
      margin: { top:'0', right:'0', bottom:'0', left:'0' }
    });

    return { fileName: outName, filePath: `/uploads/${outName}` };
  } finally{
    await browser.close();
  }
};

module.exports={ renderCertificatePdf, validateLayout };
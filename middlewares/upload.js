const multer=require('multer'),path=require('path'),fs=require('fs');
const DIR=path.resolve(process.env.UPLOAD_DIR||'uploads');
if(!fs.existsSync(DIR))fs.mkdirSync(DIR,{recursive:true});
const storage=multer.diskStorage({
  destination:(_r,_f,cb)=>cb(null,DIR),
  filename:(_r,f,cb)=>cb(null,Date.now()+'-'+Math.round(Math.random()*1e6)+path.extname(f.originalname))
});
const imageFilter=(_r,f,cb)=>/^image\/(png|jpg|jpeg|gif|webp)$/.test(f.mimetype)?cb(null,true):cb(new Error('Hanya file gambar (PNG, JPG, GIF, WebP)'));
const pdfFilter=(_r,f,cb)=>/^application\/pdf$/.test(f.mimetype)?cb(null,true):cb(new Error('Hanya file PDF'));
const allFileFilter=(_r,f,cb)=>{if(/^image\/(png|jpg|jpeg|gif|webp)$/.test(f.mimetype)||f.mimetype==='application/pdf')cb(null,true);else cb(new Error('Hanya file gambar atau PDF'));};
const maxUploadSizeMb=Math.max(Number(process.env.MAX_FILE_SIZE_MB)||2,1);
const maxUploadSize=maxUploadSizeMb*1024*1024;
module.exports={
  maxUploadSizeMb,
  uploadPdf:multer({storage,fileFilter:pdfFilter,limits:{fileSize:maxUploadSize}}),
  uploadImage:multer({storage,fileFilter:imageFilter,limits:{fileSize:maxUploadSize}}),
  uploadCertificateImage:multer({storage,fileFilter:imageFilter,limits:{fileSize:maxUploadSize}}),
  uploadAny:multer({storage,fileFilter:allFileFilter,limits:{fileSize:maxUploadSize}})
};

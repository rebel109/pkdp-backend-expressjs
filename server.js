require('dotenv').config();
if(!process.env.TZ||!String(process.env.TZ).trim()) process.env.TZ='Asia/Jakarta';
if(!process.env.DB_TIMEZONE||!String(process.env.DB_TIMEZONE).trim()) process.env.DB_TIMEZONE='+07:00';
const express=require('express'),cors=require('cors'),path=require('path'),fs=require('fs');
const { authenticate, ensureNotCertificateOnly } = require('./middlewares/auth');
const { uploadImage, uploadAny, maxUploadSizeMb } = require('./middlewares/upload');
const app=express();
const uploadDir=path.resolve(process.env.UPLOAD_DIR||'uploads');
app.use(cors({origin:process.env.CLIENT_URL||'http://localhost:5173',credentials:true}));
app.use((req,res,next)=>{
  req.setTimeout(30000);
  res.setTimeout(30000,()=>{
    if(!res.headersSent) res.status(503).json({message:'Server terlalu lama merespons. Silakan coba lagi.'});
  });
  next();
});
app.use(express.json());app.use(express.urlencoded({extended:true}));
app.use('/uploads',express.static(uploadDir));

// Force download (attachment) for uploaded files — used by export PDF links
app.get('/download/:file',(req,res)=>{
  const fileName=path.basename(req.params.file);
  const absolutePath=path.join(uploadDir,fileName);
  if(!absolutePath.startsWith(uploadDir)||!fs.existsSync(absolutePath)){
    return res.status(404).json({message:'File tidak ditemukan'});
  }
  res.download(absolutePath,fileName);
});

// Route upload untuk profile (gambar)
app.post('/api/upload', authenticate, ensureNotCertificateOnly, uploadImage.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Tidak ada file' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// Route upload untuk dokumen (PDF/gambar)
app.post('/api/upload-doc', authenticate, ensureNotCertificateOnly, (req, res) => {
  uploadAny.single('file')(req, res, (err) => {
    if (err) return res.status(err.code==='LIMIT_FILE_SIZE'?413:400).json({ message: err.code==='LIMIT_FILE_SIZE'?`Ukuran file maksimal ${maxUploadSizeMb} MB`:err.message });
    if (!req.file) return res.status(400).json({ message: 'Tidak ada file' });
    res.json({ url: `/uploads/${req.file.filename}` });
  });
});

app.use('/api/auth',        require('./routes/auth'));
app.use('/api/periods',     require('./routes/periods'));
app.use('/api/users',       require('./routes/users'));
app.use('/api/classes',     require('./routes/classes'));
app.use('/api/materials',   require('./routes/materials'));
app.use('/api/tasks',       require('./routes/tasks'));
app.use('/api/instruments', require('./routes/instruments'));
app.use('/api/submissions', require('./routes/submissions'));
app.use('/api/grades',      require('./routes/grades'));
app.use('/api/revisions',   require('./routes/revisions'));
app.use('/api/dashboard',   require('./routes/dashboard'));
app.use('/api/question-banks', require('./routes/question-banks'));
app.use('/api/instrument-banks', require('./routes/instrument-banks'));
app.use('/api/survey-banks', require('./routes/survey-banks'));
app.use('/api/survey-foundation', require('./routes/survey-foundation'));
app.use('/api/surveys', require('./routes/surveys'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/dosen-verifications', require('./routes/dosen-verifications'));
app.use('/api/narasumber', require('./routes/narasumber'));
app.use('/api/public-documents', require('./routes/public-documents'));
app.use('/api/schedules', require('./routes/schedules'));
app.use('/api/certificates', require('./routes/certificates'));
app.use('/api/attendance', require('./routes/attendance'));
app.get('/api/health',(_,res)=>res.json({status:'ok',time:new Date()}));
app.use((_,res)=>res.status(404).json({message:'Route tidak ditemukan'}));
app.use(require('./middlewares/errorHandler'));
const PORT=process.env.PORT||5000;
app.listen(PORT,()=>console.log(`🚀  PKDP API http://localhost:${PORT}`));
module.exports=app;

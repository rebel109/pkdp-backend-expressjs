const { maxUploadSizeMb } = require('./upload');

module.exports=(err,req,res,_n)=>{
  console.error(`[ERR] ${req.method} ${req.path}:`,err.message);
  if(err.code==='LIMIT_FILE_SIZE') return res.status(413).json({message:`Ukuran file maksimal ${maxUploadSizeMb} MB`});
  if(err.message?.includes('PDF')||err.message?.includes('gambar')) return res.status(400).json({message:err.message});
  res.status(err.statusCode||500).json({message:err.message||'Server error'});
};


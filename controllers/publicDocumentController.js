const db=require('../config/db');
const fs=require('fs');
const path=require('path');

const ALLOWED_TYPES=['GUIDE','REGULATION','NEWS'];
const LOGIN_LOGO_TITLE='LOGIN_LOGO_INSTANSI';
const LOGIN_LOGO_DESC='Asset logo instansi untuk halaman login';

const mapDoc=(row)=>({
  ...row,
  file_url: row.file_path ? `/uploads/${row.file_path}` : null
});

exports.listPublic=async(req,res,next)=>{
  try{
    const [rows]=await db.query(
      `SELECT id,title,description,doc_type,file_path,created_at
       FROM public_documents
       WHERE is_published=1 AND title<>?
       ORDER BY created_at DESC`,
      [LOGIN_LOGO_TITLE]
    );
    res.json(rows.map(mapDoc));
  }catch(e){next(e);}
};

exports.getLoginLogo=async(req,res,next)=>{
  try{
    const [[row]]=await db.query(
      `SELECT id,title,description,doc_type,file_path,created_at
       FROM public_documents
       WHERE title=? AND doc_type='NEWS' AND is_published=1
       ORDER BY updated_at DESC,id DESC
       LIMIT 1`,
      [LOGIN_LOGO_TITLE]
    );
    if(!row) return res.json({logo_url:null});
    const mapped=mapDoc(row);
    res.json({logo_url:mapped.file_url,updated_at:mapped.created_at});
  }catch(e){next(e);}
};

exports.setLoginLogo=async(req,res,next)=>{
  try{
    if(!req.file) return res.status(400).json({message:'File logo wajib diunggah'});

    const [[existing]]=await db.query(
      `SELECT id,file_path
       FROM public_documents
       WHERE title=? AND doc_type='NEWS'
       ORDER BY updated_at DESC,id DESC
       LIMIT 1`,
      [LOGIN_LOGO_TITLE]
    );

    if(existing?.file_path){
      const oldPath=path.resolve(process.env.UPLOAD_DIR||'uploads',path.basename(existing.file_path));
      if(fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    if(existing){
      await db.query(
        `UPDATE public_documents
         SET description=?,file_path=?,is_published=1,created_by=?
         WHERE id=?`,
        [LOGIN_LOGO_DESC,req.file.filename,req.user.id,existing.id]
      );
      return res.json({message:'Logo login berhasil diperbarui'});
    }

    await db.query(
      `INSERT INTO public_documents
       (title,description,doc_type,file_path,is_published,created_by)
       VALUES (?,?,?,?,?,?)`,
      [LOGIN_LOGO_TITLE,LOGIN_LOGO_DESC,'NEWS',req.file.filename,1,req.user.id]
    );
    res.status(201).json({message:'Logo login berhasil diunggah'});
  }catch(e){next(e);}
};

exports.downloadPublic=async(req,res,next)=>{
  try{
    const [[doc]]=await db.query(
      `SELECT id,title,file_path,is_published
       FROM public_documents
       WHERE id=?`,
      [req.params.id]
    );
    if(!doc||!doc.is_published) return res.status(404).json({message:'Dokumen tidak ditemukan'});
    if(!doc.file_path) return res.status(404).json({message:'File dokumen tidak tersedia'});

    const fileName=path.basename(doc.file_path);
    const absolutePath=path.resolve(process.env.UPLOAD_DIR||'uploads',fileName);
    if(!fs.existsSync(absolutePath)) return res.status(404).json({message:'File dokumen tidak ditemukan di server'});

    const downloadName=`${(doc.title||'dokumen').replace(/[^a-zA-Z0-9-_ ]/g,'').trim()||'dokumen'}.pdf`;
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="${downloadName}"`);
    return res.sendFile(absolutePath);
  }catch(e){next(e);}
};

exports.listAdmin=async(req,res,next)=>{
  try{
    const [rows]=await db.query(
      `SELECT pd.*,u.name AS created_by_name
       FROM public_documents pd
       LEFT JOIN users u ON u.id=pd.created_by
       ORDER BY pd.created_at DESC`
    );
    res.json(rows.map(mapDoc));
  }catch(e){next(e);}
};

exports.create=async(req,res,next)=>{
  try{
    const {title,description,doc_type,is_published}=req.body;
    if(!title||!String(title).trim()) return res.status(400).json({message:'Judul wajib diisi'});
    if(!doc_type||!ALLOWED_TYPES.includes(doc_type)) return res.status(400).json({message:'Tipe dokumen tidak valid'});
    if(!req.file) return res.status(400).json({message:'File PDF wajib diunggah'});

    const publishedFlag=String(is_published)==='0'?0:1;
    const [r]=await db.query(
      `INSERT INTO public_documents
       (title,description,doc_type,file_path,is_published,created_by)
       VALUES (?,?,?,?,?,?)`,
      [String(title).trim(),description||null,doc_type,req.file.filename,publishedFlag,req.user.id]
    );
    res.status(201).json({message:'Dokumen publik berhasil ditambahkan',id:r.insertId});
  }catch(e){next(e);}
};

exports.update=async(req,res,next)=>{
  try{
    const [[existing]]=await db.query('SELECT * FROM public_documents WHERE id=?',[req.params.id]);
    if(!existing) return res.status(404).json({message:'Dokumen tidak ditemukan'});

    const nextTitle=(req.body.title??existing.title);
    const nextType=(req.body.doc_type??existing.doc_type);
    if(!nextTitle||!String(nextTitle).trim()) return res.status(400).json({message:'Judul wajib diisi'});
    if(!ALLOWED_TYPES.includes(nextType)) return res.status(400).json({message:'Tipe dokumen tidak valid'});

    const nextPublished=(req.body.is_published===undefined)
      ? existing.is_published
      : (String(req.body.is_published)==='0'?0:1);

    let nextFilePath=existing.file_path;
    if(req.file){
      nextFilePath=req.file.filename;
      if(existing.file_path){
        const oldPath=path.resolve(process.env.UPLOAD_DIR||'uploads',path.basename(existing.file_path));
        if(fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
    }

    await db.query(
      `UPDATE public_documents
       SET title=?,description=?,doc_type=?,file_path=?,is_published=?
       WHERE id=?`,
      [String(nextTitle).trim(),req.body.description??existing.description,nextType,nextFilePath,nextPublished,req.params.id]
    );

    res.json({message:'Dokumen publik berhasil diperbarui'});
  }catch(e){next(e);}
};

exports.togglePublish=async(req,res,next)=>{
  try{
    const [[doc]]=await db.query('SELECT id,is_published FROM public_documents WHERE id=?',[req.params.id]);
    if(!doc) return res.status(404).json({message:'Dokumen tidak ditemukan'});
    const next=doc.is_published?0:1;
    await db.query('UPDATE public_documents SET is_published=? WHERE id=?',[next,req.params.id]);
    res.json({message:next?'Dokumen dipublikasikan':'Dokumen disembunyikan',is_published:next});
  }catch(e){next(e);}
};

exports.remove=async(req,res,next)=>{
  try{
    const [[doc]]=await db.query('SELECT file_path FROM public_documents WHERE id=?',[req.params.id]);
    if(!doc) return res.status(404).json({message:'Dokumen tidak ditemukan'});
    if(doc.file_path){
      const fp=path.resolve(process.env.UPLOAD_DIR||'uploads',path.basename(doc.file_path));
      if(fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    await db.query('DELETE FROM public_documents WHERE id=?',[req.params.id]);
    res.json({message:'Dokumen publik dihapus'});
  }catch(e){next(e);}
};

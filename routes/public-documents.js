const r=require('express').Router();
const c=require('../controllers/publicDocumentController');
const { authenticate, authorize } = require('../middlewares/auth');
const { uploadPdf, uploadImage } = require('../middlewares/upload');

// Public endpoints for login page
r.get('/public',c.listPublic);
r.get('/public/:id/download',c.downloadPublic);
r.get('/logo',c.getLoginLogo);

// Admin endpoints
r.get('/',authenticate,authorize('ADMIN'),c.listAdmin);
r.post('/logo',authenticate,authorize('ADMIN'),uploadImage.single('file'),c.setLoginLogo);
r.post('/',authenticate,authorize('ADMIN'),uploadPdf.single('file'),c.create);
r.put('/:id',authenticate,authorize('ADMIN'),uploadPdf.single('file'),c.update);
r.patch('/:id/publish',authenticate,authorize('ADMIN'),c.togglePublish);
r.delete('/:id',authenticate,authorize('ADMIN'),c.remove);

module.exports=r;

const r=require('express').Router(),c=require('../controllers/userController'),{authenticate,authorize,ensureNotCertificateOnly,ensurePaymentVerified}=require('../middlewares/auth');
r.use(authenticate);
r.get('/profile',ensureNotCertificateOnly,c.getProfile);r.get('/history/me',ensureNotCertificateOnly,c.getHistory);r.put('/profile',ensureNotCertificateOnly,ensurePaymentVerified,c.updateProfile);r.post('/verify-password',ensureNotCertificateOnly,c.verifyPassword);r.post('/select-class',ensureNotCertificateOnly,ensurePaymentVerified,c.selectClass);
r.get('/',ensureNotCertificateOnly,authorize('ADMIN'),c.getAll);r.get('/:id',ensureNotCertificateOnly,c.getOne);r.put('/:id',ensureNotCertificateOnly,c.update);
r.delete('/:id',ensureNotCertificateOnly,authorize('ADMIN'),c.remove);r.patch('/:id/block',ensureNotCertificateOnly,authorize('ADMIN'),c.toggleBlock);
module.exports=r;

const r=require('express').Router();
const c=require('../controllers/attendanceController');
const {authenticate,authorize,ensurePaymentVerified}=require('../middlewares/auth');

r.use(authenticate);

r.get('/me',ensurePaymentVerified,c.getMyAttendance);
r.post('/tasks/:taskId/mark',ensurePaymentVerified,c.markAttendance);
r.get('/admin/recap',authorize('ADMIN'),c.getAdminRecap);
r.get('/admin/recap-pdf',authorize('ADMIN'),c.exportAdminRecapPdf);
r.patch('/admin/tasks/:taskId/override',authorize('ADMIN'),c.setTaskOverride);

module.exports=r;

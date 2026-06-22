const r=require('express').Router();
const c=require('../controllers/attendanceController');
const sessions=require('../controllers/attendanceSessionController');
const {authenticate,authorize,ensurePaymentVerified}=require('../middlewares/auth');

r.use(authenticate);

r.get('/me',ensurePaymentVerified,c.getMyAttendance);
r.post('/tasks/:taskId/mark',ensurePaymentVerified,c.markAttendance);
r.get('/sessions/me',ensurePaymentVerified,sessions.getMySessions);
r.post('/sessions/:sessionId/mark',ensurePaymentVerified,sessions.markSessionAttendance);
r.get('/admin/recap',authorize('ADMIN'),c.getAdminRecap);
r.get('/admin/recap-pdf',authorize('ADMIN'),c.exportAdminRecapPdf);
r.patch('/admin/tasks/:taskId/override',authorize('ADMIN'),c.setTaskOverride);
r.get('/admin/sessions',authorize('ADMIN'),sessions.getAdminSessions);
r.post('/admin/sessions',authorize('ADMIN'),sessions.createSession);
r.put('/admin/sessions/:sessionId',authorize('ADMIN'),sessions.updateSession);
r.delete('/admin/sessions/:sessionId',authorize('ADMIN'),sessions.removeSession);
r.patch('/admin/sessions/:sessionId/override',authorize('ADMIN'),sessions.setSessionOverride);
r.get('/admin/session-recap',authorize('ADMIN'),sessions.getAdminSessionRecap);

module.exports=r;

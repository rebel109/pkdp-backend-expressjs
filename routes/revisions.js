const r = require('express').Router();
const c = require('../controllers/revisionController');
const { authenticate } = require('../middlewares/auth');

r.use(authenticate);
// Semua role yang terlibat bisa akses
r.get('/',    c.getAll);
r.post('/',   c.create);   // DOSEN & NARASUMBER & ADMIN
r.delete('/:id', c.remove);

module.exports = r;

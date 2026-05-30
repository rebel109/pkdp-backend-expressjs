const r=require('express').Router(),{body}=require('express-validator'),c=require('../controllers/authController'),{authenticate}=require('../middlewares/auth');
const { uploadAny } = require('../middlewares/upload');
r.post('/register',uploadAny.single('consent_file_upload'),[body('name').notEmpty(),body('email').isEmail(),body('password').isLength({min:6})],c.register);
r.post('/login',[body('email').isEmail(),body('password').notEmpty()],c.login);
r.post('/forgot-password',[body('email').isEmail()],c.forgotPassword);
r.post('/reset-password',[body('token').notEmpty(),body('password').isLength({min:6})],c.resetPassword);
r.get('/me',authenticate,c.me);
module.exports=r;

const { Router } = require('express');
const controller = require('../controllers/user.controller');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { registerSchema, loginSchema, updateProfileSchema } = require('../validators/user.validators');

const router = Router();

router.post('/register', validate(registerSchema), controller.register);
router.post('/login', validate(loginSchema), controller.login);

// Everything below requires a valid JWT.
router.use(authenticate);
router.get('/me', controller.getProfile);
router.patch('/me', validate(updateProfileSchema), controller.updateProfile);

module.exports = router;

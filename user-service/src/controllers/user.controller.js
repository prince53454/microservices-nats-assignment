const { asyncHandler } = require('../../../shared/utils/asyncHandler');
const { sendSuccess } = require('../../../shared/utils/responses');
const userService = require('../services/user.service');

/** POST /users/register */
const register = asyncHandler(async (req, res) => {
  const { user, token } = await userService.register(req.body, req.app.locals.publisher);
  return sendSuccess(res, { user, token }, 201);
});

/** POST /users/login */
const login = asyncHandler(async (req, res) => {
  const { user, token } = await userService.login(req.body);
  return sendSuccess(res, { user, token });
});

/** GET /users/me */
const getProfile = asyncHandler(async (req, res) => {
  const user = await userService.getProfile(req.user.sub);
  return sendSuccess(res, { user });
});

/** PATCH /users/me */
const updateProfile = asyncHandler(async (req, res) => {
  const user = await userService.updateProfile(req.user.sub, req.body, req.app.locals.publisher);
  return sendSuccess(res, { user });
});

module.exports = { register, login, getProfile, updateProfile };

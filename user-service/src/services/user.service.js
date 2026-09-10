const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ApiError } = require('../../../shared/utils/ApiError');
const env = require('../config/env');
const logger = require('../config/logger');
const repo = require('./user.repository');

const BCRYPT_ROUNDS = 10;

/** Issue a short-lived signed JWT for a user id. */
function signAccessToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, env.jwtSecret, {
    expiresIn: '1h',
  });
}

/** Register a new user, publish `user.created`, and return user + token. */
async function register({ name, email, password }, publisher) {
  const existing = await repo.findByEmail(email);
  if (existing) {
    throw ApiError.conflict('Email is already registered');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await repo.create({ name, email, passwordHash });

  // Fire-and-notify: registration succeeded; event failure is logged but
  // does not fail the API call (an outbox table would be the production fix).
  try {
    await publisher.publishUserCreated(user);
  } catch (err) {
    logger.error({ err, userId: user.id }, 'Failed to publish user.created event');
  }

  return { user: user.toJSON(), token: signAccessToken(user) };
}

/** Verify credentials and return the user with a fresh JWT. */
async function login({ email, password }) {
  const user = await repo.findByEmail(email);
  if (!user || !user.isActive) {
    // Same message for unknown email and wrong password: no account probing.
    throw ApiError.unauthorized('Invalid email or password');
  }

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) throw ApiError.unauthorized('Invalid email or password');

  return { user: user.toJSON(), token: signAccessToken(user) };
}

/** Fetch the profile of the authenticated user. */
async function getProfile(userId) {
  const user = await repo.findById(userId);
  if (!user || !user.isActive) throw ApiError.notFound('User not found');
  return user.toJSON();
}

/** Update the authenticated user's profile and publish `user.updated`. */
async function updateProfile(userId, patch, publisher) {
  const allowed = {};
  if (patch.name !== undefined) allowed.name = patch.name;
  if (patch.email !== undefined) allowed.email = patch.email;
  if (Object.keys(allowed).length === 0) {
    throw ApiError.badRequest('No updatable fields provided');
  }

  if (allowed.email) {
    const clash = await repo.findByEmail(allowed.email);
    if (clash && clash.id !== userId) {
      throw ApiError.conflict('Email is already registered');
    }
  }

  const user = await repo.updateById(userId, allowed);
  if (!user) throw ApiError.notFound('User not found');

  try {
    await publisher.publishUserUpdated(user, allowed);
  } catch (err) {
    logger.error({ err, userId }, 'Failed to publish user.updated event');
  }

  return user.toJSON();
}

module.exports = { register, login, getProfile, updateProfile, signAccessToken };

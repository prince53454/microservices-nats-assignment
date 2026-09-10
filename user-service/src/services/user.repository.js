const User = require('../models/user.model');

/**
 * Repository layer: all MongoDB access lives here, keeping controllers and
 * services free of persistence details (easy to swap or mock in tests).
 */
async function findByEmail(email) {
  return User.findOne({ email: email.toLowerCase() });
}

async function findById(id) {
  return User.findById(id);
}

async function create({ name, email, passwordHash }) {
  return User.create({ name, email, password: passwordHash });
}

async function updateById(id, patch) {
  return User.findByIdAndUpdate(
    id,
    { $set: patch },
    { new: true, runValidators: true }
  );
}

module.exports = {
  findByEmail,
  findById,
  create,
  updateById,
};

const mongoose = require('mongoose');

/**
 * User model. Note the toJSON transform: the password hash (and version key)
 * are stripped from every serialized response, so a hash can never leak.
 */
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true }, // bcrypt hash, never returned
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true } // adds createdAt / updatedAt
);

userSchema.methods.toJSON = function toJSON() {
  const { _id, name, email, isActive, createdAt, updatedAt } = this.toObject();
  return { id: _id.toString(), name, email, isActive, createdAt, updatedAt };
};

module.exports = mongoose.models.User || mongoose.model('User', userSchema);

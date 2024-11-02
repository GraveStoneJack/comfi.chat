const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String },
    displayName: String,
    age: { type: Number, min: 13, max: 100 },
    profilePicture: String,
    weight: { kg: Number, lbs: Number },
    height: { cm: Number, ft: Number, in: Number },
    hairType: String,
    hairColor: String,
    eyeColor: String,
    ethnicity: String,
    hobbies: [String],
    sexuality: String,
    gender: String,
    lookingFor: [String],
    googleId: String,
    appleId: String
});

module.exports = mongoose.```


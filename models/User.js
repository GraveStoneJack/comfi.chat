const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { 
        type: String, 
        required: true, 
        unique: true,
        trim: true,
        minlength: 3,
        maxlength: 30
    },
    email: { 
        type: String, 
        required: true, 
        unique: true,
        lowercase: true,
        trim: true
    },
    password: { 
        type: String,
        select: false // Hide password field by default in queries
    },
    displayName: {
        type: String,
        trim: true,
        maxlength: 50
    },
    age: { 
        type: Number, 
        min: 13, 
        max: 100,
        required: true
    },
    profilePicture: {
        type: String,
        default: 'default-profile.png' // Default profile picture
    },
    weight: {
        kg: { type: Number, min: 30, max: 300 },
        lbs: { type: Number, min: 66, max: 660 }
    },
    height: {
        cm: { type: Number, min: 100, max: 250 },
        ft: { type: Number, min: 3, max: 8 },
        in: { type: Number, min: 0, max: 11 }
    },
    hairType: {
        type: String,
        enum: ['straight', 'wavy', 'curly', 'coily', 'other']
    },
    hairColor: {
        type: String,
        enum: ['black', 'brown', 'blonde', 'red', 'grey', 'white', 'other']
    },
    eyeColor: {
        type: String,
        enum: ['brown', 'blue', 'green', 'hazel', 'grey', 'other']
    },
    ethnicity: {
        type: String,
        enum: [
            'african-black',
            'arab',
            'central-asian',
            'east-asian',
            'south-asian',
            'middle-eastern-west-asian',
            'latino-hispanic',
            'native-american',
            'pacific-islander',
            'white-european',
            'mixed-multiracial',
            'other',
            'prefer-not-to-say'
        ]
    },
    hobbies: [{
        type: String,
        trim: true,
        maxlength: 30
    }],
    sexuality: {
        type: String,
        enum: ['straight', 'gay', 'lesbian', 'bisexual', 'pansexual', 'questioning', 'asexual', 'other', 'prefer-not-to-say']
    },
    gender: {
        type: String,
        enum: ['male', 'female', 'non-binary', 'genderfluid', 'agender', 'demiboy', 'demigirl', 'other', 'prefer-not-to-say'],
        required: true
    },
    transgender: {
        type: String,
        enum: ['yes', 'no', 'prefer-not-to-say']
    },
    lookingFor: [{
        type: String,
        enum: ['friendship', 'dating', 'relationship', 'casual', 'networking']
    }],
    googleId: String,
    appleId: String,
    isOnline: {
        type: Boolean,
        default: false
    },
    lastActive: {
        type: Date,
        default: Date.now
    },
    accountCreated: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true // Adds createdAt and updatedAt fields
});

// Add indexes for better query performance
userSchema.index({ username: 1, email: 1 });
userSchema.index({ isOnline: 1 });
userSchema.index({ age: 1, gender: 1 });

module.exports = mongoose.model('User', userSchema);

#!/usr/bin/env node
// Usage: node scripts/user-status.js <email>

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');

const [,, email] = process.argv;
if (!email) {
  console.error('Usage: node scripts/user-status.js <email>');
  process.exit(1);
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  const user = await User.findOne({ email: new RegExp(`^${email}$`, 'i') }).lean();
  if (!user) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }

  const TRIAL_MS = 3 * 24 * 60 * 60 * 1000;
  const trialActive = user.trialStartedAt
    ? Date.now() - new Date(user.trialStartedAt).getTime() < TRIAL_MS
    : false;
  const trialExpiresAt = user.trialStartedAt
    ? new Date(new Date(user.trialStartedAt).getTime() + TRIAL_MS).toLocaleString()
    : 'N/A';

  console.log(`\nUser: ${user.displayName} (${user.email})`);
  console.log(`Plan:    ${user.plan || 'trial'}`);
  console.log(`Trial:   ${trialActive ? 'active' : 'expired'} — expires ${trialExpiresAt}`);
  console.log(`Credits: ${user.credits || 0} remaining, ${user.creditsUsed || 0} used`);
  console.log(`Joined:  ${new Date(user.createdAt).toLocaleString()}\n`);

  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

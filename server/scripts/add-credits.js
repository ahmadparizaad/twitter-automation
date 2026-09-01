#!/usr/bin/env node
// Usage: node scripts/add-credits.js <email> <amount>
// Example: node scripts/add-credits.js user@gmail.com 100

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');

const [,, email, amountArg] = process.argv;
const amount = parseInt(amountArg, 10);

if (!email || !amount || amount <= 0) {
  console.error('Usage: node scripts/add-credits.js <email> <amount>');
  process.exit(1);
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  let user = await User.findOne({ email: new RegExp(`^${email}$`, 'i') });
  if (!user) {
    console.log(`User not found. Creating a new user record for ${email.toLowerCase()}...`);
    user = new User({
      googleId: `pending_${Date.now()}_${email.toLowerCase()}`,
      displayName: email.split('@')[0],
      email: email.toLowerCase(),
      credits: amount,
      plan: 'credits',
      trialStartedAt: new Date()
    });
    await user.save();
    console.log(`✓ Created user: ${user.displayName} (${user.email})`);
    console.log(`  Credits: 0 → ${user.credits}`);
    console.log(`  Plan: ${user.plan}`);
  } else {
    const before = user.credits || 0;
    user.credits = before + amount;
    user.plan = 'credits';
    await user.save();

    console.log(`✓ ${user.displayName || user.email} (${user.email})`);
    console.log(`  Credits: ${before} → ${user.credits}`);
    console.log(`  Plan: ${user.plan}`);
  }

  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

const express = require('express');
const router = express.Router();
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL;
const isGoogleOAuthConfigured = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_CALLBACK_URL);
const User = require('../models/User');

// Note: Passport session serialization removed - using JWT-only auth
// passport.serializeUser and passport.deserializeUser not needed

// Validate callback URL shape
if (GOOGLE_CALLBACK_URL && !GOOGLE_CALLBACK_URL.startsWith('http')) {
  console.warn('GOOGLE_CALLBACK_URL does not appear to be a valid absolute URL. It should start with http:// or https://');
}
// Conditionally configure Google OAuth strategy if credentials are present
if (isGoogleOAuthConfigured) {
  passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: GOOGLE_CALLBACK_URL
  }, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails && profile.emails[0] && profile.emails[0].value ? profile.emails[0].value.toLowerCase() : null;
    const queryConditions = [{ googleId: profile.id }];
    if (email) {
      queryConditions.push({ email: new RegExp(`^${email}$`, 'i') });
    }

    let user = await User.findOne({ $or: queryConditions });
    if (!user) {
      user = new User({
        googleId: profile.id,
        displayName: profile.displayName,
        email: email,
        trialStartedAt: new Date(),
        plan: 'trial',
      });
      await user.save();
    } else {
      let needsSave = false;
      if (user.googleId !== profile.id) {
        user.googleId = profile.id;
        needsSave = true;
      }
      if (profile.displayName && (!user.displayName || user.displayName === user.email?.split('@')[0])) {
        user.displayName = profile.displayName;
        needsSave = true;
      }
      if (email && !user.email) {
        user.email = email;
        needsSave = true;
      }
      if (needsSave) {
        await user.save();
      }
    }
    return done(null, user);
  } catch (err) {
    return done(err);
  }
  }));
} else {
  const missing = [];
  if (!GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
  if (!GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
  if (!GOOGLE_CALLBACK_URL) missing.push('GOOGLE_CALLBACK_URL');
  console.warn(`Google OAuth not configured: missing env vars ${missing.join(', ')} — /auth/google endpoints will be disabled.`);
}

if (isGoogleOAuthConfigured) {
  router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'], session: false }));
} else {
  router.get('/google', (req, res) => res.status(501).json({ error: 'Google OAuth not configured on server', missing: ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_CALLBACK_URL'].filter(k => !process.env[k]) }));
}

const jwt = require('jsonwebtoken');

if (isGoogleOAuthConfigured) {
  router.get('/google/callback', passport.authenticate('google', { failureRedirect: '/auth/failure', session: false }), async (req, res) => {
    try {
      const SECRET = process.env.SESSION_SECRET;
      // Create separate access and refresh tokens
      const accessToken = jwt.sign(
        { id: req.user._id, type: 'access', displayName: req.user.displayName, email: req.user.email },
        SECRET,
        { expiresIn: '15m' }
      );
      const refreshToken = jwt.sign(
        { id: req.user._id, type: 'refresh' },
        SECRET,
        { expiresIn: '7d' }
      );

      // Save refresh token to user record
      req.user.refreshToken = refreshToken;
      req.user.refreshTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await req.user.save();

      res.send(`<html><body>
        <h2>Signed in</h2>
        <p>You have signed in successfully. You can close this window and return to the extension.</p>
        <script>
          try {
            if (window.opener && window.opener !== window) {
              window.opener.postMessage({ 
                type: 'WITTY_WING_AUTH', 
                accessToken: '${accessToken}',
                refreshToken: '${refreshToken}'
              }, '*');
            }
          } catch(e) { console.error('PostMessage failed:', e); }
          setTimeout(() => { window.close(); }, 500);
        </script>
        </body></html>`);
    } catch (err) {
      console.error('Auth callback error:', err);
      res.redirect('/auth/failure');
    }
  });
} else {
  router.get('/google/callback', (req, res) => res.status(501).json({ error: 'Google OAuth not configured on server', missing: ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_CALLBACK_URL'].filter(k => !process.env[k]) }));
}

router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

  try {
    const SECRET = process.env.SESSION_SECRET;
    const payload = jwt.verify(refreshToken, SECRET);
    if (payload.type !== 'refresh') throw new Error('Invalid token type');

    const user = await User.findById(payload.id);
    if (!user || user.refreshToken !== refreshToken || (user.refreshTokenExpiresAt && user.refreshTokenExpiresAt < new Date())) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const newAccessToken = jwt.sign(
      { id: user._id, type: 'access', displayName: user.displayName, email: user.email },
      SECRET,
      { expiresIn: '15m' }
    );

    const newRefreshToken = jwt.sign(
      { id: user._id, type: 'refresh' },
      SECRET,
      { expiresIn: '7d' }
    );

    user.refreshToken = newRefreshToken;
    user.refreshTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await user.save();

    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// Diagnostic route to check auth config
router.get('/config', (req, res) => {
  return res.json({ googleOAuthConfigured: isGoogleOAuthConfigured, missing: { GOOGLE_CLIENT_ID: !!GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: !!GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL: !!GOOGLE_CALLBACK_URL }, callbackURL: GOOGLE_CALLBACK_URL || null });
});

router.get('/failure', (req, res) => {
  res.status(401).json({ message: 'Authentication failed' });
});

router.get('/session', (req, res) => {
  // Try Bearer token in header (JWT-based auth)
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length);
    try {
      const payload = jwt.verify(token, process.env.SESSION_SECRET);
      if (payload.type !== 'access') throw new Error('Invalid token type');
      return res.json({ authenticated: true, user: { _id: payload.id, displayName: payload.displayName, email: payload.email } });
    } catch (err) {
      return res.json({ authenticated: false });
    }
  }
  return res.json({ authenticated: false });
});

router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    try {
      const SECRET = process.env.SESSION_SECRET;
      const payload = jwt.verify(refreshToken, SECRET);
      const user = await User.findById(payload.id);
      if (user && user.refreshToken === refreshToken) {
        user.refreshToken = null;
        user.refreshTokenExpiresAt = null;
        await user.save();
      }
    } catch (_) {
      // invalid token — still complete logout
    }
  }
  res.json({ ok: true, message: 'Logged out successfully' });
});

module.exports = router;

const functions = require('firebase-functions');
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();

const XAMCHAT_CLIENT_ID = 'xam_pOwUsNRoU0kcpYf3i31FXQ';  // ← новый

exports.xamChatAuth = functions
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

    try {
      const { code, redirect_uri, code_verifier } = req.body || {};
      if (!code || !redirect_uri || !code_verifier) {
        return res.status(400).json({ error: 'code, redirect_uri и code_verifier обязательны' });
      }

      // 1. Обмен кода на токен
      const tokenResp = await fetch('https://xamchat.ru/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          redirect_uri,
          client_id: XAMCHAT_CLIENT_ID,
          code_verifier
        })
      });
      const tokenData = await tokenResp.json();
      if (!tokenResp.ok || !tokenData.access_token) {
        console.error('Token exchange failed:', tokenData);
        return res.status(400).json({ error: 'token_exchange_failed', details: tokenData });
      }

      // 2. Получение профиля
      const uiResp = await fetch('https://xamchat.ru/oauth/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const profile = await uiResp.json();
      if (!uiResp.ok || !profile.id) {
        console.error('Userinfo failed:', profile);
        return res.status(400).json({ error: 'userinfo_failed', details: profile });
      }

      // 3. Устойчивый парсинг полей
      const userId = profile.id || profile.user_id;
      const username = profile.username || profile.login || `xamchat_${userId}`;
      const firstName = profile.first_name || profile.firstName || profile.given_name || profile.name || 'Пользователь';
      const lastName = profile.last_name || profile.lastName || profile.family_name || '';
      const displayName = profile.display_name || profile.name || `${firstName} ${lastName}`.trim() || 'Пользователь Xam Chat';
      const avatar = profile.avatar_url || profile.avatar || profile.picture || '😊';

      const uid = `xamchat_${userId}`;
      const userRef = admin.firestore().collection('users').doc(uid);
      const snap = await userRef.get();

      if (!snap.exists) {
        const uniqueUsername = `@${username.replace(/[^a-zA-Z0-9_]/g, '')}`;
        await userRef.set({
          uid,
          username: uniqueUsername,
          firstName,
          lastName,
          name: displayName,
          avatar,
          xamChatId: userId,
          contacts: [],
          privacyWrite: 'all'
        });
      }

      const firebaseToken = await admin.auth().createCustomToken(uid);
      return res.json({ firebaseToken });

    } catch (error) {
      console.error('Ошибка:', error);
      return res.status(500).json({ error: 'internal_error', message: error.message });
    }
  });

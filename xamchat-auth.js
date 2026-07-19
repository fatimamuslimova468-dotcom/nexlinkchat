// functions/xamchat-auth.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();

const XAMCHAT_CLIENT_ID = 'xam_xTiS5LUIuWTrEPx2qcqHA';

exports.xamChatAuth = functions.https.onRequest(async (req, res) => {
  // Устанавливаем CORS-заголовки для всех ответов
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  // Обрабатываем предварительный OPTIONS-запрос
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  // Разрешаем только POST
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { code, redirect_uri, code_verifier } = req.body;
    if (!code || !redirect_uri || !code_verifier) {
      res.status(400).json({ error: 'code, redirect_uri и code_verifier обязательны' });
      return;
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
      res.status(400).json({ error: 'token_exchange_failed', details: tokenData });
      return;
    }

    // 2. Получение профиля пользователя
    const uiResp = await fetch('https://xamchat.ru/oauth/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const profile = await uiResp.json();
    if (!uiResp.ok || !profile.id) {
      console.error('Userinfo failed:', profile);
      res.status(400).json({ error: 'userinfo_failed', details: profile });
      return;
    }

    // 3. Создание/обновление пользователя в Firestore
    const uid = `xamchat_${profile.id}`;
    const userRef = admin.firestore().collection('users').doc(uid);
    const snap = await userRef.get();

    if (!snap.exists) {
      const username = `@${(profile.username || 'xamchat_' + profile.id).replace(/[^a-zA-Z0-9_]/g, '')}`;
      await userRef.set({
        uid,
        username,
        firstName: profile.first_name || profile.name || 'Пользователь',
        lastName: profile.last_name || '',
        name: profile.name || profile.username || 'Пользователь Xam Chat',
        avatar: profile.avatar_url || '😊',
        xamChatId: profile.id,
        contacts: [],
        privacyWrite: 'all'
      });
    }

    // 4. Генерация Firebase Custom Token
    const firebaseToken = await admin.auth().createCustomToken(uid);
    res.json({ firebaseToken });

  } catch (error) {
    console.error('Ошибка в xamChatAuth:', error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

// functions/xamchat-auth.js
// Firebase Cloud Function (Node.js 18+)
//
// Установка:
//   cd functions
//   npm install firebase-admin firebase-functions
//   firebase deploy --only functions:xamChatAuth
//
// После деплоя скопируйте URL функции в XAMCHAT_TOKEN_EXCHANGE_URL внутри script.js.

const functions = require('firebase-functions');
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();

// ✅ ЗАМЕНИТЕ НА ВАШ client_id (новый, для SPA)
const XAMCHAT_CLIENT_ID = 'xam_xTiS5LUIuWTrEPx2qcqHA';

// client_secret НЕ ИСПОЛЬЗУЕТСЯ — для SPA с PKCE он не нужен.
// Если вы всё же хотите его передавать, добавьте переменную окружения,
// но это избыточно.

exports.xamChatAuth = functions
  .https.onRequest(async (req, res) => {
    // Настройка CORS — разрешаем запросы с любого источника (для теста)
    // В продакшене замените '*' на ваш домен: 'https://nexchat.zapto.org'
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
      return res.status(204).send('');
    }
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'method not allowed' });
    }

    try {
      // Получаем данные из тела запроса
      const { code, redirect_uri, code_verifier } = req.body || {};
      if (!code || !redirect_uri || !code_verifier) {
        return res.status(400).json({
          error: 'code, redirect_uri и code_verifier обязательны'
        });
      }

      // 1. Обмен authorization code на access_token с использованием PKCE
      const tokenResp = await fetch('https://xamchat.ru/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          redirect_uri,
          client_id: XAMCHAT_CLIENT_ID,
          // client_secret НЕ ПЕРЕДАЁМ — для PKCE он не требуется
          code_verifier: code_verifier   // <-- обязательно
        })
      });

      const tokenData = await tokenResp.json();
      if (!tokenResp.ok || !tokenData.access_token) {
        console.error('Token exchange failed:', tokenData);
        return res.status(400).json({
          error: 'token_exchange_failed',
          details: tokenData
        });
      }

      // 2. Получение профиля пользователя Xam Chat
      const uiResp = await fetch('https://xamchat.ru/oauth/userinfo', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`
        }
      });
      const profile = await uiResp.json();
      if (!uiResp.ok || !profile.id) {
        console.error('Userinfo failed:', profile);
        return res.status(400).json({
          error: 'userinfo_failed',
          details: profile
        });
      }

      // 3. Создание/обновление пользователя в Firestore
      const uid = `xamchat_${profile.id}`;
      const userRef = admin.firestore().collection('users').doc(uid);
      const snap = await userRef.get();

      if (!snap.exists) {
        // Генерируем уникальный username (можно улучшить логику)
        const username = `@${(profile.username || 'xamchat_' + profile.id)
          .replace(/[^a-zA-Z0-9_]/g, '')}`;
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

      // Возвращаем токен клиенту
      return res.json({ firebaseToken });

    } catch (error) {
      console.error('Ошибка в xamChatAuth:', error);
      return res.status(500).json({
        error: 'internal_error',
        message: error.message
      });
    }
  });

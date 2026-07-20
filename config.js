// ════════════════════════════════════════════════════
//  Firebase (compat CDN) подключается ниже через ES modules
// ════════════════════════════════════════════════════
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, getDoc, getDocs, addDoc,
  query, where, onSnapshot, updateDoc, deleteDoc, serverTimestamp,
  arrayUnion, arrayRemove, orderBy, limit, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendEmailVerification,
  GoogleAuthProvider, signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ── Firebase config (то же, что и у Desktop-версии) ──
const FB = {
  apiKey: "AIzaSyCjadRD1TAix0IsjaxYI-76P9mDpKmQ34Q",
  authDomain: "quickchat-f5012.firebaseapp.com",
  projectId: "quickchat-f5012",
  storageBucket: "quickchat-f5012.firebasestorage.app",
  messagingSenderId: "80730246249",
  appId: "1:80730246249:web:b3b444c63aca7a5c7466f8"
};
const fbApp = initializeApp(FB);
const db = getFirestore(fbApp);
const auth = getAuth(fbApp);
// config.js
export const XAM_CONFIG = {
  // Ваш client_id (полученный в XAM Developer)
  clientId: 'xam_xjsilFjNx6Zgi01xq6zGPQ',

  // Redirect URI – должен совпадать с указанным в XAM Developer
  redirectUri: window.location.origin + '/oauth/callback',

  // Реальные endpoint'ы XAM (замените, когда получите от XAM)
  authorizeUrl: 'https://api.xam.chat/oauth/authorize',   // пример
  tokenUrl: 'https://api.xam.chat/oauth/token',           // пример
  userInfoUrl: 'https://api.xam.chat/api/user',           // пример

  // Для тестирования без реального API можно включить демо-режим
  demoMode: false  // установите true, если хотите имитировать вход
};


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

// ════════════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════════════
let me = null, myProfile = null;
let activeChat = null;
let allMessages = [];
let chatList = [];
let usersCache = new Map();
let roomsCache = new Map();
let unsubMsgs = null, unsubTyping = null;
let typingTimer = null;
let replyToMsg = null;
let fwdMsg = null;
let regAvatar = '😊', grpAvatar = '👥', chAvatar = '📢';
let profAvatar = null;
let currentCtxMsg = null;
let historyState = 'list'; // 'list' | 'chat' | 'contacts' | 'settings'

// ── Helpers ──────────────────────────────────────────
const $  = id => document.getElementById(id);
const esc = t => { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; };
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const AVATARS = ['😊','😎','🐱','🐶','🦊','🐼','⭐','💡','🎸','📱','☕','🍕','❤️','🔥','🌟','👍','🦋','🎯'];
const EMOJIS  = ['😊','😂','❤️','👍','🔥','✨','🎉','😎','🙏','💪','👀','😢','😍','🤔','😅','🥰','😆','🤣','😭','💀','🤡','👋','🫡','🎊','🎁','💯','🚀','🌈','🌙','⭐','🍕','☕','🎸','📱','💻'];

function avatarHtml(av, sz = '100%') {
  if (!av) return '😊';
  if (av.startsWith('data:') || av.startsWith('http'))
    return `<img src="${esc(av)}" style="width:${sz};height:${sz};object-fit:cover;border-radius:50%;">`;
  return esc(av);
}
function getDisplayName(uid) {
  if (uid === me?.uid) {
    if (myProfile?.firstName) return `${myProfile.firstName} ${myProfile.lastName || ''}`.trim();
    return myProfile?.name || 'Вы';
  }
  const u = usersCache.get(uid);
  if (!u) return 'Неизвестный';
  if (u.firstName) return `${u.firstName} ${u.lastName || ''}`.trim();
  return u.name || u.username || 'Неизвестный';
}
function chatIdForPrivate(uid) { return 'chat_' + [me.uid, uid].sort().join('_'); }
async function getChatId(chat) {
  if (!chat) return null;
  if (chat.type === 'self') return `self_${me.uid}`;
  if (chat.type === 'private') return chatIdForPrivate(chat.id);
  if (chat.type === 'group' || chat.type === 'channel') return `room_${chat.id}`;
  return chat.id;
}
async function getActiveChatId() { return getChatId(activeChat); }

function showToast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2400);
}

// ── Avatar grid helper ────────────────────────────────
function renderAvGrid(containerId, selected, onSelect) {
  const el = $(containerId);
  if (!el) return;
  el.innerHTML = AVATARS.map(a =>
    `<div class="av-opt ${a === selected ? 'sel' : ''}" data-av="${esc(a)}">${a}</div>`
  ).join('');
  el.querySelectorAll('.av-opt').forEach(o => o.onclick = () => {
    el.querySelectorAll('.av-opt').forEach(x => x.classList.remove('sel'));
    o.classList.add('sel');
    if (onSelect) onSelect(o.dataset.av);
  });
}

// ════════════════════════════════════════════════════
//  SPLASH & INIT
// ════════════════════════════════════════════════════
function hideSplash() { $('splash').classList.add('gone'); }

// Init emoji picker
const ep = $('emoji-picker');
ep.innerHTML = EMOJIS.map(e => `<div class="ep-item">${e}</div>`).join('');
ep.querySelectorAll('.ep-item').forEach(el => el.onclick = () => {
  $('msg-input').value += el.textContent;
  closeEmojiPicker();
  $('msg-input').focus();
});

function openEmojiPicker() {
  ep.classList.add('show');
  $('emoji-dim').classList.add('show');
}
function closeEmojiPicker() {
  ep.classList.remove('show');
  $('emoji-dim').classList.remove('show');
}
$('emoji-btn').onclick = e => { e.stopPropagation(); ep.classList.contains('show') ? closeEmojiPicker() : openEmojiPicker(); };
$('emoji-dim').onclick = closeEmojiPicker;

// Avatar grids
renderAvGrid('reg-av-grid', '😊', v => regAvatar = v);

// ════════════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════════════
$('login-btn').onclick = async () => {
  const em = $('l-email').value.trim().toLowerCase();
  const pw = $('l-pass').value;
  const err = $('l-err');
  err.className = 'err-msg'; err.textContent = '';
  if (!validEmail(em)) { err.textContent = 'Некорректный email'; err.classList.add('show'); return; }
  try { await signInWithEmailAndPassword(auth, em, pw); }
  catch { err.textContent = '❌ Неверный email или пароль'; err.classList.add('show'); }
};
$('l-pass').onkeydown = e => { if (e.key === 'Enter') $('login-btn').click(); };

$('reg-btn').onclick = async () => {
  const em = $('r-email').value.trim().toLowerCase();
  const un = $('r-uname').value.trim();
  const pw = $('r-pass').value;
  const fn = $('r-first').value.trim();
  const ln = $('r-last').value.trim();
  const err = $('r-err');
  err.className = 'err-msg'; err.textContent = '';
  if (!validEmail(em)) { err.textContent = '❌ Некорректный email'; err.classList.add('show'); return; }
  if (!un.startsWith('@') || un.length < 3) { err.textContent = '❌ Юзернейм должен начинаться с @'; err.classList.add('show'); return; }
  if (pw.length < 6) { err.textContent = '❌ Пароль минимум 6 символов'; err.classList.add('show'); return; }
  if (!fn) { err.textContent = '❌ Введите имя'; err.classList.add('show'); return; }
  try {
    const snap = await getDocs(query(collection(db, 'users'), where('username', '==', un)));
    if (!snap.empty) { err.textContent = '❌ Юзернейм занят'; err.classList.add('show'); return; }
    const uc = await createUserWithEmailAndPassword(auth, em, pw);
    await setDoc(doc(db, 'users', uc.user.uid), {
      email: em, username: un, firstName: fn, lastName: ln,
      name: fn + (ln ? ' ' + ln : ''), avatar: regAvatar, uid: uc.user.uid,
      contacts: [], privacyWrite: 'all'
    });
    await sendEmailVerification(uc.user);
    showVerifyScreen(em);
  } catch (e) {
    err.textContent = e.code === 'auth/email-already-in-use' ? '❌ Email уже зарегистрирован' : `❌ ${e.message}`;
    err.classList.add('show');
  }
};

$('google-btn').onclick = async () => {
  try {
    const res = await signInWithPopup(auth, new GoogleAuthProvider());
    const u = res.user;
    const ud = await getDoc(doc(db, 'users', u.uid));
    if (!ud.exists()) {
      const names = (u.displayName || '').split(' ');
      await setDoc(doc(db, 'users', u.uid), {
        email: u.email, username: `@user_${u.uid.slice(0, 6)}`,
        firstName: names[0] || 'Пользователь', lastName: names.slice(1).join(' ') || '',
        avatar: u.photoURL || '😊', name: u.displayName || 'Пользователь',
        uid: u.uid, contacts: [], privacyWrite: 'all'
      });
    }
  } catch (e) { showToast('Ошибка Google: ' + e.message); }
};

document.querySelectorAll('.auth-tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.auth-tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  const isReg = t.dataset.tab === 'reg';
  $('login-form').classList.toggle('hidden', isReg);
  $('reg-form').classList.toggle('hidden', !isReg);
});

function showVerifyScreen(email) {
  $('verify-email').textContent = email;
  $('auth-forms').classList.add('hidden');
  $('verify-wrap').classList.remove('hidden');
}
$('resend-btn').onclick = async () => {
  if (auth.currentUser) { await sendEmailVerification(auth.currentUser); showToast('Письмо отправлено!'); }
};
$('check-verify-btn').onclick = async () => {
  if (!auth.currentUser) return;
  await auth.currentUser.reload();
  if (auth.currentUser.emailVerified) { showToast('✅ Email подтверждён! Войдите снова.'); await signOut(auth); }
  else showToast('❌ Email ещё не подтверждён.');
};
$('verify-logout-btn').onclick = () => signOut(auth);

// ════════════════════════════════════════════════════
//  AUTH STATE
// ════════════════════════════════════════════════════
let initialized = false;
onAuthStateChanged(auth, async user => {
  if (user) {
    if (!user.emailVerified) { showVerifyScreen(user.email); hideSplash(); return; }
    let ud = await getUserDoc(user.uid);
    let tries = 0;
    while (!ud && tries++ < 12) { await sleep(400); ud = await getUserDoc(user.uid); }
    if (!ud) { await signOut(auth); hideSplash(); return; }
    me = { uid: user.uid, email: user.email };
    myProfile = ud;
    await refreshCaches();
    await buildChatList();
    $('auth-screen').classList.add('gone');
    $('app').classList.remove('hidden');
    startHeartbeat();
    // Listen for changes
    onSnapshot(collection(db, 'users'), () => { refreshUsersCache(); buildChatList(); });
    onSnapshot(collection(db, 'rooms'), () => { refreshRoomsCache(); buildChatList(); });
    initialized = true;
  } else {
    if (initialized) { stopAllSubs(); stopHeartbeat(); initialized = false; }
    me = null; myProfile = null; activeChat = null;
    $('auth-screen').classList.remove('gone');
    $('app').classList.add('hidden');
  }
  hideSplash();
});

// ════════════════════════════════════════════════════
//  CACHES
// ════════════════════════════════════════════════════
async function getUserDoc(uid) { const s = await getDoc(doc(db, 'users', uid)); return s.exists() ? s.data() : null; }
async function refreshUsersCache() {
  const s = await getDocs(collection(db, 'users'));
  s.forEach(d => usersCache.set(d.id, { uid: d.id, ...d.data() }));
}
async function refreshRoomsCache() {
  const s = await getDocs(collection(db, 'rooms'));
  s.forEach(d => roomsCache.set(d.id, { id: d.id, ...d.data() }));
}
async function refreshCaches() { await Promise.all([refreshUsersCache(), refreshRoomsCache()]); }

// ════════════════════════════════════════════════════
//  CHAT LIST
// ════════════════════════════════════════════════════
async function buildChatList() {
  if (!me) return;
  let items = [];
  const seen = new Set();

  // 1. Избранное
  items.push({ id: 'self', name: 'Избранное', avatar: '📁', lastMsg: 'Сохраните что-нибудь', lastMsgTime: '', type: 'self' });
  seen.add('self_self');

  // 2. Комнаты
  roomsCache.forEach(r => {
    if (r.members?.includes(me.uid)) {
      const key = `room_${r.id}`;
      if (!seen.has(key)) {
        items.push({ id: r.id, name: r.name, avatar: r.avatar || '👥', lastMsg: '', lastMsgTime: '', type: r.type, roomData: r });
        seen.add(key);
      }
    }
  });

  // 3. Приватные чаты
  const snap = await getDocs(query(collection(db, 'messages'), where('chatId', '>=', 'chat_'), where('chatId', '<=', 'chat_\uf8ff')));
  const chatIds = new Set();
  snap.forEach(d => {
    const cid = d.data().chatId;
    if (cid?.startsWith('chat_')) {
      const parts = cid.split('_');
      const other = parts.find(p => p !== me.uid && p !== 'chat');
      if (other && other !== me.uid) chatIds.add(other);
    }
  });
  for (const uid of chatIds) {
    const key = `private_${uid}`;
    if (!seen.has(key)) {
      const u = usersCache.get(uid);
      if (u) { items.push({ id: uid, name: getDisplayName(uid), avatar: u.avatar, lastMsg: '', lastMsgTime: '', type: 'private' }); seen.add(key); }
    }
  }

  // 4. Последние сообщения
  await Promise.all(items.map(async item => {
    const cid = await getChatId(item);
    if (!cid) return;
    const q = query(collection(db, 'messages'), where('chatId', '==', cid), orderBy('timestamp', 'desc'), limit(1));
    const s = await getDocs(q);
    if (!s.empty) {
      const data = s.docs[0].data();
      let preview = data.text || '';
      if (preview.startsWith('[sticker]')) preview = '🎨 Стикер';
      else if (preview.startsWith('[voice]')) preview = '🎙️ Голосовое';
      else if (preview.startsWith('[call:')) preview = '📞 Звонок';
      item.lastMsg = preview;
      const date = data.timestamp?.toDate?.();
      if (date) item.lastMsgTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }));

  // 5. Сортировка
  items.sort((a, b) => {
    if (a.type === 'self') return -1;
    if (b.type === 'self') return 1;
    const ta = a.lastMsgTime ? new Date(`1970-01-01T${a.lastMsgTime}:00`) : 0;
    const tb = b.lastMsgTime ? new Date(`1970-01-01T${b.lastMsgTime}:00`) : 0;
    return tb - ta;
  });

  chatList = items;
  renderChatList();
}

function renderChatList(filter = '') {
  const f = filter.toLowerCase().trim();
  const visible = f ? chatList.filter(c => c.name.toLowerCase().includes(f)) : chatList;
  const el = $('chat-list');
  if (!el) return;

  if (!visible.length) {
    el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-hint);font-size:14px;">Ничего не найдено</div>';
    return;
  }

  let html = '';
  let hadFavHeader = false;
  for (const chat of visible) {
    if (chat.type === 'self' && !hadFavHeader) {
      html += `<div class="chat-divider">Избранное</div>`;
      hadFavHeader = true;
    }
    const isActive = activeChat?.id === chat.id && activeChat?.type === chat.type;
    html += `
      <div class="chat-row${isActive ? '' : ''}" data-id="${esc(chat.id)}" data-type="${esc(chat.type)}">
        <div class="cr-av">${avatarHtml(chat.avatar)}</div>
        <div class="cr-body">
          <div class="cr-top">
            <div class="cr-name">${esc(chat.name)}</div>
            <div class="cr-time">${esc(chat.lastMsgTime || '')}</div>
          </div>
          <div class="cr-preview">${esc(chat.lastMsg || 'Нет сообщений')}</div>
        </div>
      </div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('.chat-row').forEach(row => {
    row.onclick = () => {
      const chat = chatList.find(c => c.id === row.dataset.id && c.type === row.dataset.type);
      if (chat) openChat(chat);
    };
  });
}

$('chat-search').oninput = function () {
  $('clear-search').classList.toggle('hidden', !this.value);
  renderChatList(this.value);
};
$('clear-search').onclick = () => { $('chat-search').value = ''; $('clear-search').classList.add('hidden'); renderChatList(); };

// ════════════════════════════════════════════════════
//  NAVIGATION
// ════════════════════════════════════════════════════
function navigateTo(pageName) {
  // pageName: 'chats' | 'chat' | 'contacts' | 'settings'
  // Reset all pages
  $('page-chat').classList.remove('active');
  $('page-contacts').classList.remove('active');
  $('page-settings').classList.remove('active');

  if (pageName === 'chat') { $('page-chat').classList.add('active'); }
  else if (pageName === 'contacts') { $('page-contacts').classList.add('active'); loadContacts(); }
  else if (pageName === 'settings') { $('page-settings').classList.add('active'); renderSettings(); }
  // 'chats' = default, nothing to activate

  historyState = pageName;

  // Update bottom nav
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === pageName || (pageName === 'chats' && b.dataset.tab === 'chats'));
  });
}

// Bottom nav
document.querySelectorAll('.nav-btn').forEach(b => b.onclick = () => {
  const tab = b.dataset.tab;
  if (tab === 'chats') navigateTo('chats');
  else if (tab === 'contacts') { history.pushState({ page: 'contacts' }, ''); navigateTo('contacts'); }
  else if (tab === 'settings') { history.pushState({ page: 'settings' }, ''); navigateTo('settings'); }
});

$('back-from-chat').onclick = () => {
  stopAllSubs();
  history.back();
};
$('back-from-contacts').onclick = () => history.back();
$('back-from-settings').onclick = () => history.back();

// Android back button
window.addEventListener('popstate', e => {
  const st = e.state;
  if (!st) {
    // Back to chat list
    navigateTo('chats');
  } else if (st.page === 'contacts') {
    navigateTo('contacts');
  } else if (st.page === 'settings') {
    navigateTo('settings');
  } else if (st.page === 'chat') {
    navigateTo('chat');
  } else {
    navigateTo('chats');
  }
});

$('compose-btn').onclick = () => {
  history.pushState({ page: 'contacts' }, '');
  navigateTo('contacts');
};

// ════════════════════════════════════════════════════
//  OPEN CHAT
// ════════════════════════════════════════════════════
async function openChat(chat) {
  if (!me) return;
  stopAllSubs();
  activeChat = chat;

  // Header
  $('chat-hdr-av').innerHTML = avatarHtml(chat.avatar);
  $('chat-hdr-name').textContent = chat.name;
  $('chat-hdr-status').textContent = '';
  $('chat-hdr-status').className = 'hdr-status';

  // Clear messages
  const wrap = $('messages-wrap');
  wrap.innerHTML = '<div class="center-loader" id="msg-loader"><div class="loader"></div></div>';

  // Push history state
  history.pushState({ page: 'chat', chatId: chat.id, chatType: chat.type }, '');
  navigateTo('chat');

  // Load messages
  await loadMessages();

  renderChatList();
}

// ════════════════════════════════════════════════════
//  LOAD MESSAGES
// ════════════════════════════════════════════════════
async function loadMessages() {
  if (!activeChat || !me) return;
  const chatId = await getActiveChatId();
  if (!chatId) return;

  unsubMsgs = onSnapshot(
    query(collection(db, 'messages'), where('chatId', '==', chatId)),
    snap => {
      allMessages = snap.docs.map(d => ({ id: d.id, ...d.data(), _pending: d.metadata.hasPendingWrites }))
        .sort((a, b) => (a.timestamp?.toMillis?.() || 0) - (b.timestamp?.toMillis?.() || 0));
      const loader = $('msg-loader');
      if (loader) loader.remove();
      renderMessages();
      scrollToBottom();
    }
  );

  unsubTyping = onSnapshot(doc(db, 'typing', `typing_${chatId}`), snap => {
    const st = $('chat-hdr-status');
    if (!st) return;
    if (!snap.exists()) { st.textContent = ''; st.className = 'hdr-status'; return; }
    const data = snap.data();
    const typers = Object.keys(data).filter(k => k !== me.uid && k !== 'updatedAt');
    if (typers.length) {
      const name = getDisplayName(typers[0]).split(' ')[0];
      st.innerHTML = `${esc(name)} печатает <span class="typing-dots"><span></span><span></span><span></span></span>`;
      st.className = 'hdr-status online';
    } else {
      st.textContent = '';
      st.className = 'hdr-status';
    }
  });
}

// ════════════════════════════════════════════════════
//  RENDER MESSAGES
// ════════════════════════════════════════════════════
function renderMessages() {
  const wrap = $('messages-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  if (!allMessages.length) {
    wrap.innerHTML = `<div class="empty-msgs"><div class="empty-msgs-inner"><div class="empty-msgs-icon">💬</div><div class="empty-msgs-text">Нет сообщений. Напишите первым!</div></div></div>`;
    return;
  }

  let lastDate = null;
  let currentGroup = null;
  const groups = [];
  const fragment = document.createDocumentFragment();

  for (const msg of allMessages) {
    const dateObj = msg.timestamp?.toDate?.();
    const dateStr = dateObj ? dateObj.toLocaleDateString('ru', { day: 'numeric', month: 'long' }) : null;

    if (dateStr !== lastDate) {
      if (currentGroup) { groups.push(currentGroup); currentGroup = null; }
      lastDate = dateStr;
      const dl = document.createElement('div');
      dl.className = 'day-label';
      dl.textContent = dateStr;
      fragment.appendChild(dl);
    }

    const isOut = msg.senderUid === me?.uid;
    if (!currentGroup || currentGroup.senderUid !== msg.senderUid || currentGroup.isOut !== isOut) {
      if (currentGroup) groups.push(currentGroup);
      currentGroup = { senderUid: msg.senderUid, isOut, messages: [msg] };
    } else {
      currentGroup.messages.push(msg);
    }
  }
  if (currentGroup) groups.push(currentGroup);

  for (const group of groups) {
    const grpEl = document.createElement('div');
    grpEl.className = `msg-group ${group.isOut ? 'out' : 'in'}`;

    if (!group.isOut && (activeChat?.type === 'group' || activeChat?.type === 'channel')) {
      const ns = document.createElement('div');
      ns.className = 'msg-sender-name';
      ns.textContent = getDisplayName(group.senderUid);
      grpEl.appendChild(ns);
    }

    for (let i = 0; i < group.messages.length; i++) {
      const msg = group.messages[i];
      const row = document.createElement('div');
      row.className = 'msg-row';

      if (!group.isOut) {
        if (i === 0) {
          const av = document.createElement('div');
          av.className = 'msg-av-sm';
          const u = usersCache.get(msg.senderUid);
          av.innerHTML = avatarHtml(u?.avatar || '😊');
          row.appendChild(av);
        } else {
          const sp = document.createElement('div');
          sp.className = 'msg-av-sp';
          row.appendChild(sp);
        }
      }

      const bubble = document.createElement('div');
      bubble.className = `bubble${msg._pending ? ' pending' : ''}${msg.isDeleted ? ' deleted' : ''}`;
      bubble.dataset.msgId = msg.id;

      // Forwarded
      if (msg.isForwarded && !msg.isDeleted) {
        const fb = document.createElement('div');
        fb.className = 'fwd-block';
        fb.innerHTML = `<div class="fwd-label">↩️ Переслано от <span class="fwd-sender">${esc(getDisplayName(msg.forwardedFrom))}</span></div>`;
        bubble.appendChild(fb);
      }

      // Reply
      if (msg.replyToText) {
        const rq = document.createElement('div');
        rq.className = 'reply-preview';
        rq.innerHTML = `<div class="reply-preview-name">${esc(getDisplayName(msg.replyToSender || ''))}</div><div class="reply-preview-text">${esc((msg.replyToText || '').slice(0, 80))}</div>`;
        bubble.appendChild(rq);
      }

      // Content
      const content = document.createElement('div');
      content.className = 'bubble-text';

      if (msg.isDeleted) {
        content.innerHTML = '<i>Сообщение удалено</i>';
      } else if (msg.isCallEvent) {
        const icon = msg.callType === 'video' ? '📹' : '📞';
        const statusTxt = msg.callStatus === 'missed' ? '📵 Нет ответа' : msg.callStatus === 'rejected' ? '🚫 Отклонён' : `${icon} Звонок`;
        content.innerHTML = `<span style="font-size:14px;">${statusTxt}</span>`;
      } else if (msg.isSticker && msg.text?.startsWith('[sticker]')) {
        content.innerHTML = `<img src="${esc(msg.text.slice(9))}" class="sticker-img" loading="lazy">`;
      } else if (msg.isVoice && msg.text?.startsWith('[voice]')) {
        content.innerHTML = `<div style="display:flex;align-items:center;gap:8px;"><span>🎙️</span><audio controls src="${esc(msg.text.slice(7))}" style="flex:1;height:28px;min-width:100px;"></audio></div>`;
      } else if (msg.isFileLink) {
        content.innerHTML = `<img src="${esc(msg.text || '')}" class="bubble-img" loading="lazy" onerror="this.style.display='none'"><a href="${esc(msg.text || '')}" target="_blank" style="font-size:11px;display:block;margin-top:3px;color:inherit;opacity:.8;">📎 Открыть</a>`;
      } else {
        const txt = msg.text || '';
        if (/\.(jpg|jpeg|png|gif|webp)$/i.test(txt) && txt.startsWith('http')) {
          content.innerHTML = `<img src="${esc(txt)}" class="bubble-img" loading="lazy">`;
        } else {
          content.textContent = txt;
        }
      }
      bubble.appendChild(content);

      // Reaction
      if (msg.reaction) {
        const rc = document.createElement('div');
        rc.className = 'reaction-chip';
        rc.textContent = msg.reaction;
        rc.onclick = async () => { await updateDoc(doc(db, 'messages', msg.id), { reaction: null }); };
        bubble.appendChild(rc);
      }

      // Time
      const timeEl = document.createElement('div');
      timeEl.className = 'bubble-time';
      const t = msg.timestamp?.toDate?.()?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '';
      const tick = group.isOut ? `<span class="tick">${msg._pending ? '🕐' : '✓✓'}</span>` : '';
      timeEl.innerHTML = `${msg.edited ? '<span style="font-size:9px;opacity:.7;">ред. </span>' : ''}${esc(t)}${tick}`;
      bubble.appendChild(timeEl);

      // Long-press for context menu
      let pressTimer;
      bubble.addEventListener('touchstart', ev => {
        ev.stopPropagation();
        pressTimer = setTimeout(() => { showMsgCtx(msg, bubble); }, 480);
      }, { passive: true });
      bubble.addEventListener('touchend', () => clearTimeout(pressTimer));
      bubble.addEventListener('touchmove', () => clearTimeout(pressTimer));

      row.appendChild(bubble);
      grpEl.appendChild(row);
    }
    fragment.appendChild(grpEl);
  }
  wrap.appendChild(fragment);
}

window.scrollToBottom = function() {
  const wrap = document.getElementById('messages-wrap');
  if (!wrap) return;
  // Используем requestAnimationFrame, чтобы дождаться обновления DOM
  requestAnimationFrame(() => {
    wrap.scrollTo({
      top: wrap.scrollHeight,
      behavior: 'smooth'
    });
  });
};

// ════════════════════════════════════════════════════
//  SEND MESSAGE
// ════════════════════════════════════════════════════
async function sendMessage() {
  const text = $('msg-input').value.trim();
  if (!text || !me || !activeChat) return;

  if (activeChat.type === 'channel') {
    const rd = activeChat.roomData;
    if (rd && !rd.admins?.includes(me.uid)) { showToast('⛔ Только администраторы могут писать'); return; }
  }

  const chatId = await getActiveChatId();
  if (!chatId) return;

  const msgData = { chatId, text, timestamp: serverTimestamp(), senderUid: me.uid, isSticker: false, isVoice: false };
  if (replyToMsg) {
    msgData.replyToId = replyToMsg.id;
    msgData.replyToText = replyToMsg.text;
    msgData.replyToSender = replyToMsg.senderUid;
    clearReply();
  }

  $('msg-input').value = '';
  autoResize();
  await addDoc(collection(db, 'messages'), msgData);
  clearTyping();
}

$('send-btn').onclick = sendMessage;
$('msg-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

function autoResize() {
  const el = $('msg-input');
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}
$('msg-input').addEventListener('input', () => { autoResize(); if ($('msg-input').value.trim()) triggerTyping(); else clearTyping(); });

// Typing
async function triggerTyping() {
  if (!activeChat || !me) return;
  const chatId = await getActiveChatId();
  if (!chatId) return;
  if (typingTimer) clearTimeout(typingTimer);
  await setDoc(doc(db, 'typing', `typing_${chatId}`), { [me.uid]: serverTimestamp() }, { merge: true });
  typingTimer = setTimeout(() => clearTyping(), 2500);
}
async function clearTyping() {
  if (!activeChat || !me) return;
  if (typingTimer) { clearTimeout(typingTimer); typingTimer = null; }
  const chatId = await getActiveChatId();
  if (!chatId) return;
  const snap = await getDoc(doc(db, 'typing', `typing_${chatId}`));
  if (snap.exists()) {
    const data = snap.data(); delete data[me.uid];
    if (!Object.keys(data).filter(k => k !== 'updatedAt').length) await deleteDoc(doc(db, 'typing', `typing_${chatId}`));
    else await updateDoc(doc(db, 'typing', `typing_${chatId}`), { [me.uid]: null });
  }
}

// Reply
function clearReply() {
  replyToMsg = null;
  $('reply-bar').classList.remove('show');
}
$('cancel-reply').onclick = clearReply;

// ════════════════════════════════════════════════════
//  FILE UPLOAD (imgbb)
// ════════════════════════════════════════════════════
$('attach-btn').onclick = () => {
  showToast('📎 Выберите изображение');
  $('file-input').click();
};
$('file-input').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  if (f.size > 5 * 1024 * 1024) { showToast('Максимум 5 МБ'); return; }
  showToast('⏳ Загружаю...');
  try {
    const fd = new FormData(); fd.append('image', f); fd.append('key', '823ae83baa8123fe4d0d3dc1beb05c6e');
    const res = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.success) {
      const chatId = await getActiveChatId();
      await addDoc(collection(db, 'messages'), { chatId, text: data.data.url, timestamp: serverTimestamp(), senderUid: me.uid, isFileLink: true });
      showToast('✅ Изображение отправлено');
    } else showToast('❌ Ошибка загрузки');
  } catch { showToast('❌ Ошибка сети'); }
  e.target.value = '';
};

// ════════════════════════════════════════════════════
//  CONTEXT MENU (long-press on message)
// ════════════════════════════════════════════════════
function showMsgCtx(msg, bubble) {
  currentCtxMsg = msg;
  const isOut = msg.senderUid === me?.uid;
  const items = [];

  // Reaction row
  items.push({ type: 'reactions' });
  items.push({ icon: '↩️', label: 'Ответить', action: 'reply' });
  items.push({ icon: '📤', label: 'Переслать', action: 'fwd' });
  if (!msg.isDeleted) {
    if (isOut) {
      items.push({ icon: '✏️', label: 'Изменить', action: 'edit' });
      items.push({ icon: '🗑️', label: 'Удалить', action: 'del', danger: true });
    }
  }
  items.push({ icon: '📋', label: 'Скопировать', action: 'copy' });

  const ci = $('ctx-items');
  ci.innerHTML = '';

  for (const item of items) {
    if (item.type === 'reactions') {
      const rr = document.createElement('div');
      rr.style.cssText = 'display:flex;gap:6px;padding:10px 18px;overflow-x:auto;';
      ['❤️','😂','😮','😢','👍','👎','🔥','🥰'].forEach(em => {
        const rb = document.createElement('div');
        rb.style.cssText = 'font-size:28px;cursor:pointer;padding:4px;border-radius:8px;flex-shrink:0;';
        rb.textContent = em;
        rb.onclick = async () => {
          await updateDoc(doc(db, 'messages', msg.id), { reaction: msg.reaction === em ? null : em });
          closeCtx();
        };
        rr.appendChild(rb);
      });
      ci.appendChild(rr);
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      ci.appendChild(sep);
      continue;
    }
    const div = document.createElement('div');
    div.className = 'ctx-item' + (item.danger ? ' danger' : '');
    div.innerHTML = `<span class="ctx-icon">${item.icon}</span>${item.label}`;
    div.onclick = () => { closeCtx(); handleCtxAction(item.action, msg); };
    ci.appendChild(div);
  }

  $('ctx-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCtx() {
  $('ctx-overlay').classList.remove('open');
  document.body.style.overflow = '';
}
$('ctx-overlay').onclick = e => { if (e.target === $('ctx-overlay')) closeCtx(); };

async function handleCtxAction(action, msg) {
  if (action === 'reply') {
    replyToMsg = msg;
    $('reply-bar').classList.add('show');
    $('reply-bar-name').textContent = getDisplayName(msg.senderUid);
    $('reply-bar-text').textContent = (msg.text || '').slice(0, 80);
    $('msg-input').focus();
  } else if (action === 'fwd') {
    showForwardModal(msg);
  } else if (action === 'edit') {
    const newText = prompt('Изменить сообщение:', msg.text);
    if (newText?.trim()) await updateDoc(doc(db, 'messages', msg.id), { text: newText.trim(), edited: true });
  } else if (action === 'del') {
    if (confirm('Удалить сообщение?')) await updateDoc(doc(db, 'messages', msg.id), { text: 'Сообщение удалено', isDeleted: true });
  } else if (action === 'copy') {
    try { await navigator.clipboard.writeText(msg.text || ''); showToast('Скопировано!'); }
    catch { showToast('Не удалось скопировать'); }
  }
}

// ════════════════════════════════════════════════════
//  FORWARD MODAL
// ════════════════════════════════════════════════════
function showForwardModal(msg) {
  fwdMsg = msg;
  const targets = chatList.filter(c => c.id !== activeChat?.id);
  const fl = $('forward-list');
  fl.innerHTML = '';
  if (!targets.length) { fl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-hint);">Нет доступных чатов</div>'; }
  else {
    targets.forEach(chat => {
      const div = document.createElement('div');
      div.className = 'contact-item';
      div.innerHTML = `<div class="ci-av">${avatarHtml(chat.avatar)}</div><div class="ci-info"><div class="ci-name">${esc(chat.name)}</div></div>`;
      div.onclick = async () => {
        const targetId = await getChatId(chat);
        if (!targetId) return;
        await addDoc(collection(db, 'messages'), { chatId: targetId, text: fwdMsg.text || '', timestamp: serverTimestamp(), senderUid: me.uid, isForwarded: true, forwardedFrom: fwdMsg.senderUid, originalMsgId: fwdMsg.id, isSticker: fwdMsg.isSticker || false, isVoice: fwdMsg.isVoice || false, isFileLink: fwdMsg.isFileLink || false });
        closeModal('modal-forward');
        showToast('✅ Переслано!');
      };
      fl.appendChild(div);
    });
  }
  openModal('modal-forward');
}

// ════════════════════════════════════════════════════
//  CONTACTS
// ════════════════════════════════════════════════════
async function loadContacts() {
  await refreshUsersCache();
  const contacts = myProfile?.contacts || [];
  renderMyContacts(contacts);
}

function renderMyContacts(contacts) {
  const el = $('contacts-mine');
  if (!el) return;
  const mine = contacts.map(uid => usersCache.get(uid)).filter(Boolean);
  if (!mine.length) { el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-hint);font-size:14px;">Нет контактов</div>'; return; }
  el.innerHTML = '';
  mine.forEach(u => {
    const div = document.createElement('div');
    div.className = 'contact-item';
    div.innerHTML = `<div class="ci-av">${avatarHtml(u.avatar)}</div><div class="ci-info"><div class="ci-name">${esc(getDisplayName(u.uid))}</div><div class="ci-uname">${esc(u.username || '')}</div></div><div class="ci-actions"><button class="ci-btn" data-uid="${u.uid}" data-action="msg">💬</button><button class="ci-btn red" data-uid="${u.uid}" data-action="rem">✕</button></div>`;
    div.querySelectorAll('.ci-btn').forEach(b => b.onclick = async e => {
      e.stopPropagation();
      if (b.dataset.action === 'msg') {
        const chat = chatList.find(c => c.id === b.dataset.uid && c.type === 'private') || { id: b.dataset.uid, name: getDisplayName(b.dataset.uid), avatar: usersCache.get(b.dataset.uid)?.avatar, type: 'private' };
        openChat(chat);
      } else {
        await setDoc(doc(db, 'users', me.uid), { contacts: arrayRemove(b.dataset.uid) }, { merge: true });
        if (myProfile) myProfile.contacts = (myProfile.contacts || []).filter(x => x !== b.dataset.uid);
        loadContacts();
      }
    });
    div.onclick = e => { if (e.target.closest('.ci-btn')) return; openUserView(u.uid); };
    el.appendChild(div);
  });
}

$('contacts-search').oninput = async function () {
  const q = this.value.trim().toLowerCase();
  const res = $('contacts-search-res');
  if (!q) { res.innerHTML = ''; return; }
  const found = [];
  usersCache.forEach((u, uid) => {
    if (uid === me.uid) return;
    const nm = getDisplayName(uid).toLowerCase();
    if (nm.includes(q) || (u.username || '').toLowerCase().includes(q)) found.push({ uid, ...u });
  });
  if (!found.length) { res.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-hint);font-size:13px;">Ничего не найдено</div>'; return; }
  const ctcs = myProfile?.contacts || [];
  res.innerHTML = '';
  found.slice(0, 20).forEach(u => {
    const inCts = ctcs.includes(u.uid);
    const div = document.createElement('div');
    div.className = 'contact-item';
    div.innerHTML = `<div class="ci-av">${avatarHtml(u.avatar)}</div><div class="ci-info"><div class="ci-name">${esc(getDisplayName(u.uid))}</div><div class="ci-uname">${esc(u.username || u.uid.slice(0,12))}</div></div><div class="ci-actions"><button class="ci-btn" data-uid="${u.uid}" data-action="msg">💬</button><button class="ci-btn ${inCts ? 'red' : ''}" data-uid="${u.uid}" data-action="${inCts ? 'rem' : 'add'}">${inCts ? '✕' : '+'}</button></div>`;
    div.querySelectorAll('.ci-btn').forEach(b => b.onclick = async e => {
      e.stopPropagation();
      if (b.dataset.action === 'msg') {
        const chat = chatList.find(c => c.id === b.dataset.uid && c.type === 'private') || { id: b.dataset.uid, name: getDisplayName(b.dataset.uid), avatar: usersCache.get(b.dataset.uid)?.avatar, type: 'private' };
        openChat(chat);
      } else if (b.dataset.action === 'add') {
        await setDoc(doc(db, 'users', me.uid), { contacts: arrayUnion(b.dataset.uid) }, { merge: true });
        if (myProfile) myProfile.contacts = [...(myProfile.contacts || []), b.dataset.uid];
        $('contacts-search').dispatchEvent(new Event('input'));
      } else {
        await setDoc(doc(db, 'users', me.uid), { contacts: arrayRemove(b.dataset.uid) }, { merge: true });
        if (myProfile) myProfile.contacts = (myProfile.contacts || []).filter(x => x !== b.dataset.uid);
        $('contacts-search').dispatchEvent(new Event('input'));
      }
    });
    div.onclick = e => { if (e.target.closest('.ci-btn')) return; openUserView(u.uid); };
    res.appendChild(div);
  });
};

// ════════════════════════════════════════════════════
//  USER VIEW
// ════════════════════════════════════════════════════
function openUserView(uid) {
  const u = usersCache.get(uid); if (!u) return;
  $('uv-av').innerHTML = avatarHtml(u.avatar);
  $('uv-name').textContent = getDisplayName(uid);
  $('uv-uname').textContent = u.username || '';
  const inCts = (myProfile?.contacts || []).includes(uid);
  const addBtn = $('uv-add-btn');
  addBtn.textContent = inCts ? '✕ Удалить' : '+ Контакт';
  addBtn.className = `upv-btn ${inCts ? 'gray' : 'green'}`;
  addBtn.onclick = async () => {
    if (inCts) {
      await setDoc(doc(db, 'users', me.uid), { contacts: arrayRemove(uid) }, { merge: true });
      if (myProfile) myProfile.contacts = (myProfile.contacts || []).filter(x => x !== uid);
    } else {
      await setDoc(doc(db, 'users', me.uid), { contacts: arrayUnion(uid) }, { merge: true });
      if (myProfile) myProfile.contacts = [...(myProfile.contacts || []), uid];
    }
    closeModal('modal-user-view');
  };
  $('uv-msg-btn').onclick = () => {
    closeModal('modal-user-view');
    openChat({ id: uid, name: getDisplayName(uid), avatar: u.avatar, type: 'private' });
  };
  openModal('modal-user-view');
}

// ════════════════════════════════════════════════════
//  SETTINGS
// ════════════════════════════════════════════════════
function renderSettings() {
  const body = $('settings-body');
  if (!body) return;
  const av = avatarHtml(myProfile?.avatar);
  body.innerHTML = `
    <div class="profile-section" id="settings-prof-section" style="cursor:pointer;">
      <div class="profile-av">${av}</div>
      <div class="profile-name">${esc(getDisplayName(me.uid))}</div>
      <div class="profile-uname">${esc(myProfile?.username || '')}</div>
    </div>

    <div class="settings-section">
      <div class="settings-label">Аккаунт</div>
      <div class="settings-item" id="s-profile"><div class="si-icon">👤</div><div class="si-text">Мой профиль</div><span class="si-arrow">›</span></div>
    </div>
    <div class="settings-section">
      <div class="settings-label">Создать</div>
      <div class="settings-item" id="s-new-grp"><div class="si-icon">👥</div><div class="si-text">Новая группа</div><span class="si-arrow">›</span></div>
      <div class="settings-item" id="s-new-ch"><div class="si-icon">📢</div><div class="si-text">Новый канал</div><span class="si-arrow">›</span></div>
    </div>
    <div class="settings-section">
      <div class="settings-label">Дополнительно</div>
      <div class="settings-item" id="s-support"><div class="si-icon">🛠️</div><div class="si-text">Техподдержка</div><span class="si-arrow">›</span></div>
      <div class="settings-item" id="s-about"><div class="si-icon">ℹ️</div><div class="si-text">О приложении</div><span class="si-arrow">›</span></div>
    </div>
    <div class="settings-section">
      <div class="settings-item" id="s-logout" style="color:var(--red);">
        <div class="si-icon">🚪</div><div class="si-text">Выйти</div>
      </div>
    </div>
    <div style="height:20px;"></div>
  `;
  $('settings-prof-section').onclick = openProfileModal;
  $('s-profile').onclick = openProfileModal;
  $('s-new-grp').onclick = () => { renderAvGrid('grp-av-grid', '👥', v => grpAvatar = v); openModal('modal-create-group'); };
  $('s-new-ch').onclick = () => { renderAvGrid('ch-av-grid', '📢', v => chAvatar = v); openModal('modal-create-channel'); };
  $('s-support').onclick = () => openModal('modal-support');
  $('s-about').onclick = () => openModal('modal-about');
  $('s-logout').onclick = () => { if (confirm('Выйти из аккаунта?')) signOut(auth); };
}

// Profile modal
function openProfileModal() {
  profAvatar = myProfile?.avatar || '😊';
  $('edit-prof-av').innerHTML = avatarHtml(profAvatar);
  $('edit-prof-name').textContent = getDisplayName(me.uid);
  $('edit-prof-uname').textContent = myProfile?.username || '';
  $('prof-first').value = myProfile?.firstName || '';
  $('prof-last').value = myProfile?.lastName || '';
  $('prof-email-info').textContent = `📧 ${me.email}${auth.currentUser?.emailVerified ? ' ✅' : ' ⚠️'}`;
  renderAvGrid('prof-av-grid', profAvatar, v => { profAvatar = v; $('edit-prof-av').innerHTML = avatarHtml(v); });
  openModal('modal-profile');
}
$('save-profile-btn').onclick = async () => {
  const fn = $('prof-first').value.trim();
  if (!fn) { showToast('Введите имя'); return; }
  const ln = $('prof-last').value.trim();
  await setDoc(doc(db, 'users', me.uid), { firstName: fn, lastName: ln, name: fn + (ln ? ' ' + ln : ''), avatar: profAvatar }, { merge: true });
  if (myProfile) { myProfile.firstName = fn; myProfile.lastName = ln; myProfile.name = fn + (ln ? ' ' + ln : ''); myProfile.avatar = profAvatar; }
  await refreshUsersCache(); await buildChatList();
  closeModal('modal-profile');
  renderSettings();
  showToast('✅ Профиль сохранён');
};

// Groups
$('create-grp-btn').onclick = async () => {
  const name = $('grp-name').value.trim(), un = $('grp-uname').value.trim();
  if (!name || !un) { showToast('Заполните все поля'); return; }
  if (!un.startsWith('@')) { showToast('Юзернейм должен начинаться с @'); return; }
  if (!(await getDocs(query(collection(db, 'rooms'), where('username', '==', un)))).empty) { showToast('Юзернейм занят'); return; }
  const r = await addDoc(collection(db, 'rooms'), { name, type: 'group', username: un, avatar: grpAvatar, members: [me.uid], admins: [me.uid], createdBy: me.uid, createdAt: serverTimestamp() });
  closeModal('modal-create-group');
  await refreshRoomsCache(); await buildChatList();
  const rd = roomsCache.get(r.id);
  openChat({ id: r.id, name, avatar: grpAvatar, type: 'group', roomData: rd });
};
$('create-ch-btn').onclick = async () => {
  const name = $('ch-name').value.trim(), un = $('ch-uname').value.trim();
  if (!name || !un) { showToast('Заполните все поля'); return; }
  if (!un.startsWith('@')) { showToast('Юзернейм должен начинаться с @'); return; }
  if (!(await getDocs(query(collection(db, 'rooms'), where('username', '==', un)))).empty) { showToast('Юзернейм занят'); return; }
  const r = await addDoc(collection(db, 'rooms'), { name, type: 'channel', username: un, avatar: chAvatar, members: [me.uid], admins: [me.uid], subscribers: [me.uid], createdBy: me.uid, createdAt: serverTimestamp() });
  closeModal('modal-create-channel');
  await refreshRoomsCache(); await buildChatList();
  const rd = roomsCache.get(r.id);
  openChat({ id: r.id, name, avatar: chAvatar, type: 'channel', roomData: rd });
};

// Support
$('sup-send-btn').onclick = async () => {
  const subj = $('sup-subj').value.trim(), msg = $('sup-msg').value.trim();
  if (!msg) { showToast('Напишите сообщение'); return; }
  await addDoc(collection(db, 'support_tickets'), { userUid: me?.uid, email: me?.email, subject: subj || 'Без темы', message: msg, status: 'new', createdAt: serverTimestamp() });
  closeModal('modal-support');
  showToast('✅ Обращение отправлено!');
};

// ════════════════════════════════════════════════════
//  MODALS HELPER
// ════════════════════════════════════════════════════
function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }
document.querySelectorAll('.modal-close').forEach(b => b.onclick = function () { this.closest('.modal-ov').classList.remove('open'); });
document.querySelectorAll('.modal-ov').forEach(o => o.onclick = e => { if (e.target === o) o.classList.remove('open'); });
// Swipe down to close modals
document.querySelectorAll('.modal-pill').forEach(pill => {
  const sheet = pill.closest('.modal-sheet');
  const ov = sheet?.closest('.modal-ov');
  if (!sheet || !ov) return;
  let startY = 0;
  pill.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
  pill.addEventListener('touchend', e => { if (e.changedTouches[0].clientY - startY > 60) ov.classList.remove('open'); });
});

// ════════════════════════════════════════════════════
//  KEYBOARD — поднятие поля ввода
// ════════════════════════════════════════════════════
function scrollInputIntoView() {
  setTimeout(() => {
    const bar = $('input-bar');
    if (bar) bar.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, 80);
}

$('msg-input').addEventListener('focus', scrollInputIntoView);

if (window.visualViewport) {
  let prevH = window.visualViewport.height;
  window.visualViewport.addEventListener('resize', () => {
    if (window.visualViewport.height < prevH && document.activeElement === $('msg-input')) {
      scrollInputIntoView();
    }
    prevH = window.visualViewport.height;
  });
}

// ════════════════════════════════════════════════════
//  HEARTBEAT
// ════════════════════════════════════════════════════
let heartbeat;
function startHeartbeat() {
  if (me) updateDoc(doc(db, 'users', me.uid), { online: true, lastSeen: serverTimestamp() }).catch(() => {});
  heartbeat = setInterval(() => { if (me) updateDoc(doc(db, 'users', me.uid), { online: true, lastSeen: serverTimestamp() }).catch(() => {}); }, 30000);
}
function stopHeartbeat() { clearInterval(heartbeat); }
window.addEventListener('beforeunload', () => { if (me) updateDoc(doc(db, 'users', me.uid), { online: false }).catch(() => {}); });

// ════════════════════════════════════════════════════
//  STOP SUBS
// ════════════════════════════════════════════════════
function stopAllSubs() {
  if (unsubMsgs) { unsubMsgs(); unsubMsgs = null; }
  if (unsubTyping) { unsubTyping(); unsubTyping = null; }
}

// ════════════════════════════════════════════════════
//  NETWORK
// ════════════════════════════════════════════════════
let wasOnline = navigator.onLine;
window.addEventListener('offline', () => { $('net-banner').classList.add('show'); wasOnline = false; });
window.addEventListener('online', () => {
  if (!wasOnline) {
    $('net-banner').style.background = 'var(--green)';
    $('net-banner').textContent = '✅ Соединение восстановлено';
    setTimeout(() => { $('net-banner').classList.remove('show'); $('net-banner').style.background = 'var(--red)'; $('net-banner').textContent = '⚠️ Нет соединения'; }, 2500);
  }
  wasOnline = true;
});
// ============================================================
//  ДОБАВЛЕНИЕ ОТСУТСТВУЮЩИХ ФУНКЦИЙ (ГОЛОС, СТИКЕРЫ, ПЛЕЕР, ПРОФИЛЬ, КЛАВИАТУРА, E2EE)
// ============================================================

(function() {
  "use strict";

  // ---------- 1. ДОБАВЛЯЕМ CSS ДЛЯ НОВЫХ ЭЛЕМЕНТОВ ----------
  const style = document.createElement('style');
  style.textContent = `
    /* Кнопки в input bar */
    #voice-btn, #sticker-btn {
      width: 32px; height: 32px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; color: var(--text-secondary);
      flex-shrink: 0; transition: var(--transition);
    }
    #voice-btn:active, #sticker-btn:active {
      background: var(--accent-light); color: var(--accent);
    }
    #voice-btn.recording {
      background: var(--red); color: white; animation: pulse 1s infinite;
    }
    @keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.2); } 100% { transform: scale(1); } }

    /* Индикатор записи */
    #voice-indicator {
      position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%);
      background: rgba(0,0,0,0.8); color: white; padding: 12px 24px;
      border-radius: 40px; font-size: 14px; font-weight: 600;
      display: none; align-items: center; gap: 12px; z-index: 999;
    }
    #voice-indicator.show { display: flex; }
    #voice-indicator .timer { font-size: 18px; min-width: 40px; text-align: center; }
    #voice-indicator .mic-icon { font-size: 24px; color: var(--red); animation: pulse 1s infinite; }

    /* Панель предпрослушивания голоса */
    #voice-preview {
      display: none; padding: 8px 12px; background: white;
      border-top: 1px solid var(--border); flex-shrink: 0;
      align-items: center; gap: 12px;
    }
    #voice-preview.show { display: flex; }
    #voice-preview .vp-player { flex: 1; display: flex; align-items: center; gap: 8px; }
    #voice-preview .vp-player audio { display: none; }
    #voice-preview .vp-controls { display: flex; align-items: center; gap: 6px; }
    #voice-preview .vp-play-btn { font-size: 20px; cursor: pointer; }
    #voice-preview .vp-progress { flex: 1; height: 4px; background: var(--border); border-radius: 2px; cursor: pointer; position: relative; }
    #voice-preview .vp-progress-fill { height: 100%; background: var(--accent); border-radius: 2px; width: 0%; }
    #voice-preview .vp-time { font-size: 12px; color: var(--text-secondary); min-width: 36px; text-align: center; }
    #voice-preview .vp-actions { display: flex; gap: 6px; }
    #voice-preview .vp-actions button { padding: 4px 12px; border-radius: 8px; font-size: 13px; font-weight: 600; }
    #voice-preview .vp-send-btn { background: var(--accent); color: white; }
    #voice-preview .vp-del-btn { background: var(--bg-secondary); color: var(--text-secondary); }

    /* Панель стикеров */
    #sticker-panel {
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 200;
      background: white; border-top: 1px solid var(--border);
      border-radius: 20px 20px 0 0; padding: 14px 16px 24px;
      max-height: 50vh; overflow-y: auto;
      transform: translateY(100%); transition: transform 0.28s cubic-bezier(0.4,0,0.2,1);
      box-shadow: 0 -4px 24px rgba(0,0,0,0.10);
    }
    #sticker-panel.show { transform: translateY(0); }
    #sticker-panel .sp-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    #sticker-panel .sp-header h4 { font-size: 16px; font-weight: 600; }
    #sticker-panel .sp-header button { background: var(--accent-light); color: var(--accent); padding: 4px 12px; border-radius: 8px; font-size: 13px; font-weight: 500; }
    #sticker-panel .sp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(60px,1fr)); gap: 8px; }
    #sticker-panel .sp-item { position: relative; aspect-ratio: 1; border-radius: 8px; background: var(--bg-secondary); display: flex; align-items: center; justify-content: center; cursor: pointer; overflow: hidden; }
    #sticker-panel .sp-item img { width: 100%; height: 100%; object-fit: contain; }
    #sticker-panel .sp-item .sp-del { position: absolute; top: 2px; right: 2px; background: rgba(0,0,0,0.6); color: white; border-radius: 50%; width: 20px; height: 20px; font-size: 12px; display: flex; align-items: center; justify-content: center; cursor: pointer; opacity: 0; transition: opacity 0.2s; }
    #sticker-panel .sp-item:hover .sp-del, #sticker-panel .sp-item:active .sp-del { opacity: 1; }
    #sticker-panel .sp-empty { color: var(--text-hint); text-align: center; padding: 20px; font-size: 14px; }

    /* Кастомный плеер для голосовых в ленте */
    .voice-player {
      display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.2);
      padding: 4px 8px; border-radius: 20px; min-width: 150px;
    }
    .voice-player .vp-play { font-size: 20px; cursor: pointer; }
    .voice-player .vp-progress { flex: 1; height: 3px; background: rgba(255,255,255,0.3); border-radius: 2px; cursor: pointer; position: relative; min-width: 40px; }
    .voice-player .vp-progress-fill { height: 100%; background: white; border-radius: 2px; width: 0%; }
    .voice-player .vp-time { font-size: 10px; opacity: 0.8; min-width: 28px; text-align: center; }
    .msg-group.in .voice-player { background: var(--accent-light); }
    .msg-group.in .voice-player .vp-progress { background: rgba(0,0,0,0.15); }
    .msg-group.in .voice-player .vp-progress-fill { background: var(--accent); }

    /* Шапка чата — аватар кликабельный */
    #chat-hdr-av { cursor: pointer; }
    #chat-hdr-av:active { opacity: 0.7; }
  `;
  document.head.appendChild(style);

  // ---------- 2. ДОБАВЛЯЕМ КНОПКИ В INPUT BAR ----------
  const inputWrap = document.querySelector('#input-bar .input-wrap');
  if (inputWrap) {
    const voiceBtn = document.createElement('button');
    voiceBtn.id = 'voice-btn';
    voiceBtn.className = 'ib-btn';
    voiceBtn.textContent = '🎙️';
    voiceBtn.title = 'Голосовое сообщение';
    inputWrap.insertBefore(voiceBtn, document.getElementById('emoji-btn'));

    const stickerBtn = document.createElement('button');
    stickerBtn.id = 'sticker-btn';
    stickerBtn.className = 'ib-btn';
    stickerBtn.textContent = '🎨';
    stickerBtn.title = 'Стикеры';
    inputWrap.insertBefore(stickerBtn, document.getElementById('emoji-btn'));
  }

  // ---------- 3. ДОБАВЛЯЕМ ИНДИКАТОР ЗАПИСИ И ПАНЕЛЬ ПРЕДПРОСЛУШИВАНИЯ ----------
  const voiceIndicator = document.createElement('div');
  voiceIndicator.id = 'voice-indicator';
  voiceIndicator.innerHTML = `
    <span class="mic-icon">🎙️</span>
    <span class="timer">00:00</span>
    <span style="font-size:13px;">Запись...</span>
  `;
  document.body.appendChild(voiceIndicator);

  const voicePreview = document.createElement('div');
  voicePreview.id = 'voice-preview';
  voicePreview.innerHTML = `
    <div class="vp-player">
      <audio id="vp-audio"></audio>
      <div class="vp-controls">
        <span class="vp-play-btn" id="vp-play">▶️</span>
        <div class="vp-progress" id="vp-progress">
          <div class="vp-progress-fill" id="vp-progress-fill"></div>
        </div>
        <span class="vp-time" id="vp-time">0:00</span>
      </div>
    </div>
    <div class="vp-actions">
      <button class="vp-send-btn" id="vp-send">Отправить</button>
      <button class="vp-del-btn" id="vp-del">✕</button>
    </div>
  `;
  const inputBar = document.getElementById('input-bar');
  inputBar.parentNode.insertBefore(voicePreview, inputBar);

  // ---------- 4. ДОБАВЛЯЕМ ПАНЕЛЬ СТИКЕРОВ ----------
  const stickerPanel = document.createElement('div');
  stickerPanel.id = 'sticker-panel';
  stickerPanel.innerHTML = `
    <div class="sp-header">
      <h4>🎨 Стикеры</h4>
      <button id="sp-upload">Загрузить</button>
    </div>
    <div class="sp-grid" id="sp-grid"></div>
    <div class="sp-empty" id="sp-empty">Нет стикеров. Загрузите свои!</div>
  `;
  document.body.appendChild(stickerPanel);

  // Скрываем панель по клику вне её
  const stickerDim = document.createElement('div');
  stickerDim.id = 'sticker-dim';
  stickerDim.style.cssText = 'position:fixed;inset:0;z-index:199;display:none;';
  document.body.appendChild(stickerDim);

  // ---------- 5. ПЕРЕМЕННЫЕ ДЛЯ ГОЛОСА И СТИКЕРОВ ----------
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingTimer = null;
  let recordingStart = 0;
  let voiceBlobURL = null;

  // ---------- 6. ЛОГИКА ГОЛОСОВЫХ СООБЩЕНИЙ ----------
  const voiceBtn = document.getElementById('voice-btn');
  const indicator = document.getElementById('voice-indicator');
  const timerEl = indicator.querySelector('.timer');
  const preview = document.getElementById('voice-preview');
  const vpAudio = document.getElementById('vp-audio');
  const vpPlay = document.getElementById('vp-play');
  const vpProgress = document.getElementById('vp-progress');
  const vpProgressFill = document.getElementById('vp-progress-fill');
  const vpTime = document.getElementById('vp-time');
  const vpSend = document.getElementById('vp-send');
  const vpDel = document.getElementById('vp-del');

  // Запись голоса
  let touchId = null; // для идентификации касания

  voiceBtn.addEventListener('touchstart', async (e) => {
    e.preventDefault();
    if (mediaRecorder && mediaRecorder.state === 'recording') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunks.push(ev.data);
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        if (blob.size > 0) {
          voiceBlobURL = URL.createObjectURL(blob);
          vpAudio.src = voiceBlobURL;
          preview.classList.add('show');
          // Сброс плеера
          vpPlay.textContent = '▶️';
          vpProgressFill.style.width = '0%';
          vpTime.textContent = '0:00';
          vpAudio.load();
        } else {
          showToast('Запись слишком короткая');
        }
        stream.getTracks().forEach(t => t.stop());
        voiceBtn.classList.remove('recording');
        indicator.classList.remove('show');
        clearInterval(recordingTimer);
      };
      mediaRecorder.start();
      recordingStart = Date.now();
      voiceBtn.classList.add('recording');
      indicator.classList.add('show');
      timerEl.textContent = '00:00';
      recordingTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStart) / 1000);
        if (elapsed >= 60) {
          mediaRecorder.stop();
          return;
        }
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        timerEl.textContent = `${mins}:${secs}`;
      }, 100);
    } catch (err) {
      showToast('❌ Нет доступа к микрофону');
      console.error(err);
    }
  });

  voiceBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
  });

  // Плеер предпрослушивания
  let isPlaying = false;
  vpPlay.addEventListener('click', () => {
    if (vpAudio.paused) {
      vpAudio.play();
      vpPlay.textContent = '⏸️';
      isPlaying = true;
    } else {
      vpAudio.pause();
      vpPlay.textContent = '▶️';
      isPlaying = false;
    }
  });

  vpAudio.addEventListener('timeupdate', () => {
    const pct = (vpAudio.currentTime / vpAudio.duration) * 100;
    vpProgressFill.style.width = `${isNaN(pct) ? 0 : pct}%`;
    const m = Math.floor(vpAudio.currentTime / 60);
    const s = Math.floor(vpAudio.currentTime % 60);
    vpTime.textContent = `${m}:${String(s).padStart(2,'0')}`;
  });

  vpAudio.addEventListener('ended', () => {
    vpPlay.textContent = '▶️';
    isPlaying = false;
    vpProgressFill.style.width = '0%';
    vpTime.textContent = '0:00';
  });

  vpProgress.addEventListener('click', (e) => {
    const rect = vpProgress.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    if (vpAudio.duration) {
      vpAudio.currentTime = pct * vpAudio.duration;
    }
  });

  // Отправить голосовое
  vpSend.addEventListener('click', async () => {
    if (!voiceBlobURL) return;
    if (!activeChat || !me) { showToast('Нет активного чата'); return; }
    const chatId = await getActiveChatId();
    if (!chatId) return;
    // Конвертируем blob в dataURL (для хранения в Firestore)
    const resp = await fetch(voiceBlobURL);
    const blob = await resp.blob();
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = async () => {
      const dataURL = reader.result;
      await addDoc(collection(db, 'messages'), {
        chatId,
        text: `[voice]${dataURL}`,
        timestamp: serverTimestamp(),
        senderUid: me.uid,
        isVoice: true,
        isSticker: false
      });
      showToast('🎙️ Голосовое отправлено');
      preview.classList.remove('show');
      URL.revokeObjectURL(voiceBlobURL);
      voiceBlobURL = null;
      vpAudio.src = '';
    };
  });

  // Удалить голосовое
  vpDel.addEventListener('click', () => {
    preview.classList.remove('show');
    if (voiceBlobURL) {
      URL.revokeObjectURL(voiceBlobURL);
      voiceBlobURL = null;
    }
    vpAudio.src = '';
    showToast('Запись удалена');
  });

  // ---------- 7. ЛОГИКА СТИКЕРОВ ----------
  const stickerBtn = document.getElementById('sticker-btn');
  const stickerPanelEl = document.getElementById('sticker-panel');
  const stickerGrid = document.getElementById('sp-grid');
  const stickerEmpty = document.getElementById('sp-empty');
  const stickerUpload = document.getElementById('sp-upload');
  let stickerFileInput = null;

  // Загрузка стикеров из localStorage
  function loadStickers() {
    if (!me) return;
    const key = `nx_stickers_${me.uid}`;
    let stickers = [];
    try {
      const data = localStorage.getItem(key);
      if (data) stickers = JSON.parse(data);
    } catch {}
    return stickers;
  }

  function saveStickers(stickers) {
    if (!me) return;
    const key = `nx_stickers_${me.uid}`;
    localStorage.setItem(key, JSON.stringify(stickers));
  }

  function renderStickers() {
    const stickers = loadStickers();
    if (!stickers || stickers.length === 0) {
      stickerGrid.innerHTML = '';
      stickerEmpty.style.display = 'block';
      return;
    }
    stickerEmpty.style.display = 'none';
    stickerGrid.innerHTML = stickers.map((url, idx) => `
      <div class="sp-item" data-idx="${idx}">
        <img src="${url}" alt="sticker" loading="lazy">
        <span class="sp-del" data-idx="${idx}">✕</span>
      </div>
    `).join('');
    // Обработка удаления
    stickerGrid.querySelectorAll('.sp-del').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(el.dataset.idx);
        let stickers = loadStickers();
        if (stickers && idx >= 0 && idx < stickers.length) {
          stickers.splice(idx, 1);
          saveStickers(stickers);
          renderStickers();
        }
      });
    });
    // Отправка стикера по клику
    stickerGrid.querySelectorAll('.sp-item').forEach(el => {
      el.addEventListener('click', async () => {
        const idx = parseInt(el.dataset.idx);
        let stickers = loadStickers();
        if (stickers && idx >= 0 && idx < stickers.length) {
          const url = stickers[idx];
          if (!activeChat || !me) { showToast('Нет активного чата'); return; }
          const chatId = await getActiveChatId();
          if (!chatId) return;
          await addDoc(collection(db, 'messages'), {
            chatId,
            text: `[sticker]${url}`,
            timestamp: serverTimestamp(),
            senderUid: me.uid,
            isSticker: true,
            isVoice: false
          });
          showToast('🎨 Стикер отправлен');
          closeStickerPanel();
        }
      });
    });
  }

  function openStickerPanel() {
    stickerPanelEl.classList.add('show');
    stickerDim.style.display = 'block';
    renderStickers();
  }

  function closeStickerPanel() {
    stickerPanelEl.classList.remove('show');
    stickerDim.style.display = 'none';
  }

  stickerBtn.addEventListener('click', () => {
    if (stickerPanelEl.classList.contains('show')) {
      closeStickerPanel();
    } else {
      openStickerPanel();
    }
  });

  stickerDim.addEventListener('click', closeStickerPanel);

  // Загрузка нового стикера
  stickerUpload.addEventListener('click', () => {
    if (!stickerFileInput) {
      stickerFileInput = document.createElement('input');
      stickerFileInput.type = 'file';
      stickerFileInput.accept = 'image/gif,image/png,image/jpeg';
      stickerFileInput.style.display = 'none';
      document.body.appendChild(stickerFileInput);
      stickerFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { showToast('Максимум 5 МБ'); return; }
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onloadend = () => {
          const dataURL = reader.result;
          let stickers = loadStickers();
          if (!stickers) stickers = [];
          stickers.push(dataURL);
          saveStickers(stickers);
          renderStickers();
          showToast('✅ Стикер загружен');
          stickerFileInput.value = '';
        };
      });
    }
    stickerFileInput.click();
  });

  // ---------- 8. КАСТОМНЫЙ ПЛЕЕР ДЛЯ ГОЛОСОВЫХ В ЛЕНТЕ ----------
  // Переопределим renderMessages, чтобы заменить стандартный аудио на кастомный
  const originalRenderMessages = window.renderMessages || renderMessages;
  window.renderMessages = function() {
    // Вызываем оригинальный рендеринг
    if (typeof originalRenderMessages === 'function') {
      originalRenderMessages.call(this);
    }
    // Затем заменяем все <audio> внутри сообщений с isVoice на кастомные плееры
    document.querySelectorAll('.bubble .bubble-text audio').forEach(audio => {
      const parent = audio.closest('.bubble-text');
      if (!parent) return;
      // Проверяем, есть ли у сообщения isVoice (можно проверить по наличию атрибута или по данным)
      // Но мы можем заменить все аудио, которые не являются обычными (их src начинается с data:)
      const src = audio.src;
      if (src && src.startsWith('data:audio/webm')) {
        // Создаём кастомный плеер
        const container = document.createElement('div');
        container.className = 'voice-player';
        container.innerHTML = `
          <span class="vp-play">▶️</span>
          <div class="vp-progress"><div class="vp-progress-fill" style="width:0%"></div></div>
          <span class="vp-time">0:00</span>
        `;
        // Скрываем оригинальный audio
        audio.style.display = 'none';
        // Вставляем кастомный плеер вместо audio
        parent.insertBefore(container, audio);
        // Добавляем логику
        const playBtn = container.querySelector('.vp-play');
        const progress = container.querySelector('.vp-progress');
        const progressFill = container.querySelector('.vp-progress-fill');
        const timeEl = container.querySelector('.vp-time');
        let isPlaying = false;
        playBtn.addEventListener('click', () => {
          if (audio.paused) {
            audio.play();
            playBtn.textContent = '⏸️';
            isPlaying = true;
          } else {
            audio.pause();
            playBtn.textContent = '▶️';
            isPlaying = false;
          }
        });
        audio.addEventListener('timeupdate', () => {
          const pct = (audio.currentTime / audio.duration) * 100;
          progressFill.style.width = `${isNaN(pct) ? 0 : pct}%`;
          const m = Math.floor(audio.currentTime / 60);
          const s = Math.floor(audio.currentTime % 60);
          timeEl.textContent = `${m}:${String(s).padStart(2,'0')}`;
        });
        audio.addEventListener('ended', () => {
          playBtn.textContent = '▶️';
          isPlaying = false;
          progressFill.style.width = '0%';
          timeEl.textContent = '0:00';
        });
        progress.addEventListener('click', (e) => {
          const rect = progress.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          if (audio.duration) {
            audio.currentTime = pct * audio.duration;
          }
        });
      }
    });
  };

  // ---------- 9. ПРОСМОТР ПРОФИЛЯ ПО КЛИКУ НА АВАТАР В ШАПКЕ ----------
  const hdrAv = document.getElementById('chat-hdr-av');
  if (hdrAv) {
    hdrAv.addEventListener('click', () => {
      if (!activeChat || !me) return;
      if (activeChat.type === 'private') {
        const uid = activeChat.id;
        openUserView(uid);
      } else if (activeChat.type === 'group' || activeChat.type === 'channel') {
        // Для групп/каналов можно показать информацию, но по заданию только для собеседника
        showToast('👥 Информация о группе/канале');
      } else {
        showToast('Это вы');
      }
    });
  }

  // ---------- 10. УЛУЧШЕННОЕ ПОДНЯТИЕ КЛАВИАТУРЫ ----------
  // Уже есть scrollInputIntoView, но добавим дополнительные вызовы
  const origScroll = window.scrollInputIntoView;
  window.scrollInputIntoView = function() {
    // Вызываем оригинал (если есть) или делаем свою версию
    if (typeof origScroll === 'function') origScroll();
    setTimeout(() => {
      const bar = document.getElementById('input-bar');
      if (bar) bar.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 150);
  };

  // Также при открытии чата, если поле в фокусе
  const origOpenChat = window.openChat;
  window.openChat = async function(chat) {
    if (typeof origOpenChat === 'function') {
      await origOpenChat.call(this, chat);
    }
    // После открытия чата, если поле в фокусе, прокручиваем
    setTimeout(() => {
      const input = document.getElementById('msg-input');
      if (document.activeElement === input) {
        scrollInputIntoView();
      }
    }, 300);
  };

  // ---------- 11. E2EE ШИФРОВАНИЕ ----------
  // Для приватных чатов используем ECDH + AES-GCM

  // Генерация ключей
  async function generateE2EEKeys() {
    // Генерируем пару ECDH (P-256)
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );
    const publicKey = await crypto.subtle.exportKey('spki', keyPair.publicKey);
    const privateKey = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
    return {
      publicKeyBase64: btoa(String.fromCharCode(...new Uint8Array(publicKey))),
      privateKeyBase64: btoa(String.fromCharCode(...new Uint8Array(privateKey))),
      publicKeyRaw: publicKey,
      privateKeyRaw: privateKey,
      keyPair
    };
  }

  // Импорт публичного ключа
  async function importPublicKey(base64) {
    const buf = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    return await crypto.subtle.importKey('spki', buf, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  }

  // Импорт приватного ключа
  async function importPrivateKey(base64) {
    const buf = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    return await crypto.subtle.importKey('pkcs8', buf, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
  }

  // Получение общего секрета (AES-GCM ключ)
  async function deriveSharedKey(privateKey, publicKey) {
    const sharedSecret = await crypto.subtle.deriveKey(
      { name: 'ECDH', public: publicKey },
      privateKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    return sharedSecret;
  }

  // Шифрование
  async function encryptText(text, sharedKey) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      sharedKey,
      data
    );
    // Возвращаем iv + encrypted в base64
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...combined));
  }

  // Расшифровка
  async function decryptText(encryptedBase64, sharedKey) {
    const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      sharedKey,
      encrypted
    );
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  }

  // Инициализация E2EE для пользователя
  async function initE2EE() {
    if (!me) return;
    // Проверяем наличие приватного ключа в localStorage
    const privKeyBase64 = localStorage.getItem(`nx_private_${me.uid}`);
    if (!privKeyBase64) {
      // Генерируем новую пару
      const keys = await generateE2EEKeys();
      // Сохраняем приватный ключ в localStorage
      localStorage.setItem(`nx_private_${me.uid}`, keys.privateKeyBase64);
      // Сохраняем публичный ключ в Firestore
      await setDoc(doc(db, 'users', me.uid), { publicKey: keys.publicKeyBase64 }, { merge: true });
      showToast('🔐 Ключи шифрования созданы');
    } else {
      // Проверим, есть ли публичный ключ в Firestore
      const userDoc = await getDoc(doc(db, 'users', me.uid));
      if (userDoc.exists() && !userDoc.data().publicKey) {
        // Если нет, генерируем заново и сохраняем
        const keys = await generateE2EEKeys();
        localStorage.setItem(`nx_private_${me.uid}`, keys.privateKeyBase64);
        await setDoc(doc(db, 'users', me.uid), { publicKey: keys.publicKeyBase64 }, { merge: true });
        showToast('🔐 Публичный ключ обновлён');
      }
    }
  }

  // Вызываем инициализацию при входе
  const origAuthListener = window.onAuthStateChanged;
  // Нам нужно добавить инициализацию после входа
  // Переопределим onAuthStateChanged? Лучше добавить свой обработчик после того, как пользователь залогинился.
  // Текущий код уже вызывает onAuthStateChanged. Мы можем добавить дополнительную проверку.
  // Поскольку мы не можем переопределить, мы можем использовать MutationObserver или просто периодически проверять.
  // Но проще: мы можем обернуть существующий onAuthStateChanged? Нет, он уже установлен.
  // Вместо этого мы можем добавить свой обработчик через setTimeout после загрузки.
  // Также можно использовать событие, но проще всего добавить в конец функции, которая вызывается при успешном входе.
  // Но мы не можем изменить её. Поэтому будем проверять при каждом изменении activeChat? Нет.
  // Просто запустим инициализацию при загрузке страницы и при каждом входе через таймер.
  // Лучше добавить слушатель на authStateChanged, но он уже есть. Мы можем добавить свой с помощью auth.onAuthStateChanged,
  // но он заменит существующий? Нет, можно добавить несколько.
  // Однако, текущий код использует onAuthStateChanged для основной логики. Мы можем добавить свой, но он будет конфликтовать.
  // Лучше после загрузки, если пользователь уже вошёл, вызвать initE2EE.
  // Проверим: если me не null, то инициализируем.
  if (me) {
    initE2EE();
  } else {
    // Ждём, пока пользователь войдёт
    const checkAuth = setInterval(() => {
      if (me) {
        initE2EE();
        clearInterval(checkAuth);
      }
    }, 1000);
  }

  // Переопределим отправку сообщения для шифрования в приватных чатах
  const originalSendMessage = window.sendMessage || sendMessage;
  window.sendMessage = async function() {
    if (!me || !activeChat) return;
    const input = document.getElementById('msg-input');
    let text = input.value.trim();
    if (!text) return;

    // Если чат приватный и не является избранным/группой/каналом
    if (activeChat.type === 'private') {
      // Получаем публичный ключ собеседника
      const otherUid = activeChat.id;
      const userDoc = await getDoc(doc(db, 'users', otherUid));
      if (!userDoc.exists() || !userDoc.data().publicKey) {
        showToast('⚠️ У собеседника нет ключей шифрования');
        return;
      }
      const theirPublicKeyBase64 = userDoc.data().publicKey;
      // Импортируем их публичный ключ
      const theirPublicKey = await importPublicKey(theirPublicKeyBase64);
      // Импортируем свой приватный ключ
      const myPrivateKeyBase64 = localStorage.getItem(`nx_private_${me.uid}`);
      if (!myPrivateKeyBase64) {
        showToast('⚠️ У вас нет приватного ключа. Перезайдите.');
        return;
      }
      const myPrivateKey = await importPrivateKey(myPrivateKeyBase64);
      // Вычисляем общий секрет
      const sharedKey = await deriveSharedKey(myPrivateKey, theirPublicKey);
      // Шифруем текст
      const encrypted = await encryptText(text, sharedKey);
      // Заменяем текст на зашифрованный
      text = encrypted;
      // Отправляем с пометкой isEncrypted
      const chatId = await getActiveChatId();
      if (!chatId) return;
      await addDoc(collection(db, 'messages'), {
        chatId,
        text: text,
        timestamp: serverTimestamp(),
        senderUid: me.uid,
        isEncrypted: true,
        isSticker: false,
        isVoice: false
      });
      input.value = '';
      autoResize();
      clearTyping();
      showToast('🔒 Сообщение зашифровано');
      return;
    }

    // Для остальных чатов используем оригинальную отправку
    if (typeof originalSendMessage === 'function') {
      await originalSendMessage.call(this);
    }
  };

  // Также нужно расшифровывать сообщения при рендеринге
  // Переопределим renderMessages, чтобы расшифровывать isEncrypted сообщения
  // Мы уже переопределили renderMessages для плеера, теперь добавим расшифровку
  const originalRenderMessages2 = window.renderMessages || renderMessages;
  window.renderMessages = function() {
    if (typeof originalRenderMessages2 === 'function') {
      originalRenderMessages2.call(this);
    }
    // Теперь расшифровываем сообщения, которые помечены isEncrypted
    // Но расшифровка должна происходить до вставки в DOM.
    // Поскольку мы не можем перехватить данные до рендеринга, мы можем после рендеринга найти зашифрованные сообщения и заменить их текст.
    // Однако, лучше расшифровывать до рендеринга, но проще сделать после.
    // Но тогда текст уже вставлен как есть. Мы можем перебрать все сообщения в allMessages и расшифровать их перед рендерингом.
    // Но мы не можем изменить allMessages напрямую, потому что это массив с данными.
    // Мы можем перехватить процесс рендеринга, но это сложно.
    // Поскольку we уже переопределили renderMessages, мы можем внутри него сначала расшифровать сообщения.
    // Но оригинальный renderMessages уже вызывает рендеринг на основе allMessages.
    // Значит, мы должны изменить allMessages перед вызовом оригинального рендеринга.
    // Но мы не можем изменить allMessages, т.к. это глобальная переменная, но мы можем изменить её содержимое.
    // Однако, это может повлиять на другие части. Лучше сделать копию и использовать её.
    // Решение: переопределим renderMessages, чтобы он сначала расшифровывал сообщения, если это приватный чат, а затем вызывал оригинальный рендеринг.
    // Но оригинальный рендеринг использует allMessages, а не переданный массив.
    // Значит, мы должны расшифровать сообщения в allMessages на месте, но потом восстановить? Это некрасиво.
    // Альтернатива: мы можем не переопределять renderMessages полностью, а добавить шаг расшифровки до вызова оригинального.
    // Поскольку мы уже переопределили renderMessages, мы можем переписать его полностью, вызывая оригинальный после расшифровки.
    // Но оригинальный рендеринг может быть сложным.
    // Вместо этого, мы можем добавить обработчик после рендеринга, который найдёт все элементы с isEncrypted и заменит их текст.
    // Но как определить, что сообщение зашифровано? У нас есть allMessages, но в DOM нет метки isEncrypted.
    // Мы можем добавить data-атрибут при рендеринге, но оригинальный рендеринг этого не делает.
    // Значит, нужно модифицировать сам процесс рендеринга.
    // Проще переопределить renderMessages полностью, используя оригинальный код, но с добавлением расшифровки.
    // Поскольку оригинальный код рендеринга довольно большой, мы можем не копировать его, а вызвать его после расшифровки allMessages.
    // Но чтобы не портить allMessages, мы можем создать копию массива и передать в функцию рендеринга, но оригинальная функция не принимает аргументы.
    // Значит, нужно переписать renderMessages полностью.
    // Однако, это может быть рискованно. Я предлагаю другой подход: добавить шаг расшифровки в onSnapshot, когда приходят сообщения.
    // В текущем коде onSnapshot для messages добавляет сообщения в allMessages. Мы можем перехватить это и расшифровать при добавлении.
    // Но onSnapshot уже установлен в loadMessages. Мы можем переопределить loadMessages, чтобы добавить расшифровку.
    // Но loadMessages уже есть. Переопределим.
    // Итак, переопределим loadMessages, чтобы при получении снапшота мы расшифровывали сообщения.
    // Это лучше, потому что данные будут расшифрованы один раз и храниться в allMessages уже в открытом виде.
    // Реализуем.
  };

  // Переопределим loadMessages, чтобы расшифровывать сообщения в приватных чатах
  const originalLoadMessages = window.loadMessages || loadMessages;
  window.loadMessages = async function() {
    if (!activeChat || !me) return;
    const chatId = await getActiveChatId();
    if (!chatId) return;
    // Если это приватный чат, то будем расшифровывать
    const isPrivate = activeChat.type === 'private';
    // Сохраняем оригинальный unsubMsgs, чтобы не переопределить его
    // Мы будем использовать свой onSnapshot
    // Но оригинальный loadMessages уже устанавливает unsubMsgs. Мы можем переопределить его.
    // Отпишемся от старого, если есть
    if (unsubMsgs) { unsubMsgs(); unsubMsgs = null; }
    // Создаём свой onSnapshot
    unsubMsgs = onSnapshot(
      query(collection(db, 'messages'), where('chatId', '==', chatId)),
      async snap => {
        const msgs = snap.docs.map(d => ({ id: d.id, ...d.data(), _pending: d.metadata.hasPendingWrites }));
        if (isPrivate) {
          // Получаем ключи
          const myPrivKeyBase64 = localStorage.getItem(`nx_private_${me.uid}`);
          if (myPrivKeyBase64) {
            const otherUid = activeChat.id;
            const userDoc = await getDoc(doc(db, 'users', otherUid));
            if (userDoc.exists() && userDoc.data().publicKey) {
              const theirPublicKeyBase64 = userDoc.data().publicKey;
              const theirPublicKey = await importPublicKey(theirPublicKeyBase64);
              const myPrivateKey = await importPrivateKey(myPrivKeyBase64);
              const sharedKey = await deriveSharedKey(myPrivateKey, theirPublicKey);
              // Расшифровываем каждое сообщение, помеченное isEncrypted
              for (const msg of msgs) {
                if (msg.isEncrypted && msg.text) {
                  try {
                    const decrypted = await decryptText(msg.text, sharedKey);
                    msg.text = decrypted;
                    msg.isEncrypted = false; // помечаем как расшифрованное
                  } catch (e) {
                    console.warn('Ошибка расшифровки', e);
                    msg.text = '🔐 [Ошибка расшифровки]';
                  }
                }
              }
            }
          }
        }
        // Сохраняем в allMessages
        allMessages = msgs.sort((a,b) => (a.timestamp?.toMillis?.() || 0) - (b.timestamp?.toMillis?.() || 0));
        const loader = document.getElementById('msg-loader');
        if (loader) loader.remove();
        // Вызываем рендеринг
        renderMessages();
        scrollToBottom();
      }
    );
  };

  // Также при отправке мы уже переопределили sendMessage для шифрования, но нужно также шифровать для приватных чатов.
  // Мы уже сделали это в переопределённой sendMessage.

  // ---------- 12. ДОПОЛНИТЕЛЬНЫЕ УЛУЧШЕНИЯ ----------
  // При клике на аватар в шапке уже добавили.

  // Убедимся, что при открытии чата клавиатура поднимается, если поле в фокусе (уже есть).

  // Инициализация стикеров при загрузке
  if (me) {
    renderStickers();
  }

})();
// ════════════════════════════════════════════════════
//  ШАПКА ПРОФИЛЯ СОБЕСЕДНИКА (название + описание)
// ════════════════════════════════════════════════════

// Функция обновления шапки чата: показывает имя и bio собеседника
async function updateChatHeaderWithProfile() {
  if (!activeChat || !me) return;

  const nameEl = document.getElementById('chat-hdr-name');
  const statusEl = document.getElementById('chat-hdr-status');
  if (!nameEl || !statusEl) return;

  // ── Приватный чат ──
  if (activeChat.type === 'private') {
    const user = usersCache.get(activeChat.id);
    if (user) {
      // Имя (уже установлено, но перезапишем для надёжности)
      nameEl.textContent = getDisplayName(activeChat.id);
      // Описание: берём bio, status или оставляем «в сети»
      const bio = user.bio || user.status || '';
      if (bio) {
        statusEl.textContent = bio;
        statusEl.className = 'hdr-status';
      } else {
        statusEl.textContent = 'в сети';
        statusEl.className = 'hdr-status online';
      }
    }
  }

  // ── Группа / канал ──
  else if (activeChat.type === 'group' || activeChat.type === 'channel') {
    nameEl.textContent = activeChat.name;
    const desc = activeChat.roomData?.description || '';
    statusEl.textContent = desc || ' ';
    statusEl.className = 'hdr-status';
  }

  // ── Избранное ──
  else if (activeChat.type === 'self') {
    nameEl.textContent = 'Избранное';
    statusEl.textContent = 'Ваши заметки';
    statusEl.className = 'hdr-status';
  }
}

// Переопределяем открытие чата, чтобы всегда обновлять профиль в шапке
const _originalOpenChat = openChat;
openChat = async function(chat) {
  await _originalOpenChat(chat);
  updateChatHeaderWithProfile();
};

// Если чат уже открыт (например, после перезагрузки), применяем сразу
if (activeChat) {
  updateChatHeaderWithProfile();
}

// Слушаем изменения в кэше пользователей, чтобы описание обновлялось автоматически
const usersCollection = collection(db, 'users');
onSnapshot(usersCollection, (snap) => {
  snap.docChanges().forEach(change => {
    if (change.type === 'modified' || change.type === 'added') {
      const data = change.doc.data();
      usersCache.set(change.doc.id, data);
      // Если изменился именно текущий собеседник – обновим шапку
      if (activeChat && activeChat.type === 'private' && activeChat.id === change.doc.id) {
        updateChatHeaderWithProfile();
      }
    }
  });
});

console.log('✅ Шапка профиля собеседника активирована');
// ════════════════════════════════════════════════════
//  РАСШИРЕННЫЙ ПРОФИЛЬ: ОПИСАНИЕ, МЕДИА, ГОЛОСОВЫЕ, ФАЙЛЫ
// ════════════════════════════════════════════════════

// --- CSS для вкладок и описания ---
(function addProfileTabsCSS() {
  if (document.getElementById('profile-tabs-style')) return;
  const st = document.createElement('style');
  st.id = 'profile-tabs-style';
  st.textContent = `
    #modal-user-view .upv-bio {
      font-size: 14px;
      color: var(--text-secondary);
      margin-top: 6px;
      text-align: center;
      padding: 0 16px;
    }
    #modal-user-view .upv-tabs {
      display: flex; gap: 6px; margin: 16px 0 8px;
      border-bottom: 1px solid var(--border); padding-bottom: 8px;
    }
    #modal-user-view .upv-tab-btn {
      flex: 1; padding: 8px 4px; border-radius: 10px; font-size: 13px;
      font-weight: 500; color: var(--text-secondary);
      background: none; transition: 0.2s;
    }
    #modal-user-view .upv-tab-btn.active {
      background: var(--accent-light); color: var(--accent); font-weight: 600;
    }
    #modal-user-view .upv-tab-content {
      max-height: 40vh; overflow-y: auto; padding: 0 4px;
    }
    #modal-user-view .media-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(80px,1fr));
      gap: 6px;
    }
    #modal-user-view .media-grid img {
      width: 100%; aspect-ratio: 1; object-fit: cover;
      border-radius: 8px; cursor: pointer;
    }
    #modal-user-view .media-grid .empty {
      grid-column: 1 / -1; text-align: center; padding: 20px;
      color: var(--text-hint); font-size: 14px;
    }
    #modal-user-view .upv-tab-content .voice-item,
    #modal-user-view .upv-tab-content .file-item {
      display: flex; align-items: center; gap: 10px; padding: 8px;
      background: var(--bg-secondary); border-radius: 10px;
      margin-bottom: 6px; font-size: 14px; cursor: pointer;
    }
  `;
  document.head.appendChild(st);
})();

// Расширяем openUserView
const _origOpenUserView = openUserView;
openUserView = function(uid) {
  const user = usersCache.get(uid);
  if (!user) return;

  const modal = document.getElementById('modal-user-view');
  const sheet = modal.querySelector('.modal-sheet');
  if (!sheet) return;

  // Очистим старое содержимое (кроме pill)
  const pill = sheet.querySelector('.modal-pill');
  sheet.innerHTML = '';
  if (pill) sheet.appendChild(pill);

  // Строим новое тело модального окна
  const body = document.createElement('div');
  body.className = 'modal-body';
  body.innerHTML = `
    <div class="user-profile-view">
      <div class="upv-av" id="uv-av">${avatarHtml(user.avatar)}</div>
      <div class="upv-name" id="uv-name">${esc(getDisplayName(uid))}</div>
      <div class="upv-uname" id="uv-uname">${esc(user.username || '')}</div>
      <!-- 👇 Описание профиля -->
      <div class="upv-bio" id="uv-bio">${esc(user.bio || user.status || '')}</div>
      <div class="upv-actions">
        <button class="upv-btn" id="uv-msg-btn">💬 Написать</button>
        <button class="upv-btn green" id="uv-add-btn">+ Контакт</button>
      </div>
    </div>

    <!-- Вкладки -->
    <div class="upv-tabs">
      <button class="upv-tab-btn active" data-tab="media">🖼️ Медиа</button>
      <button class="upv-tab-btn" data-tab="voice">🎙️ Голосовые</button>
      <button class="upv-tab-btn" data-tab="files">📁 Файлы</button>
    </div>
    <div class="upv-tab-content" id="upv-tab-content"></div>
  `;
  sheet.appendChild(body);

  // Обработчики кнопок
  body.querySelector('#uv-msg-btn').onclick = () => {
    closeModal('modal-user-view');
    openChat({ id: uid, name: getDisplayName(uid), avatar: user.avatar, type: 'private' });
  };
  const addBtn = body.querySelector('#uv-add-btn');
  const inCts = (myProfile?.contacts || []).includes(uid);
  addBtn.textContent = inCts ? '✕ Удалить' : '+ Контакт';
  addBtn.className = `upv-btn ${inCts ? 'gray' : 'green'}`;
  addBtn.onclick = async () => {
    if (inCts) {
      await setDoc(doc(db, 'users', me.uid), { contacts: arrayRemove(uid) }, { merge: true });
      if (myProfile) myProfile.contacts = (myProfile.contacts || []).filter(x => x !== uid);
    } else {
      await setDoc(doc(db, 'users', me.uid), { contacts: arrayUnion(uid) }, { merge: true });
      if (myProfile) myProfile.contacts = [...(myProfile.contacts || []), uid];
    }
    closeModal('modal-user-view');
  };

  // Переключение вкладок
  const tabs = body.querySelectorAll('.upv-tab-btn');
  const contentEl = body.querySelector('#upv-tab-content');
  tabs.forEach(tab => tab.onclick = () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    loadTabContent(uid, tab.dataset.tab, contentEl);
  });

  // Загружаем контент активной вкладки
  loadTabContent(uid, 'media', contentEl);

  // Открываем модальное окно
  openModal('modal-user-view');
};

// Загрузка контента для вкладки
async function loadTabContent(uid, tab, container) {
  container.innerHTML = '<div class="loader" style="margin:20px auto;"></div>';

  const chatId = chatIdForPrivate(uid);
  if (!chatId) {
    container.innerHTML = '<div class="empty">Чат не найден</div>';
    return;
  }

  const snap = await getDocs(query(collection(db, 'messages'), where('chatId', '==', chatId)));
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  let items = [];

  if (tab === 'media') {
    for (const msg of all) {
      if (msg.text && /\.(jpg|jpeg|png|gif|webp)$/i.test(msg.text) && msg.text.startsWith('http')) {
        items.push(msg.text);
      } else if (msg.isSticker && msg.text?.startsWith('[sticker]')) {
        items.push(msg.text.slice(9));
      } else if (msg.isFileLink && msg.text?.startsWith('http')) {
        items.push(msg.text);
      }
    }
    if (items.length === 0) {
      container.innerHTML = '<div class="empty">Нет медиа</div>';
      return;
    }
    container.innerHTML = `<div class="media-grid">${items.map(url => `<img src="${esc(url)}" loading="lazy" onclick="window.open('${esc(url)}')">`).join('')}</div>`;
  }
  else if (tab === 'voice') {
    for (const msg of all) {
      if (msg.isVoice && msg.text?.startsWith('[voice]')) {
        items.push(msg.text.slice(7));
      }
    }
    if (items.length === 0) {
      container.innerHTML = '<div class="empty">Нет голосовых</div>';
      return;
    }
    container.innerHTML = items.map((url, i) => `
      <div class="voice-item" onclick="(()=>{ const a=new Audio('${esc(url)}'); a.play(); })()">
        <span>🎙️</span>
        <span>Голосовое ${i+1}</span>
        <span style="flex:1"></span>
        <audio src="${esc(url)}" preload="none"></audio>
      </div>
    `).join('');
  }
  else if (tab === 'files') {
    for (const msg of all) {
      if (msg.isFileLink && msg.text) {
        items.push(msg.text);
      }
    }
    if (items.length === 0) {
      container.innerHTML = '<div class="empty">Нет файлов</div>';
      return;
    }
    container.innerHTML = items.map((url, i) => `
      <div class="file-item" onclick="window.open('${esc(url)}')">
        <span>📎</span>
        <span>Файл ${i+1}</span>
      </div>
    `).join('');
  }
}

console.log('✅ Расширенный профиль с описанием и медиа активирован');
// ════════════════════════════════════════════════════
//  ПОЛНОЭКРАННЫЙ ПРОСМОТР АВАТАРА В ШАПКЕ
// ════════════════════════════════════════════════════

// Создаём модальное окно один раз
function createAvatarModal() {
  if (document.getElementById('modal-avatar-full')) return;
  const ov = document.createElement('div');
  ov.id = 'modal-avatar-full';
  ov.className = 'modal-ov';
  ov.innerHTML = `
    <div class="modal-sheet" style="background:transparent; border-radius:0; box-shadow:none; max-height:100vh; display:flex; align-items:center; justify-content:center; padding:0;">
      <div style="position:relative; width:100%; display:flex; flex-direction:column; align-items:center;">
        <div id="full-avatar-img" style="width:min(90vw, 90vh); height:min(90vw, 90vh); border-radius:24px; background:var(--accent); display:flex; align-items:center; justify-content:center; font-size:120px; color:white; overflow:hidden; margin-bottom:16px; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
        </div>
        <button class="modal-btn" id="full-avatar-profile-btn" style="width:auto; padding:10px 24px; margin-bottom:8px; display:none;">👤 Профиль</button>
        <button class="modal-btn secondary" id="full-avatar-close-btn" style="width:auto; padding:10px 24px;">Закрыть</button>
      </div>
    </div>
  `;
  document.body.appendChild(ov);
  // Закрытие по клику на оверлей
  ov.addEventListener('click', (e) => {
    if (e.target === ov) closeAvatarModal();
  });
  document.getElementById('full-avatar-close-btn').onclick = closeAvatarModal;
}
createAvatarModal();

function closeAvatarModal() {
  document.getElementById('modal-avatar-full').classList.remove('open');
}

function openAvatarModal(avatarContent, isPrivate = false, uid = null) {
  const imgContainer = document.getElementById('full-avatar-img');
  // avatarContent — это HTML (эмодзи или <img>)
  imgContainer.innerHTML = avatarContent;
  // если это img, сделаем его на весь контейнер
  const img = imgContainer.querySelector('img');
  if (img) {
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '24px';
  }
  const profileBtn = document.getElementById('full-avatar-profile-btn');
  if (isPrivate && uid) {
    profileBtn.style.display = 'block';
    profileBtn.onclick = () => {
      closeAvatarModal();
      openUserView(uid);
    };
  } else {
    profileBtn.style.display = 'none';
  }
  document.getElementById('modal-avatar-full').classList.add('open');
}

// Функция получения HTML аватара для чата
function getAvatarHTML(chat) {
  if (!chat) return '😊';
  return avatarHtml(chat.avatar);
}

// Заменяем обработчик клика по аватару в шапке
function setupAvatarClick() {
  const av = document.getElementById('chat-hdr-av');
  if (!av) return;
  // Удаляем старые обработчики (если были)
  const newAv = av.cloneNode(true);
  av.parentNode.replaceChild(newAv, av);
  newAv.addEventListener('click', () => {
    if (!activeChat) return;
    const isPrivate = activeChat.type === 'private';
    const uid = isPrivate ? activeChat.id : null;
    const avHTML = getAvatarHTML(activeChat);
    openAvatarModal(avHTML, isPrivate, uid);
  });
}

// Запускаем после каждой смены чата — немного переопределим openChat
const __openChatForAvatar = openChat;
openChat = async function(chat) {
  await __openChatForAvatar(chat);
  setupAvatarClick();
};

// И сразу при загрузке, если чат уже открыт
if (activeChat) setupAvatarClick();

console.log('✅ Полноэкранный аватар при клике в шапке готов');
// ════════════════════════════════════════════════════
//  ПОЛНОЭКРАННЫЙ ПРОСМОТР ИЗОБРАЖЕНИЙ
// ════════════════════════════════════════════════════

// --- Создаём модальное окно для просмотра картинок ---
function createImageViewerModal() {
  if (document.getElementById('modal-image-viewer')) return;
  const ov = document.createElement('div');
  ov.id = 'modal-image-viewer';
  ov.className = 'modal-ov';
  ov.style.background = 'rgba(0,0,0,0.92)';
  ov.innerHTML = `
    <div style="width:100%; height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; position:relative;">
      <img id="full-image-view" src="" style="max-width:95vw; max-height:90vh; object-fit:contain; border-radius:12px; box-shadow:0 10px 40px rgba(0,0,0,0.5); transition: transform 0.2s ease;">
      <button id="close-image-viewer" style="position:absolute; top:20px; right:20px; width:44px; height:44px; border-radius:50%; background:rgba(255,255,255,0.2); color:white; border:none; font-size:22px; cursor:pointer; display:flex; align-items:center; justify-content:center; backdrop-filter: blur(4px);">✕</button>
    </div>
  `;
  document.body.appendChild(ov);

  // Закрытие
  document.getElementById('close-image-viewer').onclick = closeImageViewer;
  ov.addEventListener('click', (e) => {
    if (e.target === ov) closeImageViewer();
  });
}

function openImageViewer(url) {
  createImageViewerModal();
  const img = document.getElementById('full-image-view');
  img.src = url;
  // Небольшая анимация появления
  img.style.transform = 'scale(0.95)';
  requestAnimationFrame(() => {
    img.style.transform = 'scale(1)';
  });
  document.getElementById('modal-image-viewer').classList.add('open');
}

function closeImageViewer() {
  const ov = document.getElementById('modal-image-viewer');
  if (ov) ov.classList.remove('open');
}

// --- Делегирование кликов на все изображения в чате ---
const messagesWrap = document.getElementById('messages-wrap');
if (messagesWrap) {
  messagesWrap.addEventListener('click', (e) => {
    const target = e.target;
    // Проверяем, что кликнули именно по картинке, и она внутри сообщения
    if (target.tagName === 'IMG' && target.closest('.bubble')) {
      e.preventDefault();
      e.stopPropagation();
      // Исключаем аудио-волны и другие не-изображения
      if (target.src && !target.src.startsWith('data:audio')) {
        openImageViewer(target.src);
      }
    }
  });
}

// --- Убираем встроенные onclick="window.open" у изображений после рендера ---
const __origRenderMessagesForImages = renderMessages;
renderMessages = function() {
  __origRenderMessagesForImages.call(this);
  // Удаляем атрибут onclick, чтобы не открывалась новая вкладка
  document.querySelectorAll('.bubble .bubble-text img[onclick]').forEach(img => {
    img.removeAttribute('onclick');
  });
  // Добавляем pointer-events: auto и курсор pointer для удобства
  document.querySelectorAll('.bubble .bubble-text img').forEach(img => {
    img.style.cursor = 'pointer';
  });
};

console.log('🖼️ Полноэкранный просмотр изображений активирован');
// ════════════════════════════════════════════════════
//  ОБНОВЛЁННОЕ ИНФО-ОКНО ГРУППЫ/КАНАЛА СО СПИСКОМ УЧАСТНИКОВ
// ════════════════════════════════════════════════════

// --- Стили для списка участников (добавим динамически) ---
(function addGroupInfoStyles() {
  if (document.getElementById('group-info-styles')) return;
  const st = document.createElement('style');
  st.id = 'group-info-styles';
  st.textContent = `
    #gi-members-list {
      max-height: 40vh;
      overflow-y: auto;
      margin: 12px 0;
      padding: 0 4px;
    }
    .gi-member-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 8px;
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .gi-member-row:active {
      background: var(--bg-secondary);
    }
    .gi-member-row .gi-member-av {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      color: white;
      overflow: hidden;
      flex-shrink: 0;
    }
    .gi-member-row .gi-member-av img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .gi-member-row .gi-member-info {
      flex: 1;
      min-width: 0;
    }
    .gi-member-row .gi-member-name {
      font-size: 15px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .gi-member-row .gi-member-username {
      font-size: 12px;
      color: var(--text-secondary);
    }
    .gi-member-row .gi-member-admin {
      font-size: 11px;
      background: var(--accent-light);
      color: var(--accent);
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 500;
    }
  `;
  document.head.appendChild(st);
})();

// --- Функция открытия информационного окна группы/канала ---
function openGroupInfo(chat) {
  // Создаём модальное окно, если его ещё нет
  if (!document.getElementById('modal-group-info')) {
    const ov = document.createElement('div');
    ov.id = 'modal-group-info';
    ov.className = 'modal-ov';
    ov.innerHTML = `
      <div class="modal-sheet">
        <div class="modal-pill"></div>
        <div class="modal-hdr">
          <h3 id="gi-name">Группа</h3>
          <button class="modal-close">✕</button>
        </div>
        <div class="modal-body">
          <div class="user-profile-view">
            <div class="upv-av" id="gi-av">👥</div>
            <div class="upv-name" id="gi-title">Название</div>
            <div class="upv-uname" id="gi-uname">@username</div>
            <div class="upv-bio" id="gi-desc"></div>
            <div id="gi-members-count" style="font-size:13px;color:var(--text-secondary);margin-top:4px;"></div>
          </div>
          <div class="modal-field" id="gi-edit-desc" style="display:none;">
            <label>Описание</label>
            <textarea id="gi-desc-input" rows="2" placeholder="Введите описание"></textarea>
            <button class="modal-btn" id="gi-save-desc" style="margin-top:6px;">Сохранить</button>
          </div>
          <!-- Список участников -->
          <div id="gi-members-list"></div>
          <div class="upv-actions" style="margin-top:12px;">
            <button class="upv-btn" id="gi-leave-btn" style="background:var(--red);">🚪 Покинуть</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(ov);
    // Закрытие
    ov.querySelector('.modal-close').onclick = () => closeModal('modal-group-info');
    ov.addEventListener('click', e => { if (e.target === ov) closeModal('modal-group-info'); });
  }

  const room = chat.roomData || roomsCache.get(chat.id) || {};
  const isAdmin = room.admins?.includes(me?.uid);

  // Заполняем основные данные
  document.getElementById('gi-name').textContent = room.type === 'channel' ? 'Канал' : 'Группа';
  document.getElementById('gi-av').innerHTML = avatarHtml(room.avatar || '👥');
  document.getElementById('gi-title').textContent = room.name || chat.name;
  document.getElementById('gi-uname').textContent = room.username || '';
  document.getElementById('gi-desc').textContent = room.description || '';
  document.getElementById('gi-members-count').textContent = room.members ? `${room.members.length} участников` : '';

  // Редактирование описания (только для админов)
  const editBlock = document.getElementById('gi-edit-desc');
  if (isAdmin) {
    editBlock.style.display = 'block';
    document.getElementById('gi-desc-input').value = room.description || '';
    document.getElementById('gi-save-desc').onclick = async () => {
      const newDesc = document.getElementById('gi-desc-input').value.trim();
      await updateDoc(doc(db, 'rooms', chat.id), { description: newDesc });
      if (chat.roomData) chat.roomData.description = newDesc;
      roomsCache.set(chat.id, { ...room, description: newDesc });
      document.getElementById('gi-desc').textContent = newDesc;
      updateChatHeaderWithProfile();
      showToast('Описание обновлено');
    };
  } else {
    editBlock.style.display = 'none';
  }

  // Список участников
  const membersContainer = document.getElementById('gi-members-list');
  membersContainer.innerHTML = '';
  if (room.members && room.members.length) {
    for (const uid of room.members) {
      const user = usersCache.get(uid);
      if (!user) continue;
      const isMemberAdmin = room.admins?.includes(uid);
      const displayName = getDisplayName(uid);
      const row = document.createElement('div');
      row.className = 'gi-member-row';
      row.innerHTML = `
        <div class="gi-member-av">${avatarHtml(user.avatar)}</div>
        <div class="gi-member-info">
          <div class="gi-member-name">${esc(displayName)}</div>
          <div class="gi-member-username">${esc(user.username || '')} ${isMemberAdmin ? '<span class="gi-member-admin">админ</span>' : ''}</div>
        </div>
      `;
      // При клике на участника переходим в чат с ним (если это не мы сами)
      row.addEventListener('click', () => {
        if (uid === me.uid) return; // нельзя открыть чат с самим собой
        closeModal('modal-group-info');
        const chatTarget = { id: uid, name: displayName, avatar: user.avatar, type: 'private' };
        openChat(chatTarget);
      });
      membersContainer.appendChild(row);
    }
  } else {
    membersContainer.innerHTML = '<div style="text-align:center;padding:10px;color:var(--text-hint);">Нет участников</div>';
  }

  // Кнопка выхода
  document.getElementById('gi-leave-btn').onclick = async () => {
    if (!activeChat || !me) return;
    const roomId = activeChat.id;
    await updateDoc(doc(db, 'rooms', roomId), { members: arrayRemove(me.uid) });
    closeModal('modal-group-info');
    history.back();
    showToast('Вы покинули группу');
  };

  openModal('modal-group-info');
}

// Убедимся, что клик по аватару группы/канала вызывает openGroupInfo (уже должно быть из предыдущего кода)
// На всякий случай переопределим openAvatarModal ещё раз
const __openAvatarModal = openAvatarModal;
openAvatarModal = function(avatarContent, isPrivate, uid) {
  if (activeChat && (activeChat.type === 'group' || activeChat.type === 'channel')) {
    openGroupInfo(activeChat);
    return;
  }
  __openAvatarModal(avatarContent, isPrivate, uid);
};

console.log('✅ Инфо-окно группы с участниками готово');
// ════════════════════════════════════════════════════
//  ВКЛАДКИ МЕДИА, ССЫЛКИ, ГОЛОСОВЫЕ В ГРУППЕ/КАНАЛЕ
// ════════════════════════════════════════════════════

// --- Дополнительные стили для вкладок в окне группы ---
(function addGroupTabsCSS() {
  if (document.getElementById('group-info-tabs-style')) return;
  const st = document.createElement('style');
  st.id = 'group-info-tabs-style';
  st.textContent = `
    #modal-group-info .upv-tabs {
      display: flex; gap: 6px; margin: 12px 0 6px;
      border-bottom: 1px solid var(--border); padding-bottom: 8px;
    }
    #modal-group-info .upv-tab-btn {
      flex: 1; padding: 8px 4px; border-radius: 10px; font-size: 13px;
      font-weight: 500; color: var(--text-secondary); background: none;
      transition: 0.2s; text-align: center;
    }
    #modal-group-info .upv-tab-btn.active {
      background: var(--accent-light); color: var(--accent); font-weight: 600;
    }
    #modal-group-info .upv-tab-content {
      max-height: 40vh; overflow-y: auto; padding: 0 4px;
    }
    #modal-group-info .media-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(80px,1fr));
      gap: 6px;
    }
    #modal-group-info .media-grid img {
      width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; cursor: pointer;
    }
    #modal-group-info .upv-tab-content .voice-item,
    #modal-group-info .upv-tab-content .link-item {
      display: flex; align-items: center; gap: 10px; padding: 8px;
      background: var(--bg-secondary); border-radius: 10px;
      margin-bottom: 6px; font-size: 14px; cursor: pointer;
    }
  `;
  document.head.appendChild(st);
})();

// --- Переопределяем openGroupInfo, чтобы добавить вкладки ---
const __origOpenGroupInfo = openGroupInfo;
openGroupInfo = function(chat) {
  // Вызываем оригинал, чтобы создать окно (но мы потом перестроим содержимое)
  // Чтобы не дублировать создание окна, проверим его наличие
  if (!document.getElementById('modal-group-info')) {
    // Создаём окно с нуля, используя структуру из предыдущего кода + вкладки
    const ov = document.createElement('div');
    ov.id = 'modal-group-info';
    ov.className = 'modal-ov';
    ov.innerHTML = `
      <div class="modal-sheet">
        <div class="modal-pill"></div>
        <div class="modal-hdr">
          <h3 id="gi-name">Группа</h3>
          <button class="modal-close">✕</button>
        </div>
        <div class="modal-body">
          <div class="user-profile-view">
            <div class="upv-av" id="gi-av">👥</div>
            <div class="upv-name" id="gi-title">Название</div>
            <div class="upv-uname" id="gi-uname">@username</div>
            <div class="upv-bio" id="gi-desc"></div>
            <div id="gi-members-count" style="font-size:13px;color:var(--text-secondary);margin-top:4px;"></div>
          </div>
          <div class="modal-field" id="gi-edit-desc" style="display:none;">
            <label>Описание</label>
            <textarea id="gi-desc-input" rows="2" placeholder="Введите описание"></textarea>
            <button class="modal-btn" id="gi-save-desc" style="margin-top:6px;">Сохранить</button>
          </div>
          <!-- Вкладки -->
          <div class="upv-tabs">
            <button class="upv-tab-btn active" data-tab="members">👥 Участники</button>
            <button class="upv-tab-btn" data-tab="media">🖼️ Медиа</button>
            <button class="upv-tab-btn" data-tab="links">🔗 Ссылки</button>
            <button class="upv-tab-btn" data-tab="voice">🎙️ Голосовые</button>
          </div>
          <div class="upv-tab-content" id="gi-tab-content"></div>
          <div class="upv-actions" style="margin-top:12px;">
            <button class="upv-btn" id="gi-leave-btn" style="background:var(--red);">🚪 Покинуть</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(ov);
    // Закрытие
    ov.querySelector('.modal-close').onclick = () => closeModal('modal-group-info');
    ov.addEventListener('click', e => { if (e.target === ov) closeModal('modal-group-info'); });
  }

  const room = chat.roomData || roomsCache.get(chat.id) || {};
  const isAdmin = room.admins?.includes(me?.uid);

  // Заполняем основные данные
  document.getElementById('gi-name').textContent = room.type === 'channel' ? 'Канал' : 'Группа';
  document.getElementById('gi-av').innerHTML = avatarHtml(room.avatar || '👥');
  document.getElementById('gi-title').textContent = room.name || chat.name;
  document.getElementById('gi-uname').textContent = room.username || '';
  document.getElementById('gi-desc').textContent = room.description || '';
  document.getElementById('gi-members-count').textContent = room.members ? `${room.members.length} участников` : '';

  // Редактирование описания (админы)
  const editBlock = document.getElementById('gi-edit-desc');
  if (isAdmin) {
    editBlock.style.display = 'block';
    document.getElementById('gi-desc-input').value = room.description || '';
    document.getElementById('gi-save-desc').onclick = async () => {
      const newDesc = document.getElementById('gi-desc-input').value.trim();
      await updateDoc(doc(db, 'rooms', chat.id), { description: newDesc });
      if (chat.roomData) chat.roomData.description = newDesc;
      roomsCache.set(chat.id, { ...room, description: newDesc });
      document.getElementById('gi-desc').textContent = newDesc;
      updateChatHeaderWithProfile();
      showToast('Описание обновлено');
    };
  } else {
    editBlock.style.display = 'none';
  }

  // Кнопка выхода
  document.getElementById('gi-leave-btn').onclick = async () => {
    if (!activeChat || !me) return;
    const roomId = activeChat.id;
    await updateDoc(doc(db, 'rooms', roomId), { members: arrayRemove(me.uid) });
    closeModal('modal-group-info');
    history.back();
    showToast('Вы покинули группу');
  };

  // Переключение вкладок
  const tabs = document.querySelectorAll('#modal-group-info .upv-tab-btn');
  const tabContent = document.getElementById('gi-tab-content');
  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loadGroupTabContent(chat, tab.dataset.tab, tabContent);
    };
  });

  // Загружаем первую вкладку (Участники)
  loadGroupTabContent(chat, 'members', tabContent);

  openModal('modal-group-info');
};

// --- Загрузка содержимого вкладок для группы ---
async function loadGroupTabContent(chat, tab, container) {
  container.innerHTML = '<div class="loader" style="margin:20px auto;"></div>';

  const room = chat.roomData || roomsCache.get(chat.id) || {};
  const roomId = room.id || chat.id;
  const chatId = `room_${roomId}`; // ID чата для сообщений

  // Вкладка "Участники"
  if (tab === 'members') {
    if (!room.members || !room.members.length) {
      container.innerHTML = '<div style="text-align:center;padding:10px;color:var(--text-hint);">Нет участников</div>';
      return;
    }
    container.innerHTML = '';
    for (const uid of room.members) {
      const user = usersCache.get(uid);
      if (!user) continue;
      const isAdmin = room.admins?.includes(uid);
      const displayName = getDisplayName(uid);
      const row = document.createElement('div');
      row.className = 'gi-member-row';
      row.innerHTML = `
        <div class="gi-member-av">${avatarHtml(user.avatar)}</div>
        <div class="gi-member-info">
          <div class="gi-member-name">${esc(displayName)}</div>
          <div class="gi-member-username">${esc(user.username || '')} ${isAdmin ? '<span class="gi-member-admin">админ</span>' : ''}</div>
        </div>
      `;
      row.addEventListener('click', () => {
        if (uid === me.uid) return;
        closeModal('modal-group-info');
        openChat({ id: uid, name: displayName, avatar: user.avatar, type: 'private' });
      });
      container.appendChild(row);
    }
    return;
  }

  // Для остальных вкладок нужны сообщения
  const snap = await getDocs(query(collection(db, 'messages'), where('chatId', '==', chatId)));
  const allMsgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Медиа
  if (tab === 'media') {
    const urls = [];
    for (const msg of allMsgs) {
      if (msg.text && /\.(jpg|jpeg|png|gif|webp)$/i.test(msg.text) && msg.text.startsWith('http')) {
        urls.push(msg.text);
      } else if (msg.isSticker && msg.text?.startsWith('[sticker]')) {
        urls.push(msg.text.slice(9));
      } else if (msg.isFileLink && msg.text?.startsWith('http')) {
        urls.push(msg.text);
      }
    }
    if (!urls.length) {
      container.innerHTML = '<div style="text-align:center;padding:10px;color:var(--text-hint);">Нет медиа</div>';
      return;
    }
    container.innerHTML = `<div class="media-grid">${urls.map(url => `<img src="${esc(url)}" loading="lazy" onclick="openImageViewer('${esc(url)}')">`).join('')}</div>`;
  }

  // Ссылки
  else if (tab === 'links') {
    const links = [];
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    for (const msg of allMsgs) {
      if (msg.text) {
        const found = msg.text.match(urlRegex);
        if (found) links.push(...found);
      }
    }
    // Уникализируем
    const unique = [...new Set(links)];
    if (!unique.length) {
      container.innerHTML = '<div style="text-align:center;padding:10px;color:var(--text-hint);">Нет ссылок</div>';
      return;
    }
    container.innerHTML = unique.map(link => `
      <div class="link-item" onclick="window.open('${esc(link)}', '_blank')">
        <span>🔗</span>
        <span style="word-break:break-all;">${esc(link)}</span>
      </div>
    `).join('');
  }

  // Голосовые
  else if (tab === 'voice') {
    const voiceUrls = [];
    for (const msg of allMsgs) {
      if (msg.isVoice && msg.text?.startsWith('[voice]')) {
        voiceUrls.push(msg.text.slice(7));
      }
    }
    if (!voiceUrls.length) {
      container.innerHTML = '<div style="text-align:center;padding:10px;color:var(--text-hint);">Нет голосовых</div>';
      return;
    }
    container.innerHTML = voiceUrls.map((url, i) => `
      <div class="voice-item" onclick="(()=>{ const a=new Audio('${esc(url)}'); a.play(); })()">
        <span>🎙️</span>
        <span>Голосовое ${i+1}</span>
      </div>
    `).join('');
  }
}

console.log('✅ Вкладки медиа/ссылок/голосовых в группах готовы');
//  УМЕНЬШИТЬ АНИМАЦИИ (настройка)
// ════════════════════════════════════════════════════

(function() {
  // Проверяем, есть ли уже сохранённое состояние
  const reduced = localStorage.getItem('reduce-animations') === 'true';
  if (reduced) document.body.classList.add('reduce-animations');

  // Добавляем стили, которые отключают/ускоряют анимации при наличии класса
  const style = document.createElement('style');
  style.id = 'reduce-animations-style';
  style.textContent = `
    body.reduce-animations *,
    body.reduce-animations *::before,
    body.reduce-animations *::after {
      animation-duration: 0.001s !important;
      transition-duration: 0.001s !important;
    }
    /* Исключения: сохраняем плавность для некоторых элементов, если нужно */
    body.reduce-animations .chat-list,
    body.reduce-animations #messages-wrap {
      scroll-behavior: auto !important;
    }
  `;
  document.head.appendChild(style);

  // Функция добавления пункта в настройки (вызывается при рендере настроек)
  function addReduceAnimationsSetting() {
    const bodyEl = document.getElementById('settings-body');
    if (!bodyEl || document.getElementById('s-reduce-anim')) return;

    let targetSection = null;
    bodyEl.querySelectorAll('.settings-section').forEach(sec => {
      if (sec.querySelector('.settings-label')?.textContent === 'Дополнительно') {
        targetSection = sec;
      }
    });
    if (!targetSection) return;

    const item = document.createElement('div');
    item.className = 'settings-item';
    item.id = 's-reduce-anim';
    item.innerHTML = `
      <div class="si-icon">🌀</div>
      <div class="si-text">Уменьшить анимации</div>
      <label class="toggle-switch" style="margin-left:auto; position:relative; display:inline-block; width:44px; height:24px;">
        <input type="checkbox" id="reduce-anim-checkbox" style="opacity:0; width:0; height:0;">
        <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#ccc; transition:.3s; border-radius:24px;"></span>
      </label>
    `;
    targetSection.appendChild(item);

    const checkbox = item.querySelector('#reduce-anim-checkbox');
    checkbox.checked = document.body.classList.contains('reduce-animations');

    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        document.body.classList.add('reduce-animations');
        localStorage.setItem('reduce-animations', 'true');
      } else {
        document.body.classList.remove('reduce-animations');
        localStorage.setItem('reduce-animations', 'false');
      }
    });

    // Стили для тоггла (добавим здесь же, чтобы не засорять)
    if (!document.getElementById('toggle-switch-style')) {
      const ts = document.createElement('style');
      ts.id = 'toggle-switch-style';
      ts.textContent = `
        .toggle-slider:before {
          position: absolute;
          content: "";
          height: 18px;
          width: 18px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: .3s;
          border-radius: 50%;
        }
        input:checked + .toggle-slider {
          background-color: var(--accent);
        }
        input:checked + .toggle-slider:before {
          transform: translateX(20px);
        }
      `;
      document.head.appendChild(ts);
    }
  }

  // Переопределяем renderSettings, чтобы добавлять нашу настройку после отрисовки
  const _origRenderSettings = renderSettings;
  renderSettings = function() {
    _origRenderSettings.apply(this, arguments);
    // Даём время на отрисовку DOM
    setTimeout(addReduceAnimationsSetting, 50);
  };
})();
  console.log('✅ Настройка "Уменьшить анимации" добавлена');
  // ════════════════════════════════════════════════════
//  АДАПТИВНЫЙ РЕЖИМ ДЛЯ ПК И ПЛАНШЕТА (исправлено)
// ════════════════════════════════════════════════════

(function() {
  const mediaQuery = window.matchMedia('(min-width: 768px)');
  let isDesktopMode = mediaQuery.matches;

  // CSS для расширенного режима
  const style = document.createElement('style');
  style.id = 'desktop-layout-style';
  style.textContent = `
    @media (min-width: 768px) {
      body { background: var(--bg-secondary); }
      #app { flex-direction: row !important; }
      #page-chats {
        position: static !important;
        flex: 0 0 380px !important;
        max-width: 380px;
        border-right: 1px solid var(--border);
        background: white;
        z-index: 1;
        transform: none !important;
        display: flex;
        flex-direction: column;
        height: 100vh;
      }
      #page-chats .chat-list { flex: 1; overflow-y: auto; }
      #page-chats .hdr { flex-shrink: 0; }
      #page-chat, #page-contacts, #page-settings {
        position: static !important;
        flex: 1;
        transform: none !important;
        display: flex;
        flex-direction: column;
        background: white;
      }
      #page-chat:not(.active),
      #page-contacts:not(.active),
      #page-settings:not(.active) {
        display: none;
      }
      #page-chat.active,
      #page-contacts.active,
      #page-settings.active {
        display: flex !important;
      }
      #bottom-nav, #bottom-nav-2 { display: none; }
    }
  `;
  document.head.appendChild(style);

  function applyDesktopMode(enable) {
    if (enable) {
      document.body.classList.add('desktop-layout');
      const pageChats = document.getElementById('page-chats');
      if (pageChats) pageChats.style.display = 'flex';
      updateDesktopVisibility();
    } else {
      document.body.classList.remove('desktop-layout');
      ['page-chat','page-contacts','page-settings'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = '';
      });
      document.getElementById('bottom-nav').style.display = '';
      const bn2 = document.getElementById('bottom-nav-2');
      if (bn2) bn2.style.display = '';
    }
  }

  function updateDesktopVisibility() {
    if (!document.body.classList.contains('desktop-layout')) return;
    const activePage = document.querySelector('.page.active');
    ['page-chat','page-contacts','page-settings'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.display = el.classList.contains('active') ? 'flex' : 'none';
    });
  }

  // Переопределяем navigateTo для десктопа
  const originalNavigateTo = navigateTo;
  navigateTo = function(pageName) {
    originalNavigateTo(pageName);
    if (isDesktopMode) updateDesktopVisibility();
  };

  mediaQuery.addEventListener('change', (e) => {
    isDesktopMode = e.matches;
    applyDesktopMode(isDesktopMode);
  });

  if (isDesktopMode) applyDesktopMode(true);

  // Настройка в интерфейсе
  const origRenderSettings = renderSettings;
  renderSettings = function() {
    origRenderSettings.apply(this, arguments);
    setTimeout(() => {
      const bodyEl = document.getElementById('settings-body');
      if (!bodyEl || document.getElementById('s-layout-mode')) return;
      let targetSection = null;
      bodyEl.querySelectorAll('.settings-section').forEach(sec => {
        if (sec.querySelector('.settings-label')?.textContent === 'Дополнительно') targetSection = sec;
      });
      if (!targetSection) return;

      const item = document.createElement('div');
      item.className = 'settings-item';
      item.id = 's-layout-mode';
      item.innerHTML = `
        <div class="si-icon">🖥️</div>
        <div class="si-text">Расширенный режим (ПК)</div>
        <label class="toggle-switch" style="margin-left:auto; position:relative; display:inline-block; width:44px; height:24px;">
          <input type="checkbox" id="desktop-layout-checkbox" style="opacity:0; width:0; height:0;">
          <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#ccc; transition:.3s; border-radius:24px;"></span>
        </label>
      `;
      targetSection.appendChild(item);

      const checkbox = item.querySelector('#desktop-layout-checkbox');
      checkbox.checked = isDesktopMode;
      checkbox.addEventListener('change', () => {
        isDesktopMode = checkbox.checked;
        applyDesktopMode(isDesktopMode);
        localStorage.setItem('force-desktop-layout', checkbox.checked ? 'true' : 'false');
      });
    }, 100);
  };

  // Восстановление принудительного режима
  const forced = localStorage.getItem('force-desktop-layout');
  if (forced === 'true' && !isDesktopMode) {
    document.body.classList.add('desktop-layout');
    isDesktopMode = true;
    applyDesktopMode(true);
  } else if (forced === 'false' && isDesktopMode) {
    document.body.classList.remove('desktop-layout');
    isDesktopMode = false;
    applyDesktopMode(false);
  }

  // Здесь была пропущена закрывающая скобка и вызов функции
})(); // <-- вот это было пропущено
// ════════════════════════════════════════════════════
//  СКРЫТИЕ ЛОГОВ (режим отладки)
// ════════════════════════════════════════════════════

(function() {
  // Проверяем, был ли режим отладки включён ранее
  const debugEnabled = localStorage.getItem('debug_mode') === 'true';
  
  // Сохраняем оригинальный console.log
  const originalLog = console.log;
  
  // Функция-заглушка, если отладка выключена
  const noop = function() {};
  
  // Устанавливаем console.log в зависимости от режима
  console.log = debugEnabled ? originalLog : noop;
  
  // Экспортируем функцию для включения/отключения
  window.setDebugMode = function(enable) {
    if (enable) {
      console.log = originalLog;
      localStorage.setItem('debug_mode', 'true');
    } else {
      console.log = noop;
      localStorage.setItem('debug_mode', 'false');
    }
  };
  
  // По умолчанию отладка выключена, логи скрыты
})();
// Обработка правого клика для вызова контекстного меню сообщения
document.getElementById('messages-wrap').addEventListener('contextmenu', function(e) {
  const bubble = e.target.closest('.bubble');
  if (!bubble) return;
  const msgId = bubble.dataset.msgId;
  if (!msgId) return;
  const msg = allMessages.find(m => m.id === msgId);
  if (!msg) return;
  e.preventDefault();
  showMsgCtx(msg, bubble);
});
// ════════════════════════════════════════════════════
//  КНОПКА НАСТРОЙКИ «РЕЖИМ ПК» (без конфликтов)
// ════════════════════════════════════════════════════
(function() {
  // Применяем режим при загрузке, если он был включён принудительно
  function applyDesktop(enable) {
    if (enable) {
      document.body.classList.add('desktop-layout');
      // Показываем боковую панель чатов на широком экране
      const pageChats = document.getElementById('page-chats');
      if (pageChats) pageChats.style.display = 'flex';
    } else {
      document.body.classList.remove('desktop-layout');
      // Восстанавливаем мобильное поведение
      const pageChats = document.getElementById('page-chats');
      if (pageChats) pageChats.style.display = '';
    }
  }

  // Проверяем сохранённую настройку и применяем
  let desktopEnabled = localStorage.getItem('force-desktop-layout') === 'true';
  applyDesktop(desktopEnabled);

  // Функция добавления пункта в настройки (вызывается после рендера настроек)
  function addLayoutSettingItem() {
    if (document.getElementById('s-layout-mode')) return; // уже добавлен
    const bodyEl = document.getElementById('settings-body');
    if (!bodyEl) return;

    // Ищем раздел "Дополнительно"
    let targetSection = null;
    bodyEl.querySelectorAll('.settings-section').forEach(sec => {
      if (sec.querySelector('.settings-label')?.textContent?.trim() === 'Дополнительно') {
        targetSection = sec;
      }
    });
    if (!targetSection) return;

    const item = document.createElement('div');
    item.className = 'settings-item';
    item.id = 's-layout-mode';
    item.innerHTML = `
      <div class="si-icon">🖥️</div>
      <div class="si-text">Режим ПК</div>
      <label class="toggle-switch" style="margin-left:auto; position:relative; display:inline-block; width:44px; height:24px;">
        <input type="checkbox" id="desktop-layout-checkbox" style="opacity:0; width:0; height:0;">
        <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#ccc; transition:.3s; border-radius:24px;"></span>
      </label>
    `;
    targetSection.appendChild(item);

    const checkbox = item.querySelector('#desktop-layout-checkbox');
    checkbox.checked = desktopEnabled;
    checkbox.addEventListener('change', () => {
      desktopEnabled = checkbox.checked;
      applyDesktop(desktopEnabled);
      localStorage.setItem('force-desktop-layout', desktopEnabled ? 'true' : 'false');
    });
  }

  // Ждём появления настроек (наблюдатель или таймаут)
  const observer = new MutationObserver(() => {
    if (document.getElementById('settings-body')) {
      addLayoutSettingItem();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // На случай, если настройки уже отрендерены
  if (document.getElementById('settings-body')) {
    addLayoutSettingItem();
  }
})();
// ════════════════════════════════════════════════════
//  СТАТУСЫ ПОЛЬЗОВАТЕЛЯ: онлайн / был недавно / давно
// ════════════════════════════════════════════════════

// Форматирует lastSeen в читаемый статус
function formatLastSeen(timestamp) {
  if (!timestamp) return 'был(а) давно';
  const now = Date.now();
  const diff = now - timestamp.toMillis();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `был(а) ${minutes} мин. назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `был(а) ${hours} ч. назад`;
  return 'был(а) давно';
}

// Обновляет статус в шапке чата для приватного собеседника
async function updateUserOnlineStatus(uid) {
  if (!uid || uid === me?.uid) return;
  const user = usersCache.get(uid);
  const statusEl = document.getElementById('chat-hdr-status');
  if (!statusEl) return;
  
  // Не перезаписываем, если активный чат не с этим пользователем
  if (!activeChat || activeChat.type !== 'private' || activeChat.id !== uid) return;

  // Проверяем, не печатает ли он (уже установлено через typing)
  if (statusEl.querySelector('.typing-dots')) return;

  if (user?.online) {
    statusEl.textContent = 'в сети';
    statusEl.className = 'hdr-status online';
  } else if (user?.lastSeen) {
    statusEl.textContent = formatLastSeen(user.lastSeen);
    statusEl.className = 'hdr-status';
  } else {
    statusEl.textContent = 'не в сети';
    statusEl.className = 'hdr-status';
  }
}

// Подписываемся на изменения документа конкретного пользователя
function listenUserStatus(uid) {
  if (!uid) return;
  const unsub = onSnapshot(doc(db, 'users', uid), (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      usersCache.set(uid, data); // обновляем кэш
      updateUserOnlineStatus(uid);
    }
  });
  // Сохраняем функцию отписки, чтобы вызвать при смене чата
  if (activeChat?.id === uid) {
    if (window._userStatusUnsub) window._userStatusUnsub();
    window._userStatusUnsub = unsub;
  }
}

// При открытии чата (приватного) запускаем слежение за статусом
const _origOpenChatForStatus = openChat;
openChat = async function(chat) {
  // Отписываемся от предыдущего слушателя
  if (window._userStatusUnsub) {
    window._userStatusUnsub();
    window._userStatusUnsub = null;
  }
  await _origOpenChatForStatus(chat);
  if (chat?.type === 'private') {
    // Обновляем статус сразу
    updateUserOnlineStatus(chat.id);
    // Запускаем слушатель изменений
    listenUserStatus(chat.id);
  }
};

// Интеграция с уже существующим updateChatHeaderWithProfile
// (не заменяем, а дополняем, чтобы не сломать группы/блокировку)
const _origUpdateHeader = updateChatHeaderWithProfile;
updateChatHeaderWithProfile = function() {
  _origUpdateHeader();
  if (activeChat?.type === 'private') {
    updateUserOnlineStatus(activeChat.id);
  }
};
// Обновление статуса при изменении кэша пользователей (если чат открыт)
// Уже есть onSnapshot на коллекцию users — можно добавить вызов в его обработчик.
// Но мы уже добавили персональный слушатель в openChat, поэтому обновление будет мгновенным.

console.log('✅ Статусы "в сети", "был(а) недавно", "был(а) давно" добавлены');
// ════════════════════════════════════════════════════
//  КНОПКА НАСТРОЙКИ «РЕЖИМ ПК» (без конфликтов)
// ════════════════════════════════════════════════════
(function() {
  // Применяем режим при загрузке, если он был включён принудительно
  function applyDesktop(enable) {
    if (enable) {
      document.body.classList.add('desktop-layout');
      // Показываем боковую панель чатов на широком экране
      const pageChats = document.getElementById('page-chats');
      if (pageChats) pageChats.style.display = 'flex';
    } else {
      document.body.classList.remove('desktop-layout');
      // Восстанавливаем мобильное поведение
      const pageChats = document.getElementById('page-chats');
      if (pageChats) pageChats.style.display = '';
    }
  }

  // Проверяем сохранённую настройку и применяем
  let desktopEnabled = localStorage.getItem('force-desktop-layout') === 'true';
  applyDesktop(desktopEnabled);

  // Функция добавления пункта в настройки (вызывается после рендера настроек)
  function addLayoutSettingItem() {
    if (document.getElementById('s-layout-mode')) return; // уже добавлен
    const bodyEl = document.getElementById('settings-body');
    if (!bodyEl) return;

    // Ищем раздел "Дополнительно"
    let targetSection = null;
    bodyEl.querySelectorAll('.settings-section').forEach(sec => {
      if (sec.querySelector('.settings-label')?.textContent?.trim() === 'Дополнительно') {
        targetSection = sec;
      }
    });
    if (!targetSection) return;

    const item = document.createElement('div');
    item.className = 'settings-item';
    item.id = 's-layout-mode';
    item.innerHTML = `
      <div class="si-icon">🖥️</div>
      <div class="si-text">Режим ПК</div>
      <label class="toggle-switch" style="margin-left:auto; position:relative; display:inline-block; width:44px; height:24px;">
        <input type="checkbox" id="desktop-layout-checkbox" style="opacity:0; width:0; height:0;">
        <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#ccc; transition:.3s; border-radius:24px;"></span>
      </label>
    `;
    targetSection.appendChild(item);

    const checkbox = item.querySelector('#desktop-layout-checkbox');
    checkbox.checked = desktopEnabled;
    checkbox.addEventListener('change', () => {
      desktopEnabled = checkbox.checked;
      applyDesktop(desktopEnabled);
      localStorage.setItem('force-desktop-layout', desktopEnabled ? 'true' : 'false');
    });
  }

  // Ждём появления настроек (наблюдатель или таймаут)
  const observer = new MutationObserver(() => {
    if (document.getElementById('settings-body')) {
      addLayoutSettingItem();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // На случай, если настройки уже отрендерены
  if (document.getElementById('settings-body')) {
    addLayoutSettingItem();
  }
})();
// ════════════════════════════════════════════════════
//  КНОПКА «НАСТРОЙКИ» В ШАПКЕ ДЛЯ РЕЖИМА ПК
// ════════════════════════════════════════════════════
(function() {
  // Добавляем CSS для отображения кнопки только на больших экранах
  const style = document.createElement('style');
  style.id = 'desktop-settings-btn-style';
  style.textContent = `
    #desktop-settings-btn {
      display: none; /* по умолчанию скрыта */
    }
    @media (min-width: 768px) {
      #desktop-settings-btn {
        display: flex;
      }
      /* Если принудительно включён режим ПК — показываем всегда */
      body.desktop-layout #desktop-settings-btn {
        display: flex;
      }
    }
  `;
  document.head.appendChild(style);

  // Функция для вставки кнопки в шапку списка чатов
  function injectSettingsButton() {
    const hdr = document.querySelector('#page-chats .hdr');
    if (!hdr || document.getElementById('desktop-settings-btn')) return;

    const settingsBtn = document.createElement('button');
    settingsBtn.id = 'desktop-settings-btn';
    settingsBtn.className = 'hdr-btn';
    settingsBtn.title = 'Настройки';
    settingsBtn.innerHTML = '⚙️';
    settingsBtn.onclick = () => {
      // Переключаем на страницу настроек
      navigateTo('settings');
    };

    // Вставляем перед кнопкой создания нового чата или в конец
    const composeBtn = document.getElementById('compose-btn');
    if (composeBtn) {
      hdr.insertBefore(settingsBtn, composeBtn);
    } else {
      hdr.appendChild(settingsBtn);
    }
  }

  // При загрузке страницы сразу пытаемся вставить
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectSettingsButton);
  } else {
    injectSettingsButton();
  }

  // Также подстрахуемся: если шапка была пересоздана, добавим кнопку при открытии чатов
  const observer = new MutationObserver(() => {
    if (!document.getElementById('desktop-settings-btn')) {
      injectSettingsButton();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
// ════════════════════════════════════════════════════
//  КРЕСТИК ДЛЯ ЗАКРЫТИЯ НАСТРОЕК / КОНТАКТОВ (ПК-режим)
// ════════════════════════════════════════════════════
(function addCloseButtons() {
  function injectCloseBtn(selector) {
    const hdr = document.querySelector(selector);
    if (!hdr || hdr.querySelector('.hdr-close')) return;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'hdr-btn hdr-close';
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'margin-left:auto; font-size:18px;';
    closeBtn.addEventListener('click', () => navigateTo('chats'));
    hdr.appendChild(closeBtn);
  }
  // Добавляем в шапку настроек и контактов
  injectCloseBtn('#page-settings .hdr');
  injectCloseBtn('#page-contacts .hdr');
})();
// ════════════════════════════════════════════════════
//  УЛУЧШЕННЫЙ ДИЗАЙН ГОЛОСОВЫХ СООБЩЕНИЙ
// ════════════════════════════════════════════════════
(function() {
  // Стили
  const style = document.createElement('style');
  style.id = 'voice-message-style';
  style.textContent = `
    .voice-msg {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 200px;
      padding: 4px 0;
    }
    .voice-play-btn {
      width: 36px; height: 36px;
      border-radius: 50%;
      background: linear-gradient(135deg, #4A90E2, #5B9BD5);
      box-shadow: 0 4px 10px rgba(74,144,226,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: transform 0.15s ease, box-shadow 0.2s;
      flex-shrink: 0;
    }
    .voice-play-btn:active {
      transform: scale(0.9);
      box-shadow: 0 2px 5px rgba(74,144,226,0.2);
    }
    .voice-play-btn svg {
      width: 16px; height: 16px;
      fill: white;
    }
    .voice-wave-container {
      flex: 1;
      height: 36px;
      display: flex;
      align-items: center;
      gap: 3px;
    }
    .voice-wave-bar {
      width: 3px;
      border-radius: 3px;
      background: linear-gradient(to top, #4A90E2, #8BC4F8);
      transition: height 0.2s ease;
      will-change: height;
    }
    .voice-time {
      font-size: 12px;
      font-weight: 500;
      color: #666;
      min-width: 36px;
      text-align: right;
      flex-shrink: 0;
    }
    .msg-group.out .voice-time {
      color: rgba(255,255,255,0.8);
    }
    .msg-group.in .voice-time {
      color: #888;
    }
    /* Тёмная тема (если есть) */
    body.dark .voice-time { color: #aaa; }
  `;
  document.head.appendChild(style);

  // Функция создания визуализации (волны) на основе аудио-файла
  function createWaveform(audioSrc) {
    return new Promise(resolve => {
      const audio = new Audio(audioSrc);
      audio.addEventListener('loadedmetadata', () => {
        const duration = audio.duration;
        const sampleCount = 30; // количество полосок
        // Генерируем случайные высоты, похожие на звуковую волну
        const bars = Array.from({ length: sampleCount }, () => Math.random() * 0.8 + 0.2);
        resolve(bars);
      });
      audio.load();
    });
  }

  // Строим плеер
  async function buildVoicePlayer(audioElement, container) {
    const audioSrc = audioElement.src;
    if (!audioSrc) return;

    // Получаем данные волны
    const bars = await createWaveform(audioSrc);

    // Контейнер плеера
    const voiceMsg = document.createElement('div');
    voiceMsg.className = 'voice-msg';

    // Кнопка воспроизведения
    const playBtn = document.createElement('div');
    playBtn.className = 'voice-play-btn';
    playBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`; // треугольник play
    voiceMsg.appendChild(playBtn);

    // Волна
    const waveContainer = document.createElement('div');
    waveContainer.className = 'voice-wave-container';
    const maxBars = 30;
    bars.slice(0, maxBars).forEach(height => {
      const bar = document.createElement('div');
      bar.className = 'voice-wave-bar';
      bar.style.height = (height * 24) + 'px';
      waveContainer.appendChild(bar);
    });
    voiceMsg.appendChild(waveContainer);

    // Время
    const timeDisplay = document.createElement('span');
    timeDisplay.className = 'voice-time';
    const mins = Math.floor((audioElement.duration || 0) / 60);
    const secs = Math.floor((audioElement.duration || 0) % 60).toString().padStart(2,'0');
    timeDisplay.textContent = `${mins}:${secs}`;
    voiceMsg.appendChild(timeDisplay);

    // Логика управления
    let isPlaying = false;
    const updatePlayIcon = () => {
      playBtn.innerHTML = isPlaying ? 
        `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>` : // пауза
        `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
    };

    playBtn.addEventListener('click', () => {
      if (audioElement.paused) {
        audioElement.play();
        isPlaying = true;
      } else {
        audioElement.pause();
        isPlaying = false;
      }
      updatePlayIcon();
    });

    audioElement.addEventListener('ended', () => {
      isPlaying = false;
      updatePlayIcon();
      // сброс прогресса волны
      waveContainer.querySelectorAll('.voice-wave-bar').forEach(bar => {
        bar.style.height = bar.dataset.originalHeight || bar.style.height;
      });
    });

    audioElement.addEventListener('timeupdate', () => {
      const current = audioElement.currentTime;
      const duration = audioElement.duration || 1;
      const progress = current / duration;
      // обновляем высоту полосок в зависимости от прогресса
      waveContainer.querySelectorAll('.voice-wave-bar').forEach((bar, i) => {
        const originalHeight = parseFloat(bar.dataset.originalHeight || bar.style.height);
        if (!bar.dataset.originalHeight) {
          bar.dataset.originalHeight = bar.style.height;
        }
        const adjusted = originalHeight * (i / maxBars <= progress ? 1 : 0.3);
        bar.style.height = adjusted + 'px';
      });
      // обновляем время
      const mins = Math.floor(current / 60);
      const secs = Math.floor(current % 60).toString().padStart(2,'0');
      timeDisplay.textContent = `${mins}:${secs}`;
    });

    // Заменяем стандартный аудиоплеер
    audioElement.style.display = 'none';
    container.appendChild(voiceMsg);
  }

  // Применяем ко всем аудио в сообщениях при рендеринге
  const origRenderMessages = renderMessages;
  renderMessages = function() {
    origRenderMessages.call(this);
    // Находим все аудио в сообщениях и заменяем
    document.querySelectorAll('.bubble .bubble-text audio').forEach(audio => {
      if (!audio.nextElementSibling?.classList.contains('voice-msg')) {
        buildVoicePlayer(audio, audio.parentElement);
      }
    });
  };

  // Также обработаем уже существующие аудио (если вдруг)
  if (typeof allMessages !== 'undefined') {
    setTimeout(() => {
      document.querySelectorAll('.bubble .bubble-text audio').forEach(audio => {
        if (!audio.nextElementSibling?.classList.contains('voice-msg')) {
          buildVoicePlayer(audio, audio.parentElement);
        }
      });
    }, 100);
  }
})();
// ════════════════════════════════════════════════════
//  10 СОВРЕМЕННЫХ ТЕМ ОФОРМЛЕНИЯ
// ════════════════════════════════════════════════════
(function() {
  // Предустановленные темы
  const themes = {
    default: {
      name: 'Стандартная',
      accent: '#2AABEE',
      bg: '#FFFFFF',
      bgSecondary: '#F0F2F5',
      textPrimary: '#1A1A2E',
      textSecondary: '#4A4A5A',
      msgOutBg: '#2AABEE',
      msgOutText: '#FFFFFF',
      msgInBg: '#FFFFFF',
      msgInText: '#1A1A2E',
      border: '#E8EBF0',
      gradient: 'linear-gradient(135deg, #2AABEE, #1a8bc5)'
    },
    dark: {
      name: 'Тёмная',
      accent: '#6C63FF',
      bg: '#1E1E2E',
      bgSecondary: '#2A2A3C',
      textPrimary: '#EAEAEA',
      textSecondary: '#B0B0C0',
      msgOutBg: '#6C63FF',
      msgOutText: '#FFFFFF',
      msgInBg: '#2A2A3C',
      msgInText: '#EAEAEA',
      border: '#3A3A4E',
      gradient: 'linear-gradient(135deg, #6C63FF, #4A42E0)'
    },
    midnight: {
      name: 'Полночь',
      accent: '#FF6B6B',
      bg: '#0B0C10',
      bgSecondary: '#1F2833',
      textPrimary: '#FFFFFF',
      textSecondary: '#C5C6C7',
      msgOutBg: '#FF6B6B',
      msgOutText: '#FFFFFF',
      msgInBg: '#1F2833',
      msgInText: '#FFFFFF',
      border: '#2C353D',
      gradient: 'linear-gradient(135deg, #FF6B6B, #E74C3C)'
    },
    mint: {
      name: 'Мятная',
      accent: '#2ECC71',
      bg: '#F0FFF4',
      bgSecondary: '#E8F8E8',
      textPrimary: '#1E3B2F',
      textSecondary: '#4A6A5E',
      msgOutBg: '#2ECC71',
      msgOutText: '#FFFFFF',
      msgInBg: '#FFFFFF',
      msgInText: '#1E3B2F',
      border: '#C8E6C9',
      gradient: 'linear-gradient(135deg, #2ECC71, #27AE60)'
    },
    sunset: {
      name: 'Закат',
      accent: '#FF7E67',
      bg: '#FFF5F0',
      bgSecondary: '#FFE8E0',
      textPrimary: '#4A2C2C',
      textSecondary: '#7A5C5C',
      msgOutBg: '#FF7E67',
      msgOutText: '#FFFFFF',
      msgInBg: '#FFFFFF',
      msgInText: '#4A2C2C',
      border: '#F0C4B0',
      gradient: 'linear-gradient(135deg, #FF7E67, #FF5E3A)'
    },
    ocean: {
      name: 'Океан',
      accent: '#0077B6',
      bg: '#F0F8FF',
      bgSecondary: '#E0F0FF',
      textPrimary: '#002233',
      textSecondary: '#335566',
      msgOutBg: '#0077B6',
      msgOutText: '#FFFFFF',
      msgInBg: '#FFFFFF',
      msgInText: '#002233',
      border: '#B0D4F0',
      gradient: 'linear-gradient(135deg, #0077B6, #005B8E)'
    },
    lavender: {
      name: 'Лаванда',
      accent: '#9B59B6',
      bg: '#F8F4FF',
      bgSecondary: '#ECE0FF',
      textPrimary: '#2D1B3E',
      textSecondary: '#5C4A6E',
      msgOutBg: '#9B59B6',
      msgOutText: '#FFFFFF',
      msgInBg: '#FFFFFF',
      msgInText: '#2D1B3E',
      border: '#D4C0F0',
      gradient: 'linear-gradient(135deg, #9B59B6, #8E44AD)'
    },
    forest: {
      name: 'Лесная',
      accent: '#4CAF50',
      bg: '#F2F9F2',
      bgSecondary: '#E0F0E0',
      textPrimary: '#1B3B1B',
      textSecondary: '#4A6A4A',
      msgOutBg: '#4CAF50',
      msgOutText: '#FFFFFF',
      msgInBg: '#FFFFFF',
      msgInText: '#1B3B1B',
      border: '#B0D0B0',
      gradient: 'linear-gradient(135deg, #4CAF50, #388E3C)'
    },
    rose: {
      name: 'Розовая',
      accent: '#E91E63',
      bg: '#FFF0F5',
      bgSecondary: '#FFE0EC',
      textPrimary: '#3E1B2E',
      textSecondary: '#6E4A5E',
      msgOutBg: '#E91E63',
      msgOutText: '#FFFFFF',
      msgInBg: '#FFFFFF',
      msgInText: '#3E1B2E',
      border: '#F0B0C8',
      gradient: 'linear-gradient(135deg, #E91E63, #C2185B)'
    },
    cyan: {
      name: 'Циан',
      accent: '#00BCD4',
      bg: '#F0FFFF',
      bgSecondary: '#E0FFFF',
      textPrimary: '#003333',
      textSecondary: '#336666',
      msgOutBg: '#00BCD4',
      msgOutText: '#FFFFFF',
      msgInBg: '#FFFFFF',
      msgInText: '#003333',
      border: '#B0E0E0',
      gradient: 'linear-gradient(135deg, #00BCD4, #0097A7)'
    }
  };

  // Применить тему
  function applyTheme(themeKey) {
    const theme = themes[themeKey];
    if (!theme) return;
    const root = document.documentElement;
    Object.entries(theme).forEach(([key, value]) => {
      if (key === 'name') return;
      root.style.setProperty(`--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`, value);
    });
    // Дополнительно установим переменную градиента для кнопок
    root.style.setProperty('--accent-gradient', theme.gradient);
    localStorage.setItem('selected-theme', themeKey);
  }

  // Загрузка сохраненной темы или дефолт
  const savedTheme = localStorage.getItem('selected-theme') || 'default';
  applyTheme(savedTheme);

  // Добавление пункта выбора темы в настройки
  function addThemeSetting() {
    const settingsBody = document.getElementById('settings-body');
    if (!settingsBody || document.getElementById('s-theme-selector')) return;

    // Ищем раздел "Дополнительно"
    let targetSection = null;
    settingsBody.querySelectorAll('.settings-section').forEach(sec => {
      if (sec.querySelector('.settings-label')?.textContent.trim() === 'Дополнительно') {
        targetSection = sec;
      }
    });
    if (!targetSection) return;

    const item = document.createElement('div');
    item.className = 'settings-item';
    item.id = 's-theme-selector';
    item.innerHTML = `
      <div class="si-icon">🎨</div>
      <div class="si-text">Тема оформления</div>
      <span class="si-value" id="current-theme-name">${themes[savedTheme]?.name || ''}</span>
      <span class="si-arrow">›</span>
    `;
    item.addEventListener('click', showThemeModal);
    targetSection.appendChild(item);
  }

  // Модальное окно выбора темы
  function showThemeModal() {
    // Удаляем старое, если есть
    const oldModal = document.getElementById('modal-theme-picker');
    if (oldModal) oldModal.remove();

    const modal = document.createElement('div');
    modal.id = 'modal-theme-picker';
    modal.className = 'modal-ov';
    modal.innerHTML = `
      <div class="modal-sheet">
        <div class="modal-pill"></div>
        <div class="modal-hdr">
          <h3>Выберите тему</h3>
          <button class="modal-close">✕</button>
        </div>
        <div class="modal-body">
          <div class="theme-grid" id="theme-grid"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const grid = modal.querySelector('#theme-grid');
    grid.innerHTML = Object.entries(themes).map(([key, theme]) => `
      <div class="theme-card ${key === savedTheme ? 'active' : ''}" data-theme="${key}">
        <div class="theme-preview" style="background:${theme.bg}; border:2px solid ${theme.border};">
          <div style="background:${theme.accent}; width:100%; height:8px; border-radius: 0 0 12px 12px;"></div>
          <div style="display:flex; flex:1; padding:4px;">
            <div style="background:${theme.msgInBg}; flex:1; margin:2px; border-radius:4px; border-left:3px solid ${theme.accent};"></div>
            <div style="background:${theme.msgOutBg}; flex:1; margin:2px; border-radius:4px; border-right:3px solid ${theme.accent};"></div>
          </div>
        </div>
        <span>${theme.name}</span>
        ${key === savedTheme ? '<span class="check">✓</span>' : ''}
      </div>
    `).join('');

    // Обработчики
    grid.querySelectorAll('.theme-card').forEach(card => {
      card.addEventListener('click', () => {
        const themeKey = card.dataset.theme;
        applyTheme(themeKey);
        // Обновить интерфейс
        document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        // Обновить отображаемое имя темы в настройках
        const nameEl = document.getElementById('current-theme-name');
        if (nameEl) nameEl.textContent = themes[themeKey].name;
        // Закрыть модалку через небольшой таймаут
        setTimeout(() => modal.remove(), 200);
      });
    });

    modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    modal.classList.add('open');

    // Добавим стили для сетки тем (если ещё нет)
    if (!document.getElementById('theme-picker-styles')) {
      const st = document.createElement('style');
      st.id = 'theme-picker-styles';
      st.textContent = `
        .theme-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 12px; }
        .theme-card {
          text-align: center; cursor: pointer; padding: 8px; border-radius: 12px;
          transition: 0.2s; position: relative;
        }
        .theme-card.active { background: var(--accent-light); }
        .theme-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        .theme-preview {
          width: 100%; height: 60px; border-radius: 12px; overflow: hidden;
          display: flex; flex-direction: column; margin-bottom: 6px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.1);
        }
        .theme-card .check {
          position: absolute; top: 4px; right: 8px;
          background: var(--accent); color: white; border-radius: 50%;
          width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;
          font-size: 12px; font-weight: bold;
        }
      `;
      document.head.appendChild(st);
    }
  }

  // Внедряем в настройки при их рендере
  const origRenderSettings = renderSettings;
  renderSettings = function() {
    origRenderSettings.apply(this, arguments);
    setTimeout(addThemeSetting, 100);
  };

  // На случай, если настройки уже отрендерены
  if (document.getElementById('settings-body')) addThemeSetting();
})();
// ════════════════════════════════════════════════════
//  НАСТРОЙКИ: УДАЛИТЬ АККАУНТ, СМЕНИТЬ ПАРОЛЬ, ЯЗЫК
// ════════════════════════════════════════════════════
(function() {
  // Мультиязычность (русский, английский, арабский)
  const translations = {
    ru: {
      settings: 'Настройки',
      deleteAccount: 'Удалить аккаунт',
      changePassword: 'Сменить пароль',
      language: 'Язык интерфейса',
      confirmDelete: 'Вы уверены? Аккаунт будет удалён безвозвратно.',
      passwordChanged: 'Пароль изменён',
      langChanged: 'Язык изменён'
    },
    en: {
      settings: 'Settings',
      deleteAccount: 'Delete Account',
      changePassword: 'Change Password',
      language: 'Interface Language',
      confirmDelete: 'Are you sure? The account will be permanently deleted.',
      passwordChanged: 'Password changed',
      langChanged: 'Language changed'
    },
    ar: {
      settings: 'الإعدادات',
      deleteAccount: 'حذف الحساب',
      changePassword: 'تغيير كلمة المرور',
      language: 'لغة الواجهة',
      confirmDelete: 'هل أنت متأكد؟ سيتم حذف الحساب نهائياً.',
      passwordChanged: 'تم تغيير كلمة المرور',
      langChanged: 'تم تغيير اللغة'
    }
  };

  let currentLang = localStorage.getItem('ui_lang') || 'ru';
  function t(key) { return (translations[currentLang] && translations[currentLang][key]) || key; }

  // Применить язык к основным элементам (частично, можно расширить)
  function applyUILanguage(lang) {
    currentLang = lang;
    localStorage.setItem('ui_lang', lang);
    // Обновим заголовок настроек, если он виден
    const settingsTitle = document.querySelector('#page-settings .hdr-title');
    if (settingsTitle) settingsTitle.textContent = t('settings');
    showToast(t('langChanged'));
  }

  // Добавить пункты в настройки
  function addAccountSettings() {
    const settingsBody = document.getElementById('settings-body');
    if (!settingsBody || document.getElementById('s-account-actions')) return;

    let targetSection = null;
    settingsBody.querySelectorAll('.settings-section').forEach(sec => {
      if (sec.querySelector('.settings-label')?.textContent.trim() === 'Дополнительно') {
        targetSection = sec;
      }
    });
    if (!targetSection) return;

    // Язык
    const langItem = document.createElement('div');
    langItem.className = 'settings-item';
    langItem.id = 's-language';
    langItem.innerHTML = `
      <div class="si-icon">🌍</div>
      <div class="si-text">${t('language')}</div>
      <select id="ui-lang-select" class="settings-select" style="margin-left:auto;">
        <option value="ru" ${currentLang==='ru'?'selected':''}>Русский</option>
        <option value="en" ${currentLang==='en'?'selected':''}>English</option>
        <option value="ar" ${currentLang==='ar'?'selected':''}>العربية</option>
      </select>
    `;
    langItem.querySelector('#ui-lang-select').addEventListener('change', (e) => applyUILanguage(e.target.value));
    targetSection.appendChild(langItem);

    // Сменить пароль
    const passItem = document.createElement('div');
    passItem.className = 'settings-item';
    passItem.innerHTML = `
      <div class="si-icon">🔑</div>
      <div class="si-text">${t('changePassword')}</div>
      <span class="si-arrow">›</span>
    `;
    passItem.onclick = async () => {
      const email = prompt('Введите ваш email для сброса пароля:');
      if (email && auth.currentUser) {
        try {
          await sendPasswordResetEmail(auth, email);
          showToast('Письмо для сброса пароля отправлено');
        } catch (e) { showToast('Ошибка: ' + e.message); }
      }
    };
    targetSection.appendChild(passItem);

    // Удалить аккаунт
    const delItem = document.createElement('div');
    delItem.className = 'settings-item';
    delItem.style.color = 'var(--red)';
    delItem.innerHTML = `
      <div class="si-icon" style="color:var(--red);">🗑️</div>
      <div class="si-text" style="color:var(--red);">${t('deleteAccount')}</div>
      <span class="si-arrow" style="color:var(--red);">›</span>
    `;
    delItem.onclick = async () => {
      if (confirm(t('confirmDelete'))) {
        const user = auth.currentUser;
        if (user) {
          try {
            // Удаляем данные из Firestore
            await deleteDoc(doc(db, 'users', user.uid));
            // Удаляем аккаунт
            await user.delete();
            showToast('Аккаунт удалён');
          } catch (e) {
            showToast('Ошибка: ' + e.message);
          }
        }
      }
    };
    targetSection.appendChild(delItem);
  }

  // Внедряем после рендера настроек
  const origRenderSettings = renderSettings;
  renderSettings = function() {
    origRenderSettings.apply(this, arguments);
    setTimeout(addAccountSettings, 100);
  };
  if (document.getElementById('settings-body')) setTimeout(addAccountSettings, 100);
})();
// ════════════════════════════════════════════════════
//  МИНИ-ПРИЛОЖЕНИЯ С УЛУЧШЕННЫМ ДИЗАЙНОМ
// ════════════════════════════════════════════════════
(function() {
  // ---------- Общие стили ----------
  const style = document.createElement('style');
  style.textContent = `
    .app-modal {
      max-width: 550px;
      width: 95%;
    }
    .app-modal .modal-body {
      padding: 16px;
    }
    .app-field {
      margin-bottom: 12px;
    }
    .app-field label {
      display: block;
      margin-bottom: 4px;
      font-weight: 500;
      font-size: 13px;
      color: var(--text-secondary);
    }
    .app-input, .app-select, .app-textarea {
      width: 100%;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: var(--bg-secondary);
      color: var(--text-primary);
      font-size: 15px;
      transition: 0.2s;
    }
    .app-input:focus, .app-select:focus, .app-textarea:focus {
      border-color: var(--accent);
      outline: none;
    }
    .app-textarea {
      resize: vertical;
      min-height: 80px;
    }
    .app-btn {
      padding: 10px 18px;
      border-radius: 10px;
      border: none;
      background: var(--accent);
      color: white;
      font-weight: 600;
      cursor: pointer;
      transition: 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .app-btn:active { opacity: 0.8; }
    .app-btn.secondary {
      background: var(--bg-secondary);
      color: var(--text-primary);
      border: 1px solid var(--border);
    }
    .app-btn.danger {
      background: var(--red);
    }
    .app-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .app-card {
      background: var(--bg-secondary);
      border-radius: 12px;
      padding: 12px;
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .app-grid {
      display: grid;
      gap: 6px;
    }
    .app-grid-4 { grid-template-columns: repeat(4, 1fr); }
    .app-grid-7 { grid-template-columns: repeat(7, 1fr); }
    .app-center { text-align: center; }
    .app-large { font-size: 28px; font-weight: 700; margin: 12px 0; }
    .app-icon-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 18px;
      padding: 6px;
      border-radius: 6px;
      color: var(--text-secondary);
    }
    .app-icon-btn:hover { background: var(--bg); }
  `;
  document.head.appendChild(style);

  // ---------- Хелперы модалок ----------
  function createAppModal(id, title) {
    let modal = document.getElementById(id);
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-ov app-modal';
      modal.id = id;
      modal.innerHTML = `
        <div class="modal-sheet">
          <div class="modal-pill"></div>
          <div class="modal-hdr">
            <h3>${title}</h3>
            <button class="modal-close">✕</button>
          </div>
          <div class="modal-body"></div>
        </div>
      `;
      document.body.appendChild(modal);
      modal.querySelector('.modal-close').onclick = () => closeModal(id);
      modal.addEventListener('click', e => { if (e.target === modal) closeModal(id); });
    } else {
      modal.querySelector('.modal-hdr h3').textContent = title;
    }
    return modal;
  }

  // ---------- ПОГОДА ----------
  function openWeatherApp() {
    const modal = createAppModal('app-weather-modal', '☀️ Погода');
    const body = modal.querySelector('.modal-body');
    body.innerHTML = `
      <div class="app-field">
        <label>Город</label>
        <input type="text" id="weather-city" class="app-input" placeholder="Москва">
      </div>
      <button id="get-weather-btn" class="app-btn">🔍 Узнать погоду</button>
      <div id="weather-result" class="app-center app-large" style="margin-top:12px;"></div>
    `;
    openModal('app-weather-modal');

    // Попробуем сразу получить по геолокации
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const { latitude, longitude } = pos.coords;
        const res = await fetch(`https://wttr.in/${latitude},${longitude}?format=%C+%t&lang=ru`);
        const text = await res.text();
        document.getElementById('weather-result').textContent = text.trim();
      }, () => {});
    }

    document.getElementById('get-weather-btn').onclick = async () => {
      const city = document.getElementById('weather-city').value.trim();
      if (!city) return;
      const resultEl = document.getElementById('weather-result');
      resultEl.textContent = 'Загрузка...';
      const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=%C+%t&lang=ru`);
      resultEl.textContent = (await res.text()).trim();
    };
  }

  // ---------- ЗАМЕТКИ ----------
  function openNotesApp() {
    const modal = createAppModal('app-notes-modal', '📝 Заметки');
    const body = modal.querySelector('.modal-body');
    const notes = JSON.parse(localStorage.getItem('nx_notes') || '[]');

    function renderNotes() {
      body.innerHTML = '';
      if (notes.length === 0) {
        body.innerHTML = '<div class="app-center" style="padding:20px;color:var(--text-hint);">Нет заметок</div>';
      } else {
        notes.forEach((note, idx) => {
          const card = document.createElement('div');
          card.className = 'app-card';
          card.innerHTML = `
            <span>${escapeHtml(note)}</span>
            <button class="app-icon-btn danger" data-idx="${idx}">✕</button>
          `;
          card.querySelector('button').onclick = () => {
            notes.splice(idx, 1);
            localStorage.setItem('nx_notes', JSON.stringify(notes));
            renderNotes();
          };
          body.appendChild(card);
        });
      }
      // Поле ввода
      const inputRow = document.createElement('div');
      inputRow.className = 'app-row';
      inputRow.style.marginTop = '12px';
      inputRow.innerHTML = `
        <input id="new-note" class="app-input" placeholder="Новая заметка" style="flex:1;">
        <button id="add-note-btn" class="app-btn">Добавить</button>
      `;
      body.appendChild(inputRow);
      document.getElementById('add-note-btn').onclick = () => {
        const val = document.getElementById('new-note').value.trim();
        if (val) {
          notes.push(val);
          localStorage.setItem('nx_notes', JSON.stringify(notes));
          renderNotes();
        }
      };
    }

    renderNotes();
    openModal('app-notes-modal');
  }

  // ---------- ТАЙМЕР ----------
  function openTimerApp() {
    const modal = createAppModal('app-timer-modal', '⏱️ Таймер');
    const body = modal.querySelector('.modal-body');
    body.innerHTML = `
      <div class="app-center">
        <div class="app-large" id="timer-display">00:00</div>
        <div class="app-row" style="justify-content:center; gap:4px;">
          <input type="number" id="timer-min" class="app-input" placeholder="Мин" min="0" style="width:80px; text-align:center;">
          <span style="font-size:24px;">:</span>
          <input type="number" id="timer-sec" class="app-input" placeholder="Сек" min="0" max="59" style="width:80px; text-align:center;">
        </div>
        <div class="app-row" style="justify-content:center; margin-top:12px;">
          <button id="start-timer" class="app-btn">▶ Старт</button>
          <button id="stop-timer" class="app-btn secondary">⏹ Стоп</button>
        </div>
      </div>
    `;
    openModal('app-timer-modal');

    let timerInterval;
    const display = document.getElementById('timer-display');
    const stopBtn = document.getElementById('stop-timer');

    function updateDisplay(totalSeconds) {
      const m = Math.floor(totalSeconds / 60).toString().padStart(2,'0');
      const s = (totalSeconds % 60).toString().padStart(2,'0');
      display.textContent = `${m}:${s}`;
    }

    document.getElementById('start-timer').onclick = () => {
      const mins = parseInt(document.getElementById('timer-min').value) || 0;
      const secs = parseInt(document.getElementById('timer-sec').value) || 0;
      let total = mins * 60 + secs;
      if (total <= 0) return;
      clearInterval(timerInterval);
      updateDisplay(total);
      timerInterval = setInterval(() => {
        total--;
        if (total < 0) {
          clearInterval(timerInterval);
          display.textContent = 'Время!';
          return;
        }
        updateDisplay(total);
      }, 1000);
    };

    stopBtn.onclick = () => clearInterval(timerInterval);
  }

  // ---------- КАЛЬКУЛЯТОР ----------
  function openCalculatorApp() {
    const modal = createAppModal('app-calc-modal', '🔢 Калькулятор');
    const body = modal.querySelector('.modal-body');
    body.innerHTML = `
      <input type="text" id="calc-display" class="app-input" readonly style="text-align:right; font-size:24px; margin-bottom:12px;">
      <div class="app-grid app-grid-4">
        ${['7','8','9','/','4','5','6','*','1','2','3','-','0','.','=','+'].map(s => `<button class="app-btn secondary calc-btn" data-val="${s}">${s}</button>`).join('')}
      </div>
      <button class="app-btn danger" id="calc-clear" style="width:100%; margin-top:8px;">C</button>
    `;
    openModal('app-calc-modal');

    const display = document.getElementById('calc-display');
    let expression = '';

    document.querySelectorAll('.calc-btn').forEach(btn => {
      btn.onclick = () => {
        const val = btn.dataset.val;
        if (val === '=') {
          try {
            display.value = eval(expression);
          } catch {
            display.value = 'Ошибка';
          }
          expression = '';
        } else {
          expression += val;
          display.value += val;
        }
      };
    });

    document.getElementById('calc-clear').onclick = () => {
      expression = '';
      display.value = '';
    };
  }

  // ---------- МЕНЮ МИНИ-ПРИЛОЖЕНИЙ ----------
  function openAppMenu() {
    const modal = document.createElement('div');
    modal.className = 'modal-ov app-modal';
    modal.id = 'modal-app-menu';
    modal.innerHTML = `
      <div class="modal-sheet">
        <div class="modal-pill"></div>
        <div class="modal-hdr">
          <h3>🛠️ Мини-приложения</h3>
          <button class="modal-close">✕</button>
        </div>
        <div class="modal-body" id="app-menu-body">
          ${[
            { id: 'notes', icon: '📝', name: 'Заметки', fn: openNotesApp },
            { id: 'timer', icon: '⏱️', name: 'Таймер', fn: openTimerApp },
            { id: 'calc', icon: '🔢', name: 'Калькулятор', fn: openCalculatorApp },
            { id: 'calendar', icon: '📅', name: 'Календарь', fn: openCalendarApp }
          ].map(app => `
            <div class="app-item" id="app-${app.id}">
              <div class="app-icon">${app.icon}</div>
              <div class="app-name">${app.name}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.modal-close').onclick = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    modal.classList.add('open');

    // Обработчики
    document.getElementById('app-weather').onclick = () => { modal.remove(); openWeatherApp(); };
    document.getElementById('app-notes').onclick = () => { modal.remove(); openNotesApp(); };
    document.getElementById('app-timer').onclick = () => { modal.remove(); openTimerApp(); };
    document.getElementById('app-calc').onclick = () => { modal.remove(); openCalculatorApp(); };
    document.getElementById('app-calendar').onclick = () => { modal.remove(); openCalendarApp(); };
  }

  // ---------- Добавление кнопки в интерфейс ----------
  function injectAppButton() {
    if (document.body.classList.contains('desktop-layout') || window.innerWidth >= 768) {
      const hdr = document.querySelector('#page-chats .hdr');
      if (hdr && !document.getElementById('apps-btn-desktop')) {
        const btn = document.createElement('button');
        btn.id = 'apps-btn-desktop';
        btn.className = 'hdr-btn';
        btn.textContent = '🧩';
        btn.title = 'Приложения';
        btn.onclick = openAppMenu;
        hdr.appendChild(btn);
      }
    } else {
      const nav = document.getElementById('bottom-nav');
      if (nav && !document.getElementById('apps-nav-btn')) {
        const btn = document.createElement('button');
        btn.id = 'apps-nav-btn';
        btn.className = 'nav-btn';
        btn.innerHTML = '<span class="nav-icon">🧩</span><span class="nav-label">Apps</span>';
        btn.onclick = openAppMenu;
        nav.appendChild(btn);
      }
    }
  }

  setTimeout(injectAppButton, 500);

  // Вспомогательная функция для экранирования HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
})();
// ════════════════════════════════════════════════════
//  ПОЛНАЯ МУЛЬТИЯЗЫЧНОСТЬ ИНТЕРФЕЙСА (ru, en, ar)
// ════════════════════════════════════════════════════
(function() {
  // Словарь переводов
  const translations = {
    ru: {
      chats: 'Чаты', contacts: 'Контакты', settings: 'Настройки',
      newChat: 'Новый чат', search: 'Поиск...', clearSearch: '✕',
      compose: '✏️', online: 'в сети', typing: 'печатает...',
      you: 'Вы', messagePlaceholder: 'Напишите сообщение…',
      send: '➤', reply: 'Ответить', forward: 'Переслать',
      edit: 'Изменить', delete: 'Удалить', copy: 'Скопировать',
      deleteMsg: 'Удалить сообщение?', msgDeleted: 'Сообщение удалено',
      msgCopied: 'Скопировано', msgEdited: 'ред.',
      emptyChat: 'Нет сообщений. Напишите первым!',
      chooseChat: 'Выберите чат', startChat: 'Начните общение прямо сейчас',
      archived: 'Архив', unread: 'Непрочитанные',
      blocked: 'Заблокирован', youBlocked: 'Вы заблокировали этого пользователя',
      parent: 'Родитель', childAccount: 'Детский аккаунт',
      voiceNotAllowed: 'Детские аккаунты не могут отправлять голосовые сообщения',
      cannotMessageAdult: 'Вы не можете общаться с пользователями старше 14 лет',
      group: 'Группа', channel: 'Канал',
      participants: 'участников', subscribers: 'подписчиков',
      noContacts: 'Нет контактов', noChats: 'Нет чатов',
      media: 'Медиа', links: 'Ссылки', voice: 'Голосовые',
      files: 'Файлы', members: 'Участники',
      join: 'Вступить', leave: 'Покинуть',
      admin: 'админ', pin: 'Закрепить', unpin: 'Открепить',
      theme: 'Тема оформления', language: 'Язык интерфейса',
      darkTheme: 'Тёмная', lightTheme: 'Светлая',
      deleteAccount: 'Удалить аккаунт', changePassword: 'Сменить пароль',
      blockedList: 'Чёрный список', security: 'Безопасность',
      privacy: 'Приватность', whoSeeEmail: 'Кто видит мою почту',
      whoSeeStatus: 'Кто видит мой статус', whoCanInvite: 'Кто может пригласить меня',
      all: 'Все', nobody: 'Никто', contactsOnly: 'Контакты',
      call: 'Звонок', audioCall: 'Аудиозвонок', videoCall: 'Видеозвонок',
      incomingCall: 'Входящий звонок', accept: 'Принять', decline: 'Отклонить',
      callEnded: 'Звонок завершён', missedCall: 'Пропущенный звонок',
      bio: 'О себе', save: 'Сохранить', cancel: 'Закрыть',
      username: '@username', email: 'Email', name: 'Имя',
      firstName: 'Имя', lastName: 'Фамилия', password: 'Пароль',
      login: 'Войти', register: 'Регистрация',
      noAccount: 'Нет аккаунта?', haveAccount: 'Уже есть аккаунт?',
      createAccount: 'Создать аккаунт', welcome: 'Добро пожаловать обратно',
      registration: 'Создайте аккаунт за минуту',
      verifyEmail: 'Подтвердите Email', check: 'Проверить',
      resend: 'Отправить повторно', logout: 'Выйти',
      dailyBonus: 'Ежедневный бонус', linkoins: 'Линкоинов',
      shop: 'Магазин тем', buy: 'Купить', purchased: 'Куплено',
      price: 'цена', balance: 'Баланс'
    },
    en: {
      chats: 'Chats', contacts: 'Contacts', settings: 'Settings',
      newChat: 'New chat', search: 'Search...', clearSearch: '✕',
      compose: '✏️', online: 'online', typing: 'typing...',
      you: 'You', messagePlaceholder: 'Write a message…',
      send: '➤', reply: 'Reply', forward: 'Forward',
      edit: 'Edit', delete: 'Delete', copy: 'Copy',
      deleteMsg: 'Delete message?', msgDeleted: 'Message deleted',
      msgCopied: 'Copied', msgEdited: 'edited',
      emptyChat: 'No messages. Write first!',
      chooseChat: 'Choose a chat', startChat: 'Start chatting right now',
      archived: 'Archive', unread: 'Unread',
      blocked: 'Blocked', youBlocked: 'You blocked this user',
      parent: 'Parent', childAccount: 'Child account',
      voiceNotAllowed: 'Child accounts cannot send voice messages',
      cannotMessageAdult: 'You cannot message users over 14',
      group: 'Group', channel: 'Channel',
      participants: 'participants', subscribers: 'subscribers',
      noContacts: 'No contacts', noChats: 'No chats',
      media: 'Media', links: 'Links', voice: 'Voice',
      files: 'Files', members: 'Members',
      join: 'Join', leave: 'Leave',
      admin: 'admin', pin: 'Pin', unpin: 'Unpin',
      theme: 'Theme', language: 'Language',
      darkTheme: 'Dark', lightTheme: 'Light',
      deleteAccount: 'Delete account', changePassword: 'Change password',
      blockedList: 'Blocked list', security: 'Security',
      privacy: 'Privacy', whoSeeEmail: 'Who can see my email',
      whoSeeStatus: 'Who can see my status', whoCanInvite: 'Who can invite me',
      all: 'All', nobody: 'Nobody', contactsOnly: 'Contacts',
      call: 'Call', audioCall: 'Audio call', videoCall: 'Video call',
      incomingCall: 'Incoming call', accept: 'Accept', decline: 'Decline',
      callEnded: 'Call ended', missedCall: 'Missed call',
      bio: 'About', save: 'Save', cancel: 'Cancel',
      username: '@username', email: 'Email', name: 'Name',
      firstName: 'First name', lastName: 'Last name', password: 'Password',
      login: 'Login', register: 'Register',
      noAccount: 'No account?', haveAccount: 'Already have an account?',
      createAccount: 'Create account', welcome: 'Welcome back',
      registration: 'Create an account in a minute',
      verifyEmail: 'Verify Email', check: 'Check',
      resend: 'Resend', logout: 'Logout',
      dailyBonus: 'Daily bonus', linkoins: 'Linkoins',
      shop: 'Theme shop', buy: 'Buy', purchased: 'Purchased',
      price: 'price', balance: 'Balance'
    },
    ar: {
      chats: 'المحادثات', contacts: 'جهات الاتصال', settings: 'الإعدادات',
      newChat: 'محادثة جديدة', search: 'بحث...', clearSearch: '✕',
      compose: '✏️', online: 'متصل', typing: 'يكتب...',
      you: 'أنت', messagePlaceholder: 'اكتب رسالة…',
      send: '➤', reply: 'رد', forward: 'إعادة توجيه',
      edit: 'تعديل', delete: 'حذف', copy: 'نسخ',
      deleteMsg: 'حذف الرسالة؟', msgDeleted: 'تم حذف الرسالة',
      msgCopied: 'تم النسخ', msgEdited: 'مُعدَّل',
      emptyChat: 'لا توجد رسائل. اكتب أولاً!',
      chooseChat: 'اختر محادثة', startChat: 'ابدأ الدردشة الآن',
      archived: 'الأرشيف', unread: 'غير مقروء',
      blocked: 'محظور', youBlocked: 'لقد حظرت هذا المستخدم',
      parent: 'ولي الأمر', childAccount: 'حساب الطفل',
      voiceNotAllowed: 'حسابات الأطفال لا يمكنها إرسال رسائل صوتية',
      cannotMessageAdult: 'لا يمكنك مراسلة مستخدمين أكبر من 14 عامًا',
      group: 'مجموعة', channel: 'قناة',
      participants: 'مشارك', subscribers: 'مشترك',
      noContacts: 'لا توجد جهات اتصال', noChats: 'لا توجد محادثات',
      media: 'الوسائط', links: 'الروابط', voice: 'الصوت',
      files: 'الملفات', members: 'الأعضاء',
      join: 'انضمام', leave: 'مغادرة',
      admin: 'مشرف', pin: 'تثبيت', unpin: 'إلغاء التثبيت',
      theme: 'المظهر', language: 'اللغة',
      darkTheme: 'داكن', lightTheme: 'فاتح',
      deleteAccount: 'حذف الحساب', changePassword: 'تغيير كلمة المرور',
      blockedList: 'قائمة الحظر', security: 'الأمان',
      privacy: 'الخصوصية', whoSeeEmail: 'من يمكنه رؤية بريدي الإلكتروني',
      whoSeeStatus: 'من يمكنه رؤية حالتي', whoCanInvite: 'من يمكنه دعوتي',
      all: 'الجميع', nobody: 'لا أحد', contactsOnly: 'جهات الاتصال فقط',
      call: 'مكالمة', audioCall: 'مكالمة صوتية', videoCall: 'مكالمة فيديو',
      incomingCall: 'مكالمة واردة', accept: 'قبول', decline: 'رفض',
      callEnded: 'انتهت المكالمة', missedCall: 'مكالمة فائتة',
      bio: 'نبذة', save: 'حفظ', cancel: 'إلغاء',
      username: '@username', email: 'البريد الإلكتروني', name: 'الاسم',
      firstName: 'الاسم الأول', lastName: 'الاسم الأخير', password: 'كلمة المرور',
      login: 'تسجيل الدخول', register: 'تسجيل',
      noAccount: 'لا تملك حسابًا؟', haveAccount: 'لديك حساب بالفعل؟',
      createAccount: 'إنشاء حساب', welcome: 'مرحبًا بعودتك',
      registration: 'أنشئ حسابًا في دقيقة',
      verifyEmail: 'تأكيد البريد الإلكتروني', check: 'تحقق',
      resend: 'إعادة إرسال', logout: 'تسجيل الخروج',
      dailyBonus: 'المكافأة اليومية', linkoins: 'لينكوين',
      shop: 'متجر المظاهر', buy: 'شراء', purchased: 'تم الشراء',
      price: 'السعر', balance: 'الرصيد'
    }
  };

  let currentLang = localStorage.getItem('ui_lang') || 'ru';

  // Функция перевода
  window.t = function(key) {
    return (translations[currentLang] && translations[currentLang][key]) || key;
  };

  // Применить язык ко всем динамическим элементам интерфейса
  function applyLanguageToUI() {
    // Навигация
    document.querySelectorAll('.nav-btn[data-tab="chats"] .nav-label').forEach(el => el.textContent = t('chats'));
    document.querySelectorAll('.nav-btn[data-tab="contacts"] .nav-label').forEach(el => el.textContent = t('contacts'));
    document.querySelectorAll('.nav-btn[data-tab="settings"] .nav-label').forEach(el => el.textContent = t('settings'));

    // Заголовок страницы чатов
    const hdrTitle = document.querySelector('#page-chats .hdr-title');
    if (hdrTitle) hdrTitle.textContent = 'NexLink'; // можно не переводить

    // Поле поиска
    const chatSearch = document.getElementById('chat-search');
    if (chatSearch) chatSearch.placeholder = t('search');

    // Кнопка создания чата (если есть)
    const composeBtn = document.getElementById('compose-btn');
    if (composeBtn) composeBtn.title = t('newChat');

    // Плейсхолдер сообщений
    const msgInput = document.getElementById('msg-input');
    if (msgInput) msgInput.placeholder = t('messagePlaceholder');

    // Кнопка отправки
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) sendBtn.textContent = t('send');

    // Заголовок пустого чата (если есть)
    const emptyMsg = document.querySelector('.empty-msgs-text');
    if (emptyMsg) emptyMsg.textContent = t('emptyChat');

    // Плейсхолдер пустого чата (если есть)
    const emptyChatDiv = document.getElementById('empty-chat-placeholder');
    if (emptyChatDiv) {
      const titleEl = emptyChatDiv.querySelector('.empty-chat-text');
      const subEl = emptyChatDiv.querySelector('.empty-chat-sub');
      if (titleEl) titleEl.textContent = t('chooseChat');
      if (subEl) subEl.textContent = t('startChat');
    }

    // Настройки (частично обновятся после перерисовки)
    const settingsTitle = document.querySelector('#page-settings .hdr-title');
    if (settingsTitle) settingsTitle.textContent = t('settings');

    // Контекстное меню (если открыто)
    const ctxItems = document.querySelectorAll('#ctx-menu-sheet .ctx-item, #ctx-menu .ctx-item');
    ctxItems.forEach(item => {
      const action = item.dataset.action || item.textContent;
      if (action === 'reply') item.textContent = t('reply');
      else if (action === 'forward') item.textContent = t('forward');
      else if (action === 'edit') item.textContent = t('edit');
      else if (action === 'delete') item.textContent = t('delete');
      else if (action === 'copy') item.textContent = t('copy');
    });

    // Обновим все динамические метки (например, в модалках)
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      if (key) el.textContent = t(key);
    });

    // Перерисуем список чатов и сообщения, чтобы подхватить переводы статусов и т.д.
    if (typeof renderChatList === 'function') renderChatList();
    if (typeof renderMessages === 'function' && allMessages && allMessages.length) renderMessages();
    if (typeof updateChatHeaderWithProfile === 'function') updateChatHeaderWithProfile();
  }

  // Функция смены языка
  window.setUILanguage = function(lang) {
    if (!translations[lang]) return;
    currentLang = lang;
    localStorage.setItem('ui_lang', lang);
    applyLanguageToUI();
    // Обновим настройки
    if (typeof renderSettings === 'function') renderSettings();
    showToast(t('language') + ': ' + lang.toUpperCase());
  };

  // Модифицируем встроенные функции, чтобы они использовали t()

  // 1. renderChatList – добавим перевод разделителей "Архив", "Непрочитанные"
  const origRenderChatList = renderChatList;
  renderChatList = function(filter) {
    origRenderChatList.call(this, filter);
    // Переведём разделители
    document.querySelectorAll('.chat-divider').forEach(div => {
      if (div.textContent.trim() === 'Архив' || div.textContent.trim() === 'Archive' || div.textContent.trim() === 'الأرشيف') {
        div.textContent = t('archived');
      } else if (div.textContent.trim() === 'Непрочитанные' || div.textContent.trim() === 'Unread' || div.textContent.trim() === 'غير مقروء') {
        div.textContent = t('unread');
      }
    });
    // Обновим плейсхолдер "Нет чатов", если есть
    const noChatsEl = document.querySelector('#chat-list .empty-msgs-text');
    if (noChatsEl) noChatsEl.textContent = t('noChats');
  };

  // 2. renderMessages – статусы "в сети", "печатает" и т.д. уже обновляются через updateChatHeaderWithProfile,
  //    но добавим перевод системных сообщений (isCallEvent, isDeleted)
  const origRenderMessages = renderMessages;
  renderMessages = function() {
    origRenderMessages.call(this);
    // Переведём системные сообщения
    document.querySelectorAll('.bubble-text').forEach(bubble => {
      // Заменяем текст, если это системное сообщение
      if (bubble.textContent.includes('Звонок') || bubble.textContent.includes('Call') || bubble.textContent.includes('مكالمة')) {
        // Оставим как есть, т.к. это динамическое сообщение
      }
    });
    // Обновим "Нет сообщений"
    const emptyMsgEl = document.querySelector('.empty-msgs-text');
    if (emptyMsgEl) emptyMsgEl.textContent = t('emptyChat');
  };

  // 3. updateChatHeaderWithProfile – статусы и "печатает"
  const origUpdateChatHeader = updateChatHeaderWithProfile;
  updateChatHeaderWithProfile = function() {
    origUpdateChatHeader.call(this);
    const statusEl = document.getElementById('chat-hdr-status');
    if (statusEl) {
      // Если статус содержит "печатает" – обновим
      if (statusEl.innerHTML.includes('печатает') || statusEl.innerHTML.includes('typing') || statusEl.innerHTML.includes('يكتب')) {
        // Оставим анимацию, но текст заменим
        const typingDots = '<span class="typing-dots"><span></span><span></span><span></span></span>';
        statusEl.innerHTML = t('typing') + ' ' + typingDots;
      } else if (statusEl.textContent === 'в сети' || statusEl.textContent === 'online' || statusEl.textContent === 'متصل') {
        statusEl.textContent = t('online');
      } else if (statusEl.textContent === 'Заблокирован' || statusEl.textContent === 'Blocked' || statusEl.textContent === 'محظور') {
        statusEl.textContent = t('blocked');
      }
    }
  };

  // 4. renderSettings – добавим переводы пунктов настроек
  const origRenderSettings = renderSettings;
  renderSettings = function() {
    origRenderSettings.call(this);
    // Переведём статические пункты (добавим data-i18n в настройках, где возможно, но сейчас просто обновим принудительно)
    const settingsBody = document.getElementById('settings-body');
    if (!settingsBody) return;
    // Пройдёмся по всем элементам настроек и обновим известные ключи
    settingsBody.querySelectorAll('.si-text').forEach(el => {
      const text = el.textContent.trim();
      // Сопоставим с ключами (упрощённо)
      if (text === 'Мой профиль' || text === 'My Profile' || text === 'الملف الشخصي') el.textContent = t('profile');
      else if (text === 'Новая группа' || text === 'New group' || text === 'مجموعة جديدة') el.textContent = t('newGroup');
      // и т.д. – для полного покрытия лучше использовать data-i18n, но для демонстрации оставим базовые
    });
    // Обновим название языка
    const langSelect = document.getElementById('ui-lang-select');
    if (langSelect) langSelect.value = currentLang;
  };

  // Инициализация: применяем язык при загрузке
  applyLanguageToUI();

  // Подключаем смену языка из настроек (добавим обработчик, если еще не добавлен)
  document.addEventListener('change', function(e) {
    if (e.target.id === 'ui-lang-select') {
      setUILanguage(e.target.value);
    }
  });

  // Расширим существующую функцию добавления языка в настройках (если она есть)
  // чтобы использовала t() для меток
  const origAddLangSetting = window.addLanguageSetting;
  window.addLanguageSetting = function() {
    if (origAddLangSetting) origAddLangSetting();
    const langSelect = document.getElementById('ui-lang-select');
    if (langSelect) {
      langSelect.value = currentLang;
    }
  };

  console.log('✅ Полная мультиязычность активирована (' + currentLang + ')');
})();
// ============================================================
//  ПРОФЕССИОНАЛЬНЫЕ ИКОНКИ (FONT AWESOME) ВМЕСТО СМАЙЛИКОВ
// ============================================================
(function() {
  // 1. Подключаем Font Awesome (бесплатная версия)
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css';
  document.head.appendChild(link);

  // 2. Карта соответствия: эмодзи → класс Font Awesome
  // (иконки подобраны максимально близко по смыслу)
  const ICON_MAP = {
    '🔒': 'fa-lock',          // безопасность
    '✏️': 'fa-pen',           // редактирование
    '🗑️': 'fa-trash',         // удаление
    '📁': 'fa-folder',        // папка
    '👤': 'fa-user',          // профиль
    '💬': 'fa-comment-dots',  // чаты
    '⚙️': 'fa-gear',          // настройки
    '📞': 'fa-phone',         // звонок
    '🎙️': 'fa-microphone',   // голосовое
    '🎨': 'fa-palette',       // темы / стикеры
    '📎': 'fa-paperclip',     // вложение
    '📢': 'fa-bullhorn',      // канал
    '👥': 'fa-users',         // группа
    '➤': 'fa-arrow-right',    // отправка
    '←': 'fa-arrow-left',     // назад
    '✕': 'fa-xmark',          // закрыть
    '✅': 'fa-check',         // галочка
    '➕': 'fa-plus',           // добавить
    '➖': 'fa-minus',          // удалить
    '🔍': 'fa-search',        // поиск
    '📧': 'fa-envelope',      // email
    '🟢': 'fa-circle',        // онлайн (зелёный)
    '🔐': 'fa-lock',          // 2FA
    '🖥️': 'fa-desktop',       // ПК
    '🌍': 'fa-globe',         // язык
    '☀️': 'fa-sun',           // погода
    '📝': 'fa-pen-to-square', // заметки
    '⏱️': 'fa-clock',         // таймер
    '🔢': 'fa-calculator',    // калькулятор
    '📅': 'fa-calendar',      // календарь
    '🧩': 'fa-puzzle-piece',  // приложения
    '📸': 'fa-camera',        // камера
    '🎤': 'fa-microphone',    // микрофон
    '🔇': 'fa-microphone-slash', // микрофон выкл
    '📷': 'fa-camera',        // камера
    '🚫': 'fa-ban',           // запрет
    '🔓': 'fa-unlock',        // разблокировать
    '⏺️': 'fa-circle',        // запись (красный)
    '🌫️': 'fa-blur',          // размытие (нет точного, используем fa-eye-slash)
    '📹': 'fa-video',         // видео
    '☺': 'fa-smile',          // улыбка (для аватаров)
   '🛠️': 'fa-tools',           // техподдержка
  '↩️': 'fa-reply',            // ответить
  '📤': 'fa-share',            // переслать (или fa-forward)
  '📋': 'fa-copy',             // скопировать
  'ℹ️': 'fa-circle-info',      // о приложении
  '🌀': 'fa-spinner',          // уменьшить анимации (или fa-circle-notch)
  '🔑': 'fa-key',              // сменить пароль
  '🚪': 'fa-right-from-bracket', // выйти (fa-sign-out-alt)
  '💾': 'fa-save',             // сохранить
  '📥': 'fa-download',         // загрузить / входящие
  '📤': 'fa-upload',           // отправить / исходящие
  '📌': 'fa-thumbtack',        // закрепить
  '🔊': 'fa-volume-high',      // громкость
  '🔇': 'fa-volume-xmark',     // без звука
  '⏹️': 'fa-stop',            // стоп
  '▶️': 'fa-play',             // воспроизведение
  '⏸️': 'fa-pause',           // пауза
  '🖼️': 'fa-media',           // пауза
  '🔗': 'fa-ыss',           // пауза
};


  // Функция, которая заменяет эмодзи в текстовом узле на HTML-иконку
  function replaceEmojiWithIcon(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      let text = node.textContent;
      let anyReplaced = false;
      let result = '';
      // Разбиваем текст на части и заменяем эмодзи
      for (const [emoji, iconClass] of Object.entries(ICON_MAP)) {
        if (text.includes(emoji)) {
          // Создаём span с иконкой
          const parts = text.split(emoji);
          const fragment = document.createDocumentFragment();
          for (let i = 0; i < parts.length; i++) {
            if (i > 0) {
              const iconSpan = document.createElement('span');
              iconSpan.className = `fas ${iconClass}`;
              iconSpan.setAttribute('aria-hidden', 'true');
              fragment.appendChild(iconSpan);
            }
            if (parts[i]) {
              fragment.appendChild(document.createTextNode(parts[i]));
            }
          }
          // Заменяем текущий узел на фрагмент
          node.parentNode.replaceChild(fragment, node);
          anyReplaced = true;
          break; // после первой замены выходим (чтобы избежать бесконечности)
        }
      }
      // Если не нашли ни одного совпадения, оставляем как есть
      if (!anyReplaced) return;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // Пропускаем элементы, которые не должны обрабатываться (input, textarea, select)
      if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT') return;
      if (node.classList && (node.classList.contains('fas') || node.classList.contains('far') || node.classList.contains('fab'))) return; // уже иконка
      // Обходим дочерние узлы рекурсивно
      node.childNodes.forEach(child => replaceEmojiWithIcon(child));
    }
  }

  // Запускаем замену для всего документа
  function applyIcons() {
    // Создаём копию списка childNodes, чтобы избежать проблем с живыми коллекциями
    const children = Array.from(document.body.childNodes);
    children.forEach(child => replaceEmojiWithIcon(child));
  }

  // Ждём загрузки Font Awesome, затем применяем
  link.onload = function() {
    applyIcons();
    // Наблюдаем за изменениями DOM, чтобы заменять новые элементы
    const observer = new MutationObserver(mutations => {
      let needsUpdate = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
              needsUpdate = true;
              break;
            }
          }
        } else if (mutation.type === 'characterData') {
          needsUpdate = true;
          break;
        }
      }
      if (needsUpdate) applyIcons();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  };

  // Если Font Awesome уже загружен, применяем сразу
  if (document.querySelector('link[href*="font-awesome"]')) {
    applyIcons();
  }

  console.log('✅ Иконки Font Awesome применены');
})();
// Переопределяем сохранение профиля с оптимизацией
const originalSaveProfile = document.getElementById('save-profile-btn')?.onclick;
if (originalSaveProfile) {
  document.getElementById('save-profile-btn').onclick = async function(e) {
    const btn = this;
    btn.textContent = '⏳ Сохранение...';
    btn.disabled = true;

    const fn = document.getElementById('prof-first').value.trim();
    if (!fn) { showToast('Введите имя'); btn.textContent = 'Сохранить'; btn.disabled = false; return; }
    const ln = document.getElementById('prof-last').value.trim();
    const avatar = profAvatar || myProfile?.avatar || '😊';

    try {
      // 1. Обновляем данные в Firestore
      await setDoc(doc(db, 'users', me.uid), {
        firstName: fn,
        lastName: ln,
        name: fn + (ln ? ' ' + ln : ''),
        avatar: avatar
      }, { merge: true });

      // 2. Обновляем локальный кэш (myProfile)
      if (myProfile) {
        myProfile.firstName = fn;
        myProfile.lastName = ln;
        myProfile.name = fn + (ln ? ' ' + ln : '');
        myProfile.avatar = avatar;
      }

      // 3. Обновляем кэш пользователей (только этого пользователя)
      usersCache.set(me.uid, { ...usersCache.get(me.uid), firstName: fn, lastName: ln, name: fn + (ln ? ' ' + ln : ''), avatar: avatar });

      // 4. Перерисовываем только шапку и список чатов (без полной перезагрузки)
      updateChatHeaderWithProfile();
      renderChatList(); // обновит отображение имени в списке
      // Обновляем профиль в настройках (только ту часть, что видна)
      const profName = document.querySelector('#settings-body .profile-name');
      if (profName) profName.textContent = fn + (ln ? ' ' + ln : '');
      const profAvatarEl = document.querySelector('#settings-body .profile-av');
      if (profAvatarEl) profAvatarEl.innerHTML = avatarHtml(avatar);
      const profUname = document.querySelector('#settings-body .profile-uname');
      if (profUname) profUname.textContent = myProfile?.username || '';

      showToast('✅ Профиль сохранён');
      closeModal('modal-profile');
    } catch (e) {
      showToast('❌ Ошибка сохранения: ' + e.message);
    } finally {
      btn.textContent = 'Сохранить';
      btn.disabled = false;
    }
  };
}
// ============================================================
//  УНИВЕРСАЛЬНЫЙ ОБРАБОТЧИК ОШИБОК FIREBASE
// ============================================================
(function() {
  // Карта ошибок Firebase → человеческие сообщения
  const ERROR_MESSAGES = {
    // Auth
    'auth/user-not-found': 'Пользователь с таким email не найден.',
    'auth/wrong-password': 'Неверный пароль. Попробуйте снова.',
    'auth/email-already-in-use': 'Этот email уже зарегистрирован. Войдите или используйте другой.',
    'auth/invalid-email': 'Некорректный email. Проверьте правильность ввода.',
    'auth/weak-password': 'Пароль слишком слабый. Используйте минимум 6 символов.',
    'auth/network-request-failed': 'Ошибка сети. Проверьте подключение к интернету.',
    'auth/too-many-requests': 'Слишком много попыток. Подождите немного и попробуйте снова.',
    'auth/user-disabled': 'Этот аккаунт заблокирован. Обратитесь в поддержку.',
    'auth/operation-not-allowed': 'Данный способ входа отключён. Обратитесь в поддержку.',
    'auth/requires-recent-login': 'Требуется повторный вход. Выйдите и зайдите заново.',
    'auth/credential-already-in-use': 'Этот аккаунт уже привязан к другому пользователю.',
    'auth/account-exists-with-different-credential': 'Аккаунт уже существует. Войдите через другой способ.',
    'auth/provider-already-linked': 'Этот способ входа уже привязан к аккаунту.',
    'auth/invalid-verification-code': 'Неверный код подтверждения. Проверьте правильность.',
    'auth/invalid-verification-id': 'Сессия подтверждения истекла. Запросите код заново.',

    // Firestore
    'permission-denied': 'Недостаточно прав для выполнения этого действия.',
    'unavailable': 'Сервис временно недоступен. Попробуйте позже.',
    'not-found': 'Запрашиваемые данные не найдены.',
    'already-exists': 'Такой документ уже существует.',
    'resource-exhausted': 'Превышен лимит запросов. Подождите.',
    'failed-precondition': 'Операция невозможна в текущем состоянии.',
    'aborted': 'Операция прервана. Попробуйте снова.',
    'out-of-range': 'Выход за допустимые границы.',
    'unimplemented': 'Функция ещё не реализована.',
    'internal': 'Внутренняя ошибка сервера. Попробуйте позже.',
    'data-loss': 'Потеря данных. Обратитесь в поддержку.',
    'unauthenticated': 'Требуется авторизация. Войдите заново.',

    // Общие
    'network-error': 'Ошибка сети. Проверьте подключение к интернету.',
    'timeout': 'Превышено время ожидания. Попробуйте снова.',
    'canceled': 'Операция отменена.',
    'unknown': 'Произошла неизвестная ошибка. Попробуйте позже.',
  };

  // Основная функция обработки ошибок
  window.handleFirebaseError = function(error) {
    if (!error) return 'Неизвестная ошибка';
    
    // Если это объект с message, извлекаем код
    let code = error.code || error.message || '';
    // Если пришла строка, используем её
    if (typeof error === 'string') {
      // Пытаемся извлечь код из строки (например, "FirebaseError: auth/email-already-in-use")
      const match = error.match(/auth\/([a-z-]+)/) || error.match(/firestore\/([a-z-]+)/);
      if (match) code = match[0];
      else return error; // если не удалось, возвращаем как есть
    }
    
    // Ищем сообщение в карте
    const message = ERROR_MESSAGES[code] || ERROR_MESSAGES['unknown'];
    return message;
  };

  // Функция для показа ошибки в toast или в указанном элементе
  window.showError = function(error, elementId) {
    const message = handleFirebaseError(error);
    if (elementId) {
      const el = document.getElementById(elementId);
      if (el) {
        el.textContent = message;
        el.classList.add('show');
        return;
      }
    }
    if (typeof showToast === 'function') {
      showToast('❌ ' + message);
    } else {
      alert('Ошибка: ' + message);
    }
  };

  // Переопределяем стандартный catch для упрощения
  console.log('✅ Обработчик ошибок Firebase активирован');
})();
// ════════════════════════════════════════════════════════════════
//  ГОЛОСОВЫЕ СООБЩЕНИЯ — ФИНАЛЬНАЯ ВЕРСИЯ (ЗАМЕНЯЕТ ВСЕ ПРЕДЫДУЩИЕ)
// ════════════════════════════════════════════════════════════════
(function() {
  // ---- Находим или создаём необходимые элементы ----
  const inputWrap = document.querySelector('#input-bar .input-wrap');
  if (!inputWrap) return;

  // Удаляем старые кнопки голоса, если есть
  const oldVoiceBtn = document.getElementById('voice-btn');
  if (oldVoiceBtn) oldVoiceBtn.remove();

  // Создаём новую кнопку
  const voiceBtn = document.createElement('button');
  voiceBtn.id = 'voice-btn';
  voiceBtn.className = 'ib-btn';
  voiceBtn.textContent = '🎙️';
  voiceBtn.title = 'Голосовое сообщение (зажмите для записи)';

  // Вставляем перед кнопкой emoji (или в конец input-wrap)
  const emojiBtn = document.getElementById('emoji-btn');
  if (emojiBtn) {
    inputWrap.insertBefore(voiceBtn, emojiBtn);
  } else {
    inputWrap.appendChild(voiceBtn);
  }

  // ---- Создаём индикатор записи (если отсутствует) ----
  let indicator = document.getElementById('voice-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'voice-indicator';
    indicator.innerHTML = `
      <span class="mic-icon">🎙️</span>
      <span class="timer">00:00</span>
      <span style="font-size:13px;">Запись...</span>
    `;
    document.body.appendChild(indicator);
  }
  const timerEl = indicator.querySelector('.timer');

  // ---- Создаём панель предпрослушивания (если отсутствует) ----
  let preview = document.getElementById('voice-preview');
  if (!preview) {
    preview = document.createElement('div');
    preview.id = 'voice-preview';
    preview.innerHTML = `
      <div class="vp-player">
        <audio id="vp-audio"></audio>
        <div class="vp-controls">
          <span class="vp-play-btn" id="vp-play">▶️</span>
          <div class="vp-progress" id="vp-progress">
            <div class="vp-progress-fill" id="vp-progress-fill"></div>
          </div>
          <span class="vp-time" id="vp-time">0:00</span>
        </div>
      </div>
      <div class="vp-actions">
        <button class="vp-send-btn" id="vp-send">Отправить</button>
        <button class="vp-del-btn" id="vp-del">✕</button>
      </div>
    `;
    const inputBar = document.getElementById('input-bar');
    if (inputBar) inputBar.parentNode.insertBefore(preview, inputBar);
  }

  // Получаем элементы панели
  const vpAudio = document.getElementById('vp-audio');
  const vpPlay = document.getElementById('vp-play');
  const vpProgress = document.getElementById('vp-progress');
  const vpProgressFill = document.getElementById('vp-progress-fill');
  const vpTime = document.getElementById('vp-time');
  const vpSend = document.getElementById('vp-send');
  const vpDel = document.getElementById('vp-del');

  // ---- Состояние ----
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingStart = 0;
  let voiceBlobURL = null;
  let recordingTimer = null;
  let isRecording = false;
  let isPressed = false;

  // ---- Вспомогательные функции ----
  function cleanupRecording() {
    if (mediaRecorder) {
      if (mediaRecorder.state === 'recording') mediaRecorder.stop();
      mediaRecorder = null;
    }
    if (voiceBlobURL) {
      URL.revokeObjectURL(voiceBlobURL);
      voiceBlobURL = null;
    }
    audioChunks = [];
    clearInterval(recordingTimer);
    voiceBtn.classList.remove('recording');
    indicator.classList.remove('show');
    isRecording = false;
    isPressed = false;
  }

  function showToastMsg(msg) {
    if (typeof showToast === 'function') showToast(msg);
    else alert(msg);
  }

  // ---- Основная логика записи ----
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        const duration = (Date.now() - recordingStart) / 1000;

        if (blob.size > 0 && duration >= 1) {
          voiceBlobURL = URL.createObjectURL(blob);
          // Загружаем в плеер
          vpAudio.src = voiceBlobURL;
          vpAudio.load();
          preview.classList.add('show');
          vpPlay.textContent = '▶️';
          vpProgressFill.style.width = '0%';
          vpTime.textContent = '0:00';
          // При загрузке обновим время
          vpAudio.addEventListener('loadedmetadata', () => {
            const total = vpAudio.duration || 0;
            const m = Math.floor(total / 60);
            const s = Math.floor(total % 60);
            vpTime.textContent = `${m}:${String(s).padStart(2, '0')}`;
          }, { once: true });
        } else if (duration < 1) {
          showToastMsg('Запись слишком короткая (минимум 1 секунда)');
        } else {
          showToastMsg('Ошибка записи');
        }

        stream.getTracks().forEach(t => t.stop());
        voiceBtn.classList.remove('recording');
        indicator.classList.remove('show');
        clearInterval(recordingTimer);
        isRecording = false;
        isPressed = false;
      };

      mediaRecorder.start();
      recordingStart = Date.now();
      isRecording = true;
      voiceBtn.classList.add('recording');
      indicator.classList.add('show');
      timerEl.textContent = '00:00';

      recordingTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStart) / 1000);
        if (elapsed >= 60) {
          // Ограничение 60 секунд
          if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
          }
          return;
        }
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        timerEl.textContent = `${mins}:${secs}`;
      }, 100);

    } catch (err) {
      showToastMsg('❌ Нет доступа к микрофону');
      console.error('Ошибка микрофона:', err);
      cleanupRecording();
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    } else {
      cleanupRecording();
    }
    isPressed = false;
  }

  // ---- Обработчики для мыши (ПК) ----
  voiceBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (isRecording) return;
    isPressed = true;
    startRecording();
  });

  voiceBtn.addEventListener('mouseup', (e) => {
    e.preventDefault();
    if (!isPressed) return;
    if (isRecording) stopRecording();
  });

  voiceBtn.addEventListener('mouseleave', () => {
    if (isPressed && isRecording) {
      stopRecording();
    }
  });

  // ---- Обработчики для тача (телефоны) ----
  voiceBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (isRecording) return;
    isPressed = true;
    startRecording();
  }, { passive: false });

  voiceBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (!isPressed) return;
    if (isRecording) stopRecording();
  }, { passive: false });

  voiceBtn.addEventListener('touchcancel', (e) => {
    e.preventDefault();
    if (isPressed && isRecording) {
      stopRecording();
    }
  }, { passive: false });

  // ---- Плеер предпрослушивания ----
  let isPlaying = false;
  vpPlay.addEventListener('click', () => {
    if (vpAudio.paused) {
      vpAudio.play();
      vpPlay.textContent = '⏸️';
      isPlaying = true;
    } else {
      vpAudio.pause();
      vpPlay.textContent = '▶️';
      isPlaying = false;
    }
  });

  vpAudio.addEventListener('timeupdate', () => {
    const pct = (vpAudio.currentTime / vpAudio.duration) * 100;
    vpProgressFill.style.width = `${isNaN(pct) ? 0 : pct}%`;
    const m = Math.floor(vpAudio.currentTime / 60);
    const s = Math.floor(vpAudio.currentTime % 60);
    vpTime.textContent = `${m}:${String(s).padStart(2, '0')}`;
  });

  vpAudio.addEventListener('ended', () => {
    vpPlay.textContent = '▶️';
    isPlaying = false;
    vpProgressFill.style.width = '0%';
    vpTime.textContent = '0:00';
  });

  vpProgress.addEventListener('click', (e) => {
    const rect = vpProgress.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    if (vpAudio.duration) {
      vpAudio.currentTime = pct * vpAudio.duration;
    }
  });

  // ---- Отправка голосового ----
  vpSend.addEventListener('click', async () => {
    if (!voiceBlobURL) {
      showToastMsg('Нет аудио для отправки');
      return;
    }
    if (!activeChat || !me) {
      showToastMsg('Нет активного чата');
      return;
    }
    const chatId = await getActiveChatId();
    if (!chatId) return;

    try {
      const resp = await fetch(voiceBlobURL);
      const blob = await resp.blob();
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        await addDoc(collection(db, 'messages'), {
          chatId,
          text: `[voice]${reader.result}`,
          timestamp: serverTimestamp(),
          senderUid: me.uid,
          isVoice: true,
          isSticker: false
        });
        showToastMsg('🎙️ Голосовое отправлено');
        preview.classList.remove('show');
        if (voiceBlobURL) URL.revokeObjectURL(voiceBlobURL);
        voiceBlobURL = null;
        vpAudio.src = '';
        cleanupRecording();
      };
    } catch (err) {
      showToastMsg('❌ Ошибка отправки: ' + err.message);
    }
  });

  // ---- Удаление голосового ----
  vpDel.addEventListener('click', () => {
    preview.classList.remove('show');
    if (voiceBlobURL) URL.revokeObjectURL(voiceBlobURL);
    voiceBlobURL = null;
    vpAudio.src = '';
    showToastMsg('Запись удалена');
  });

  // ---- Сброс при смене чата (чтобы панель закрылась) ----
  const origOpenChat = window.openChat;
  if (origOpenChat) {
    window.openChat = async function(chat) {
      // Закрываем панель, если она открыта
      preview.classList.remove('show');
      if (voiceBlobURL) {
        URL.revokeObjectURL(voiceBlobURL);
        voiceBlobURL = null;
      }
      vpAudio.src = '';
      cleanupRecording();
      await origOpenChat(chat);
    };
  }

  console.log('✅ Голосовые сообщения (зажать/отпустить) полностью переработаны и работают');
})();
// ════════════════════════════════════════════════════════════════
//  РАСШИРЕННОЕ КОНТЕКСТНОЕ МЕНЮ ДЛЯ ЧАТОВ В СПИСКЕ
//  (ПКМ / долгое нажатие → изменить имя, заблокировать, удалить)
// ════════════════════════════════════════════════════════════════
(function() {
  // ---- Хранилище кастомных имён чатов ----
  function getChatNames() {
    return myProfile?.chatNames || {};
  }

  async function setChatName(chatId, newName) {
    if (!me) return;
    const chatNames = getChatNames();
    chatNames[chatId] = newName;
    await setDoc(doc(db, 'users', me.uid), { chatNames }, { merge: true });
    if (myProfile) myProfile.chatNames = chatNames;
  }

  function getChatDisplayName(chat) {
    if (!chat) return 'Чат';
    const names = getChatNames();
    const key = chat.type === 'private' ? `private_${chat.id}` : `room_${chat.id}`;
    if (names[key]) return names[key];
    return chat.name || 'Чат';
  }

  // ---- Переопределяем renderChatList для отображения кастомных имён ----
  const origRenderChatList = renderChatList;
  renderChatList = function(filter) {
    // Сохраняем оригинальное поведение
    origRenderChatList.call(this, filter);
    // После отрисовки заменяем отображаемые имена на кастомные (если есть)
    document.querySelectorAll('.chat-row').forEach(row => {
      const chatId = row.dataset.id;
      const chatType = row.dataset.type;
      const chat = chatList.find(c => c.id === chatId && c.type === chatType) ||
                   (window._archivedChats || []).find(c => c.id === chatId && c.type === chatType);
      if (chat) {
        const nameEl = row.querySelector('.cr-name');
        if (nameEl) {
          const displayName = getChatDisplayName(chat);
          nameEl.textContent = displayName;
        }
      }
    });
  };

  // ---- Расширяем showChatCtx (добавляем пункты) ----
  const origShowChatCtx = window.showChatCtx || function(chat) {
    // если функция не определена, создаём заглушку (но она уже есть)
  };

  window.showChatCtx = function(chat) {
    if (!chat) return;
    const items = [];

    // 1. Изменить имя (для всех чатов)
    items.push({
      icon: '✏️',
      label: 'Изменить имя',
      action: 'rename'
    });

    // 2. Заблокировать / разблокировать (только для приватных)
    if (chat.type === 'private') {
      const blocked = myProfile?.blockedUsers?.includes(chat.id) || false;
      items.push({
        icon: blocked ? '🔓' : '🚫',
        label: blocked ? 'Разблокировать' : 'Заблокировать',
        action: 'toggleBlock'
      });
    }

    // 3. Удалить из списка (очистить историю и скрыть)
    items.push({
      icon: '🗑️',
      label: 'Удалить из списка',
      action: 'clearChat',
      danger: true
    });

    // ---- Показываем меню ----
    const ci = document.getElementById('ctx-items');
    if (!ci) return;

    ci.innerHTML = '';
    for (const item of items) {
      const div = document.createElement('div');
      div.className = 'ctx-item' + (item.danger ? ' danger' : '');
      div.innerHTML = `<span class="ctx-icon">${item.icon}</span>${item.label}`;
      div.onclick = async () => {
        closeCtx();
        if (item.action === 'rename') {
          const newName = prompt('Введите новое имя для чата:', getChatDisplayName(chat));
          if (newName && newName.trim()) {
            const key = chat.type === 'private' ? `private_${chat.id}` : `room_${chat.id}`;
            await setChatName(key, newName.trim());
            // Обновить отображение в списке
            renderChatList(document.getElementById('chat-search')?.value || '');
            // Если чат открыт, обновить шапку
            if (activeChat && activeChat.id === chat.id && activeChat.type === chat.type) {
              updateChatHeaderWithProfile();
            }
            showToast('Имя чата изменено');
          }
        } else if (item.action === 'toggleBlock') {
          await toggleBlockUser(chat.id);
          // Обновить список
          renderChatList(document.getElementById('chat-search')?.value || '');
        } else if (item.action === 'clearChat') {
          if (!confirm(`Удалить все сообщения в чате "${getChatDisplayName(chat)}"?`)) return;
          const chatId = await getChatId(chat);
          if (!chatId) return;
          // Удаляем все сообщения с этим chatId
          const msgsSnap = await getDocs(query(collection(db, 'messages'), where('chatId', '==', chatId)));
          const batch = writeBatch(db);
          msgsSnap.docs.forEach(doc => batch.delete(doc.ref));
          await batch.commit();
          showToast('Чат очищен');
          // Если чат открыт, закрываем его
          if (activeChat && activeChat.id === chat.id && activeChat.type === chat.type) {
            stopAllSubs();
            activeChat = null;
            navigateTo('chats');
          }
          // Перестраиваем список
          await buildChatList();
        }
      };
      ci.appendChild(div);
    }

    document.getElementById('ctx-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  // ---- Добавляем обработчик ПКМ (contextmenu) на чаты в списке ----
  function attachContextMenuToChats() {
    document.querySelectorAll('.chat-row').forEach(row => {
      // Удаляем старые обработчики, чтобы не дублировать
      row.removeEventListener('contextmenu', row._ctxHandler);
      const handler = function(e) {
        e.preventDefault();
        const chatId = this.dataset.id;
        const chatType = this.dataset.type;
        const chat = chatList.find(c => c.id === chatId && c.type === chatType) ||
                     (window._archivedChats || []).find(c => c.id === chatId && c.type === chatType);
        if (chat) {
          // Позиционируем меню по месту клика
          // Используем глобальную переменную для координат (как в сообщениях)
          window.lastRightClickEvent = e;
          showChatCtx(chat);
        }
      };
      row.addEventListener('contextmenu', handler);
      row._ctxHandler = handler;
    });
  }

  // ---- Наблюдаем за изменениями списка, чтобы добавлять обработчики ----
  const observer = new MutationObserver(() => {
    attachContextMenuToChats();
  });
  const chatListEl = document.getElementById('chat-list');
  if (chatListEl) {
    observer.observe(chatListEl, { childList: true, subtree: true });
  }

  // ---- Также вызываем при каждом рендере ----
  const origRenderChatListCtx = renderChatList;
  renderChatList = function(filter) {
    origRenderChatListCtx.call(this, filter);
    // После рендера прикрепляем обработчики
    setTimeout(attachContextMenuToChats, 50);
  };

  // ---- Инициализация при загрузке ----
  if (document.readyState === 'complete') {
    attachContextMenuToChats();
  } else {
    document.addEventListener('DOMContentLoaded', attachContextMenuToChats);
  }

  // ---- Переопределяем toggleBlockUser, чтобы она обновляла список ----
  const origToggleBlock = window.toggleBlockUser;
  if (origToggleBlock) {
    window.toggleBlockUser = async function(uid) {
      await origToggleBlock(uid);
      renderChatList(document.getElementById('chat-search')?.value || '');
    };
  }

  // ---- Обновляем заголовок чата при открытии, чтобы показывать кастомное имя ----
  const origUpdateChatHeader = updateChatHeaderWithProfile;
  if (origUpdateChatHeader) {
    updateChatHeaderWithProfile = function() {
      origUpdateChatHeader.call(this);
      if (activeChat) {
        const nameEl = document.getElementById('chat-hdr-name');
        if (nameEl) {
          nameEl.textContent = getChatDisplayName(activeChat);
        }
      }
    };
  }

  console.log('✅ Контекстное меню для чатов (ПКМ/долгое нажатие) с изменением имени, блокировкой и удалением истории активировано');
})();
// ════════════════════════════════════════════════════════════════
//  КРАСИВЫЙ СПЛЕШ-ЭКРАН (динамическая генерация)
// ════════════════════════════════════════════════════════════════
(function() {
  // --- 1. Удаляем старый сплеш, если он есть ---
  const oldSplash = document.getElementById('splash');
  if (oldSplash) oldSplash.remove();

  // --- 2. Создаём новый сплеш ---
  const splash = document.createElement('div');
  splash.id = 'splash';
  splash.innerHTML = `
    <div class="splash-container">
      <div class="splash-ring">
        <i>💬</i>
      </div>
      <div class="splash-title">NexLink</div>
      <div class="splash-sub">Мессенджер нового поколения</div>
      <div class="splash-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  `;
  document.body.prepend(splash); // вставляем в самое начало body

  // --- 3. Добавляем стили для нового сплеша ---
  const style = document.createElement('style');
  style.textContent = `
    /* Сплаш-экран */
    #splash {
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      transition: opacity 0.8s ease, visibility 0.8s ease;
      overflow: hidden;
    }

    #splash::before {
      content: '';
      position: absolute;
      width: 200%;
      height: 200%;
      top: -50%;
      left: -50%;
      background: radial-gradient(circle at 30% 50%, rgba(108, 99, 255, 0.3) 0%, transparent 60%),
                  radial-gradient(circle at 70% 80%, rgba(255, 99, 132, 0.2) 0%, transparent 50%);
      animation: rotateBg 20s linear infinite;
      z-index: 0;
    }

    @keyframes rotateBg {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    #splash.gone {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
    }

    .splash-container {
      position: relative;
      z-index: 2;
      text-align: center;
      animation: splashFadeUp 1.2s ease both;
    }

    .splash-ring {
      width: 120px;
      height: 120px;
      border-radius: 50%;
      background: linear-gradient(135deg, #6C63FF, #8B83FF);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
      box-shadow: 0 0 60px rgba(108, 99, 255, 0.5);
      animation: splashPulse 2s ease-in-out infinite;
      position: relative;
    }

    .splash-ring::after {
      content: '';
      position: absolute;
      inset: -8px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.15);
      animation: splashRing 2s ease-in-out infinite;
    }

    .splash-ring i {
      font-size: 56px;
      color: #fff;
      text-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    }

    .splash-title {
      font-size: 48px;
      font-weight: 800;
      letter-spacing: -1px;
      background: linear-gradient(135deg, #fff, #b8b0ff);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      text-shadow: 0 4px 24px rgba(108, 99, 255, 0.3);
      margin-bottom: 8px;
    }

    .splash-sub {
      color: rgba(255, 255, 255, 0.7);
      font-size: 16px;
      letter-spacing: 0.5px;
      margin-bottom: 32px;
      animation: fadeInUp 1s ease 0.4s both;
    }

    .splash-dots {
      display: flex;
      gap: 12px;
      justify-content: center;
    }

    .splash-dots span {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #6C63FF;
      animation: dotBounce 1.4s ease-in-out infinite both;
    }

    .splash-dots span:nth-child(1) { animation-delay: -0.32s; }
    .splash-dots span:nth-child(2) { animation-delay: -0.16s; }
    .splash-dots span:nth-child(3) { animation-delay: 0s; }

    @keyframes splashFadeUp {
      from { opacity: 0; transform: translateY(30px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes splashPulse {
      0%, 100% { transform: scale(1); box-shadow: 0 0 60px rgba(108,99,255,0.5); }
      50% { transform: scale(1.05); box-shadow: 0 0 80px rgba(108,99,255,0.7); }
    }

    @keyframes splashRing {
      0%, 100% { transform: scale(1); opacity: 0.6; }
      50% { transform: scale(1.4); opacity: 0; }
    }

    @keyframes dotBounce {
      0%, 80%, 100% { transform: scale(0.4); opacity: 0.4; }
      40% { transform: scale(1); opacity: 1; }
    }

    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);

  // --- 4. Переопределяем hideSplash (если уже есть) ---
  window.hideSplash = function() {
    const el = document.getElementById('splash');
    if (el) el.classList.add('gone');
  };

  // Если приложение уже загружено (механизм авторизации отработал),
  // то скрываем сплеш. Иначе он скроется после вызова hideSplash()
  // из основного кода.
  if (document.querySelector('#app:not(.hidden)')) {
    setTimeout(hideSplash, 500);
  }

  console.log('✅ Новый сплеш-экран установлен');
})();
// ════════════════════════════════════════════════════════════════
//  АВТО-ДОБАВЛЕНИЕ ЧАТА И ПРЕДУПРЕЖДЕНИЕ «НЕ В КОНТАКТАХ»
// ════════════════════════════════════════════════════════════════
(function() {
  // Проверяем, есть ли пользователь в контактах
  function isInContacts(uid) {
    if (!myProfile || !myProfile.contacts) return false;
    return myProfile.contacts.includes(uid);
  }

  // ── 1. Авто-появление чата при первом сообщении ──
  // Эта логика уже частично есть в listenForNewChats, но она может не срабатывать,
  // если чат уже существует в кэше, но не в списке. Убедимся, что при получении нового
  // сообщения от незнакомца чат добавляется в список.
  // Мы можем переопределить обработчик onSnapshot для сообщений, но проще добавить слушатель,
  // который будет проверять новые сообщения и добавлять чат, если его нет.
  // Однако текущий код уже имеет listenForNewChats, который добавляет чаты.
  // Проверим, что функция существует и работает.
  // Убедимся, что она добавлена. Для этого переопределим buildChatList, чтобы он всегда включал
  // все чаты из сообщений.

  // ── 2. Показываем предупреждение «Не в контактах» в списке чатов ──
  const origRenderChatList = renderChatList;
  renderChatList = function(filter) {
    origRenderChatList(filter);
    // После рендера добавляем предупреждение для приватных чатов, где собеседник не в контактах
    document.querySelectorAll('.chat-row').forEach(row => {
      const type = row.dataset.type;
      if (type === 'private') {
        const uid = row.dataset.id;
        if (uid && !isInContacts(uid)) {
          // Находим элемент с предпросмотром (cr-preview)
          const preview = row.querySelector('.cr-preview');
          if (preview) {
            // Добавляем текст предупреждения, если его ещё нет
            if (!preview.querySelector('.not-contact-warning')) {
              const warning = document.createElement('span');
              warning.className = 'not-contact-warning';
              warning.style.cssText = 'color: var(--red); font-weight: 600; margin-left: 6px; font-size: 11px;';
              warning.textContent = '⚠️ Не в контактах';
              preview.appendChild(warning);
            }
          }
        }
      }
    });
  };

  // ── 3. Показываем предупреждение в шапке чата ──
  const origUpdateChatHeader = updateChatHeaderWithProfile;
  updateChatHeaderWithProfile = function() {
    origUpdateChatHeader();
    if (activeChat && activeChat.type === 'private') {
      const uid = activeChat.id;
      if (uid && !isInContacts(uid)) {
        const statusEl = document.getElementById('chat-hdr-status');
        if (statusEl) {
          // Добавляем предупреждение в статус, но не затираем онлайн/офлайн
          // Можно добавить отдельную строку или дополнить
          const existingWarning = statusEl.querySelector('.not-contact-warning-header');
          if (!existingWarning) {
            const warning = document.createElement('span');
            warning.className = 'not-contact-warning-header';
            warning.style.cssText = 'display: block; color: var(--red); font-weight: 600; font-size: 12px;';
            warning.textContent = '⚠️ Этот пользователь не в ваших контактах';
            // Вставляем после основного текста, но перед другими элементами
            statusEl.appendChild(warning);
          }
        }
      }
    }
  };

  // ── 4. Добавляем кнопку «Добавить в контакты» в контекстное меню чата ──
  const origShowChatCtx = window.showChatCtx || function() {};
  window.showChatCtx = function(chat) {
    if (typeof origShowChatCtx === 'function') origShowChatCtx(chat);

    // Добавляем пункт "Добавить в контакты" для приватных чатов, где нет контакта
    const ctxItems = document.getElementById('ctx-items');
    if (!ctxItems) return;
    if (!chat || chat.type !== 'private') return;
    if (isInContacts(chat.id)) return;
    // Проверяем, не добавлен ли уже такой пункт
    if (ctxItems.querySelector('[data-action="add-contact"]')) return;

    const div = document.createElement('div');
    div.className = 'ctx-item';
    div.dataset.action = 'add-contact';
    div.innerHTML = `<span class="ctx-icon">➕</span> Добавить в контакты`;
    div.addEventListener('click', async () => {
      closeCtx();
      await setDoc(doc(db, 'users', me.uid), { contacts: arrayUnion(chat.id) }, { merge: true });
      if (myProfile) {
        myProfile.contacts = [...(myProfile.contacts || []), chat.id];
      }
      showToast('Пользователь добавлен в контакты');
      // Обновляем список чатов и шапку, чтобы убрать предупреждение
      renderChatList(document.getElementById('chat-search')?.value || '');
      updateChatHeaderWithProfile();
    });
    ctxItems.appendChild(div);
  };

  // ── 5. Также добавим кнопку «Добавить в контакты» в модальное окно просмотра профиля (уже есть) ──

  console.log('✅ Авто-появление чатов и предупреждение «Не в контактах» активированы');
})();
// ════════════════════════════════════════════════════════════════
//  1. РАМКИ ДЛЯ ВСЕХ КНОПОК (кроме навигационных и служебных)
// ════════════════════════════════════════════════════════════════
(function() {
  const style = document.createElement('style');
  style.textContent = `
    /* Добавляем рамку всем интерактивным элементам, кроме навигации и основных кнопок с градиентом */
    button:not(.nav-btn):not(.auth-btn):not(.send-btn):not(.modal-close):not(.hdr-back):not(.hdr-btn):not(.upv-btn):not(.ci-btn):not(.folder-tab):not(.dropdown-item):not(.app-btn):not(.sticker-tab):not(.vp-send-btn):not(.vp-del-btn):not(.emoji-btn):not(.ib-btn):not(.reply-bar-close):not(.ctx-item):not(.modal-btn) {
      border: 1.5px solid var(--border-medium) !important;
      border-radius: var(--radius-sm) !important;
      background: var(--bg-surface) !important;
      padding: 6px 12px;
      transition: border-color 0.2s, background 0.2s;
    }
    button:not(.nav-btn):not(.auth-btn):not(.send-btn):not(.modal-close):not(.hdr-back):not(.hdr-btn):not(.upv-btn):not(.ci-btn):not(.folder-tab):not(.dropdown-item):not(.app-btn):not(.sticker-tab):not(.vp-send-btn):not(.vp-del-btn):not(.emoji-btn):not(.ib-btn):not(.reply-bar-close):not(.ctx-item):not(.modal-btn):hover {
      border-color: var(--primary) !important;
      background: var(--bg-elevated) !important;
    }
    /* Кнопки с опасным действием (красные) */
    button.danger, button.red {
      border-color: #E74C3C !important;
    }
    button.danger:hover, button.red:hover {
      border-color: #c0392b !important;
      background: #fef2f2 !important;
    }
    /* Основные кнопки (без рамки, сохраняем их стиль) */
    .auth-btn, .send-btn, .upv-btn, .modal-btn, .vp-send-btn, .app-btn {
      border: none !important;
    }
    /* Кнопки в навигации */
    .nav-btn {
      border: none !important;
    }
    /* Кнопки в шапке */
    .hdr-btn, .hdr-back, .modal-close, .reply-bar-close, .ib-btn {
      border: none !important;
    }
    /* Контекстное меню */
    .ctx-item {
      border: none !important;
    }
    /* Вкладки папок */
    .folder-tab {
      border: 1.5px solid var(--border-medium) !important;
      border-radius: 20px !important;
    }
    .folder-tab.active {
      border-color: var(--primary) !important;
    }
    /* Стикеры и т.п. */
    .sticker-tab {
      border: 1.5px solid var(--border-medium) !important;
      border-radius: 20px !important;
    }
    .sticker-tab.active {
      border-color: var(--primary) !important;
    }
    /* Кнопки действий в контактах */
    .ci-btn {
      border: 1.5px solid var(--border-medium) !important;
      border-radius: var(--radius-sm) !important;
      padding: 4px 10px !important;
    }
    .ci-btn.red {
      border-color: #E74C3C !important;
    }
    /* Пункты выпадающего меню чата */
    .dropdown-item {
      border: none !important;
    }
    /* Кнопки в модалках */
    .modal-btn {
      border: none !important;
    }
    /* Убираем рамку у изображений-кнопок */
    .voice-play-btn, .vp-play-btn, .app-icon {
      border: none !important;
    }
  `;
  document.head.appendChild(style);
  console.log('✅ Рамки для кнопок добавлены');
})();

// ════════════════════════════════════════════════════════════════
//  2. АВТО-ДОБАВЛЕНИЕ ЧАТА ПРИ ПЕРВОМ СООБЩЕНИИ И ПРЕДУПРЕЖДЕНИЕ
// ════════════════════════════════════════════════════════════════
(function() {
  // ---- Автоматическое добавление чата при получении сообщения ----
  // Уже есть функция listenForNewChats, но добавим дополнительную проверку
  // и улучшим её, чтобы при первом сообщении от незнакомца чат появлялся
  // с пометкой "Осторожно: его нет в ваших контактах"

  // Переопределяем функцию, которая обрабатывает новые сообщения
  const origListenForNewChats = window.listenForNewChats;
  if (typeof origListenForNewChats === 'function') {
    // Дополняем существующую функцию
    window.listenForNewChats = function() {
      origListenForNewChats();
      // Добавляем дополнительный слушатель для новых сообщений
      if (me) {
        onSnapshot(collection(db, 'messages'), async (snapshot) => {
          snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'added') {
              const data = change.doc.data();
              const chatId = data.chatId;
              // Проверяем, что это приватный чат
              if (!chatId || !chatId.startsWith('chat_')) return;
              const parts = chatId.split('_');
              const otherUid = parts.find(p => p !== me.uid && p !== 'chat');
              if (!otherUid || otherUid === me.uid) return;
              // Проверяем, есть ли уже этот чат в списке
              const exists = chatList.some(c => c.id === otherUid && c.type === 'private');
              if (!exists) {
                // Добавляем чат
                const user = usersCache.get(otherUid);
                if (user) {
                  const newChat = {
                    id: otherUid,
                    name: getDisplayName(otherUid),
                    avatar: user.avatar,
                    type: 'private',
                    lastMsg: data.text?.slice(0, 50) || '',
                    lastMsgTime: data.timestamp?.toDate()?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '',
                    unreadCount: 1,
                    isNew: true // пометка, что чат новый
                  };
                  chatList.push(newChat);
                  // Сортировка
                  chatList.sort((a, b) => {
                    const ta = a.lastMsgTime || '00:00';
                    const tb = b.lastMsgTime || '00:00';
                    return tb.localeCompare(ta);
                  });
                  renderChatList();
                  showToast(`Новое сообщение от ${newChat.name}`);
                }
              }
            }
          });
        });
      }
    };
    // Запускаем обновлённую функцию
    if (me) window.listenForNewChats();
  }

  // ---- Предупреждение в шапке чата, если собеседник не в контактах ----
  // Дополняем updateChatHeaderWithProfile
  const origUpdateHeader = updateChatHeaderWithProfile;
  updateChatHeaderWithProfile = function() {
    origUpdateHeader();
    // Проверяем, приватный ли чат
    if (!activeChat || activeChat.type !== 'private') return;
    const uid = activeChat.id;
    const contacts = myProfile?.contacts || [];
    const inContacts = contacts.includes(uid);
    const statusEl = document.getElementById('chat-hdr-status');
    if (!statusEl) return;
    if (!inContacts) {
      // Добавляем предупреждение перед статусом
      const warning = document.createElement('span');
      warning.style.cssText = 'color: #E74C3C; font-weight: 600; font-size: 12px; display: block; margin-top: 2px;';
      warning.textContent = '⚠️ Осторожно: его нет в ваших контактах';
      // Если уже есть такой элемент, не дублируем
      const existing = statusEl.parentNode.querySelector('.contact-warning');
      if (!existing) {
        const wrap = document.createElement('div');
        wrap.className = 'contact-warning';
        wrap.appendChild(warning);
        // Вставляем после statusEl
        statusEl.parentNode.insertBefore(wrap, statusEl.nextSibling);
      }
    } else {
      // Удаляем предупреждение, если оно есть
      const existing = statusEl.parentNode.querySelector('.contact-warning');
      if (existing) existing.remove();
    }
  };

  // Также при открытии чата обновляем
  const origOpenChat = openChat;
  openChat = async function(chat) {
    await origOpenChat(chat);
    // Если чат приватный и собеседник не в контактах, обновим статус
    if (chat.type === 'private') {
      const uid = chat.id;
      const contacts = myProfile?.contacts || [];
      if (!contacts.includes(uid)) {
        // Добавим предупреждение в шапку (вызовем updateChatHeaderWithProfile)
        updateChatHeaderWithProfile();
      }
    }
  };

  console.log('✅ Авто-добавление чатов и предупреждение о не-контакте активированы');
})();
// ════════════════════════════════════════════════════
//  FOLDERS SYSTEM (с иконками Font Awesome)
// ════════════════════════════════════════════════════

let folders = [];
let activeFolder = 'all'; // 'all' | folderId

// Загрузка папок из Firestore
async function loadFolders() {
  if (!me) return;
  const docSnap = await getDoc(doc(db, 'users', me.uid));
  if (docSnap.exists()) {
    const data = docSnap.data();
    folders = data.folders || [
      { id: 'all', name: 'Все чаты', icon: 'fas fa-folder-open' },
      { id: 'work', name: 'Работа', icon: 'fas fa-briefcase' },
      { id: 'friends', name: 'Друзья', icon: 'fas fa-user-friends' },
      { id: 'family', name: 'Семья', icon: 'fas fa-home' }
    ];
    // Загружаем назначения папок
    if (!myProfile) myProfile = {};
    myProfile.folderAssignments = data.folderAssignments || {};
  }
}

// Сохранение папок и назначений
async function saveFolders() {
  if (!me) return;
  await setDoc(doc(db, 'users', me.uid), {
    folders,
    folderAssignments: myProfile?.folderAssignments || {}
  }, { merge: true });
}

// Создать новую папку
async function createFolder(name, icon = 'fas fa-folder') {
  const newFolder = {
    id: 'folder_' + Date.now().toString(36),
    name: name.trim(),
    icon: icon
  };
  folders.push(newFolder);
  await saveFolders();
  renderFolderTabs();
  showToast(`Папка "${name}" создана`);
  return newFolder;
}

// Назначить чат в папку
async function assignChatToFolder(chatId, chatType, folderId) {
  if (!me) return;
  const key = chatType === 'private' ? `private_${chatId}` : `room_${chatId}`;
  
  // Обновляем локально
  if (!myProfile.folderAssignments) myProfile.folderAssignments = {};
  myProfile.folderAssignments[key] = folderId;
  
  // Сохраняем в Firestore
  await saveFolders();
  
  showToast('Чат перемещён в папку');
  // Перестраиваем список чатов и обновляем отображение
  await buildChatList();
  renderChatList(document.getElementById('chat-search')?.value || '');
}

// Получить папку чата
function getChatFolder(chat) {
  if (!myProfile?.folderAssignments) return 'all';
  const key = chat.type === 'private' ? `private_${chat.id}` : `room_${chat.id}`;
  return myProfile.folderAssignments[key] || 'all';
}

// Рендер вкладок папок
function renderFolderTabs() {
  const container = document.getElementById('folder-tabs-container');
  if (!container) return;

  let html = `
    <div class="folder-tab ${activeFolder === 'all' ? 'active' : ''}" data-id="all">
      <i class="fas fa-folder-open"></i> Все
    </div>
  `;

  folders.forEach(f => {
    if (f.id === 'all') return;
    const isActive = activeFolder === f.id;
    html += `
      <div class="folder-tab ${isActive ? 'active' : ''}" data-id="${esc(f.id)}">
        <i class="${f.icon}"></i> ${esc(f.name)}
      </div>
    `;
  });

  html += `<button class="folder-tab" id="new-folder-btn"><i class="fas fa-plus"></i> Новая</button>`;
  container.innerHTML = html;

  // Обработчики вкладок
  container.querySelectorAll('.folder-tab[data-id]').forEach(tab => {
    tab.onclick = () => {
      activeFolder = tab.dataset.id;
      renderFolderTabs();
      renderChatList(document.getElementById('chat-search')?.value || '');
    };
  });

  document.getElementById('new-folder-btn').onclick = async () => {
    const name = prompt('Название новой папки:');
    if (name && name.trim()) {
      await createFolder(name);
    }
  };
}

// Фильтрация чатов по активной папке
function filterChatsByFolder(chats) {
  if (activeFolder === 'all') return chats;
  return chats.filter(chat => {
    const folderId = getChatFolder(chat);
    return folderId === activeFolder;
  });
}

// Переопределяем renderChatList для поддержки папок
const originalRenderChatList = renderChatList;
renderChatList = function(filter = '') {
  // Сначала фильтруем по поиску
  let filtered = chatList;
  if (filter) {
    filtered = filtered.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()));
  }
  // Затем по папке
  filtered = filterChatsByFolder(filtered);

  // Временно подменяем глобальный chatList для оригинального рендера
  const origChatList = chatList;
  chatList = filtered;
  originalRenderChatList.call(this, filter);
  chatList = origChatList;

  // Если папка не "Все" и чатов нет – показываем сообщение
  if (activeFolder !== 'all' && filtered.length === 0) {
    const el = document.getElementById('chat-list');
    if (el && !el.querySelector('.empty-folder-msg')) {
      const msg = document.createElement('div');
      msg.className = 'empty-folder-msg';
      msg.style.cssText = 'padding:60px 20px;text-align:center;color:var(--text-hint);';
      msg.innerHTML = `
        <div style="font-size:48px;margin-bottom:12px;"><i class="fas fa-folder-open"></i></div>
        <div>В этой папке пусто</div>
      `;
      el.appendChild(msg);
    }
  } else {
    const emptyMsg = document.querySelector('.empty-folder-msg');
    if (emptyMsg) emptyMsg.remove();
  }
};

// ─── КРАСИВОЕ МОДАЛЬНОЕ ОКНО ДЛЯ ВЫБОРА ПАПКИ ───

function showFolderPickerModal(chat) {
  // Создаём модалку, если её нет
  let modal = document.getElementById('modal-folder-picker');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-folder-picker';
    modal.className = 'modal-ov';
    modal.innerHTML = `
      <div class="modal-sheet">
        <div class="modal-pill"></div>
        <div class="modal-hdr">
          <h3><i class="fas fa-folder"></i> Переместить в папку</h3>
          <button class="modal-close"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body" id="folder-picker-body">
          <!-- Список папок будет вставлен сюда -->
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.modal-close').onclick = () => closeModal('modal-folder-picker');
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal('modal-folder-picker');
    });
  }

  const body = document.getElementById('folder-picker-body');
  body.innerHTML = '';

  // Список папок (кроме "Все")
  const folderList = folders.filter(f => f.id !== 'all');

  if (folderList.length === 0) {
    body.innerHTML = `
      <div style="text-align:center;padding:20px;color:var(--text-hint);">
        <p>Нет папок. Создайте первую!</p>
        <button class="modal-btn" id="fp-create-first" style="margin-top:12px;">
          <i class="fas fa-plus"></i> Создать папку
        </button>
      </div>
    `;
    document.getElementById('fp-create-first').onclick = async () => {
      const name = prompt('Название новой папки:');
      if (name && name.trim()) {
        await createFolder(name);
        closeModal('modal-folder-picker');
        // Показываем обновлённый список
        showFolderPickerModal(chat);
      }
    };
  } else {
    // Рендерим каждую папку как кнопку
    folderList.forEach(f => {
      const item = document.createElement('div');
      item.className = 'folder-picker-item';
      item.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        border-radius: 10px;
        cursor: pointer;
        transition: background 0.2s;
        border-bottom: 1px solid var(--border-light);
      `;
      item.innerHTML = `
        <i class="${f.icon}" style="font-size:20px;width:28px;text-align:center;"></i>
        <span style="flex:1;font-weight:500;">${esc(f.name)}</span>
        <span style="color:var(--text-hint);"><i class="fas fa-chevron-right"></i></span>
      `;
      item.onmouseover = () => item.style.background = 'var(--bg-elevated)';
      item.onmouseout = () => item.style.background = '';
      item.onclick = async () => {
        closeModal('modal-folder-picker');
        await assignChatToFolder(chat.id, chat.type, f.id);
      };
      body.appendChild(item);
    });

    // Кнопка "Создать новую папку"
    const createBtn = document.createElement('button');
    createBtn.className = 'modal-btn secondary';
    createBtn.style.marginTop = '12px';
    createBtn.innerHTML = '<i class="fas fa-plus"></i> Создать новую папку';
    createBtn.onclick = async () => {
      const name = prompt('Название новой папки:');
      if (name && name.trim()) {
        await createFolder(name);
        closeModal('modal-folder-picker');
        showFolderPickerModal(chat);
      }
    };
    body.appendChild(createBtn);
  }

  openModal('modal-folder-picker');
}

// ─── ДОБАВЛЯЕМ ПУНКТ В КОНТЕКСТНОЕ МЕНЮ ЧАТА ───

const origShowChatCtx = window.showChatCtx || function(){};
window.showChatCtx = function(chat) {
  origShowChatCtx(chat);
  
  const ctxItems = document.getElementById('ctx-items');
  if (!ctxItems || chat.type === 'self') return;

  // Проверяем, не добавлен ли уже пункт
  if (ctxItems.querySelector('[data-action="move-folder"]')) return;

  const div = document.createElement('div');
  div.className = 'ctx-item';
  div.dataset.action = 'move-folder';
  div.innerHTML = `<span class="ctx-icon"><i class="fas fa-folder"></i></span> Переместить в папку`;
  
  div.onclick = () => {
    closeCtx();
    showFolderPickerModal(chat);
  };
  ctxItems.appendChild(div);
};

// ─── ИНИЦИАЛИЗАЦИЯ ───

async function initFolders() {
  await loadFolders();
  
  // Добавляем контейнер вкладок (если ещё нет)
  if (!document.getElementById('folder-tabs-container')) {
    const chatsPage = document.getElementById('page-chats');
    const searchBar = chatsPage.querySelector('.search-bar');
    
    const tabsContainer = document.createElement('div');
    tabsContainer.id = 'folder-tabs-container';
    tabsContainer.style.cssText = 'display:flex;gap:6px;padding:8px 12px;overflow-x:auto;background:var(--bg-surface);border-bottom:1px solid var(--border-light);';
    
    searchBar.parentNode.insertBefore(tabsContainer, searchBar.nextSibling);
  }
  
  renderFolderTabs();
  console.log('✅ Система папок с иконками активирована');
}

// Запуск при загрузке
if (typeof onAuthStateChanged !== 'undefined') {
  let checkUser = setInterval(() => {
    if (me) {
      clearInterval(checkUser);
      initFolders();
    }
  }, 300);
}
// ============================================================
//  ВХОД ЧЕРЕЗ XAMChat (официальный SDK)
// ============================================================
(function() {
  const CLIENT_ID = 'xam_xjsilFjNx6Zgi01xq6zGPQ';
  const REDIRECT_URI = 'https://nexchat.zapto.org/';

  // Обновление UI кнопки
  function updateXamUI(loggedIn) {
    const btn = document.getElementById('xam-btn');
    if (!btn) return;
    if (loggedIn) {
      btn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;">🔓 Выйти из Xam</span>`;
      btn.onclick = () => {
        localStorage.removeItem('xam_access_token');
        localStorage.removeItem('xam_refresh_token');
        localStorage.removeItem('xam_id_token');
        localStorage.removeItem('xam_pkce_verifier');
        localStorage.removeItem('xam_oauth_state');
        showToast('Вы вышли из Xam');
        updateXamUI(false);
      };
    } else {
      btn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
        </svg>
        Войти через Xam
      </span>`;
      btn.onclick = startXamLogin;
    }
  }

  // Генерация PKCE
  async function generatePKCE() {
    const verifier = crypto.randomUUID() + crypto.randomUUID();
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const buffer = await crypto.subtle.digest('SHA-256', data);
    const challenge = btoa(String.fromCharCode(...new Uint8Array(buffer)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return { verifier, challenge };
  }

  // Запуск входа
  async function startXamLogin() {
    if (typeof XamAuth === 'undefined') {
      showToast('❌ SDK Xam не загружен. Попробуйте позже.');
      return;
    }

    // 1. Пробуем метод login (попап)
    if (typeof XamAuth.login === 'function') {
      XamAuth.login({
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        scope: 'profile_basic',
        onSuccess: function(data) {
          console.log('✅ Xam вход успешен (попап):', data);
          localStorage.setItem('xam_access_token', data.access_token);
          localStorage.setItem('xam_refresh_token', data.refresh_token || '');
          if (data.id_token) localStorage.setItem('xam_id_token', data.id_token);
          showToast('✅ Вход через Xam выполнен!');
          updateXamUI(true);
          if (typeof XamAuth.getUser === 'function') {
            XamAuth.getUser().then(user => console.log('👤 Пользователь Xam:', user)).catch(() => {});
          }
        },
        onError: function(err) {
          console.error('❌ Ошибка входа (попап):', err);
          showToast('❌ Ошибка входа: ' + (err.message || err));
        }
      });
      return;
    }

    // 2. Если login отсутствует, используем редирект
    console.log('ℹ️ XamAuth.login не найден, используем редирект');
    const state = crypto.randomUUID();
    const { verifier, challenge } = await generatePKCE();

    // Сохраняем PKCE в ключи, которые ожидает SDK
    localStorage.setItem('xam_oauth_state', state);
    localStorage.setItem('xam_pkce_verifier', verifier); // ключ для SDK

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'profile_basic',
      state: state,
      code_challenge: challenge,
      code_challenge_method: 'S256'
    });
    window.location.href = `https://xamchat.ru/oauth/authorize?${params.toString()}`;
  }

  // Обработка редиректа через SDK
  function handleXamRedirect() {
    if (typeof XamAuth === 'undefined') {
      console.warn('XamAuth SDK ещё не загружен');
      return;
    }

    // Используем handleRedirect, если есть
    if (typeof XamAuth.handleRedirect === 'function') {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      if (!code) return;

      console.log('🔄 Обработка редиректа через XamAuth.handleRedirect');
      XamAuth.handleRedirect({
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        cleanUrl: true
      }).then(data => {
        if (data) {
          console.log('✅ Токен получен через редирект:', data);
          localStorage.setItem('xam_access_token', data.access_token);
          localStorage.setItem('xam_refresh_token', data.refresh_token || '');
          if (data.id_token) localStorage.setItem('xam_id_token', data.id_token);
          showToast('✅ Вход через Xam выполнен!');
          updateXamUI(true);
          localStorage.removeItem('xam_pkce_verifier');
          localStorage.removeItem('xam_oauth_state');
        }
      }).catch(err => {
        console.error('❌ Ошибка обработки редиректа:', err);
        showToast('❌ Ошибка: ' + err.message);
        localStorage.removeItem('xam_pkce_verifier');
        localStorage.removeItem('xam_oauth_state');
      });
    } else {
      // Если handleRedirect нет, пробуем ручной обмен (на случай, если SDK не завершит)
      console.warn('XamAuth.handleRedirect не найден, пробуем ручной обмен');
      manualExchange();
    }
  }

  // Ручной обмен (запасной вариант)
  async function manualExchange() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    if (!code || !state) return;

    const savedState = localStorage.getItem('xam_oauth_state');
    if (state !== savedState) {
      showToast('Ошибка: неверный state');
      localStorage.removeItem('xam_oauth_state');
      localStorage.removeItem('xam_pkce_verifier');
      return;
    }
    localStorage.removeItem('xam_oauth_state');

    const verifier = localStorage.getItem('xam_pkce_verifier');
    if (!verifier) {
      showToast('Ошибка: отсутствует PKCE verifier');
      return;
    }

    // ⚠️ Если этот URL не работает, уточните у разработчика Xam правильный tokenUrl
    const TOKEN_URL = 'https://xamchat.ru/oauth/token';
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      code: code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
      grant_type: 'authorization_code'
    });

    try {
      const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error_description || data.error || 'Ошибка обмена');
      localStorage.setItem('xam_access_token', data.access_token);
      localStorage.setItem('xam_refresh_token', data.refresh_token || '');
      if (data.id_token) localStorage.setItem('xam_id_token', data.id_token);
      showToast('✅ Вход через Xam выполнен!');
      updateXamUI(true);
      window.history.replaceState({}, document.title, window.location.pathname);
      localStorage.removeItem('xam_pkce_verifier');
    } catch (err) {
      showToast('❌ Ошибка обмена токена: ' + err.message);
      console.error(err);
    }
  }

  // Инициализация
  function initXam() {
    const token = localStorage.getItem('xam_access_token');
    if (token) {
      updateXamUI(true);
    } else {
      updateXamUI(false);
    }
    handleXamRedirect();
  }

  if (document.readyState === 'complete') {
    initXam();
  } else {
    document.addEventListener('DOMContentLoaded', initXam);
  }
})();

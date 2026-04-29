import { db, auth, storage } from './firebase.config.js';
import {
    collection,
    addDoc,
    getDocs,
    query,
    where,
    orderBy,
    onSnapshot,
    serverTimestamp,
    limit,
    doc,
    getDoc,
    updateDoc,
    arrayUnion,
    arrayRemove,
    deleteDoc,
    setDoc,
    collectionGroup
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

import {
    ref as rtdbRef,
    onValue as onRtdbValue
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

import { joinVoiceChannel, leaveVoiceChannel, startScreenShare, stopScreenShare, toggleLocalMic } from './voice.js';
import { rtdb } from './firebase.config.js';

import {
    ref,
    uploadBytesResumable,
    getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
import {
    onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
    signOut, updateProfile, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// --- GLOBAL IMAGE ERROR HANDLER ---
// Yüklenemeyen (eski Storage URL'leri, CORS engelli) tüm avatarlar için fallback
document.addEventListener('error', (e) => {
    if (e.target.tagName === 'IMG') {
        const img = e.target;
        // Sonsuz döngüyü önle
        if (img.dataset.errored) return;
        img.dataset.errored = 'true';
        // Kullanıcı adından placeholder üret (varsa)
        const name = img.alt || img.dataset.username || 'U';
        img.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff&size=128`;
    }
}, true);

// --- GLOBAL STATE ---
let currentServerId = null;
let currentServerName = "";
let currentServerOwnerUid = null;
let currentChannelId = null;
let currentMessageEffect = 'none'; // 'none', 'shooting-star', 'warp', 'cosmic-glow'
let currentChannelType = 'text';
let unsubscribeMessages = null;
let unsubscribeServers = null;
let unsubscribeChannels = null;
let unsubscribeMembers = null;
let unsubscribeFriends = null;
let unsubscribeFriendRequests = null;
let unsubscribePremiumRequests = null;
let currentDMRecipientId = null;
let myFriends = [];
let currentVoiceChannelId = null;
let isDMMode = false;
let unsubscribeDMs = null;

// FRIENDSHIP UI ELEMENTS (GLOBAL)
let friendsModal, userSearchInput, userSearchResults, incomingRequestsList, friendRequestBadge, requestsTabBadge, dmSidebarTrigger;

// --- FRIENDSHIP SYSTEM UI & LOGIC ---

const initFriendsUI = () => {
    friendsModal = document.getElementById('friends-modal');
    userSearchInput = document.getElementById('user-search-input');
    userSearchResults = document.getElementById('user-search-results');
    incomingRequestsList = document.getElementById('incoming-requests-list');
    friendRequestBadge = document.getElementById('friend-request-badge');
    requestsTabBadge = document.getElementById('requests-tab-badge');

    const addFriendBtn = document.getElementById('add-friend-btn');
    const closeFriendsBtn = document.getElementById('close-friends-btn');
    const searchTabBtn = document.getElementById('search-tab-btn');
    const requestsTabBtn = document.getElementById('requests-tab-btn');
    dmSidebarTrigger = document.getElementById('dm-sidebar-trigger');

    if (dmSidebarTrigger) {
        dmSidebarTrigger.onclick = () => {
            isDMMode = !isDMMode;
            toggleDMView();
        };
    }

    if (addFriendBtn) {
        addFriendBtn.onclick = () => {
            friendsModal?.classList.remove('hidden');
            switchFriendTab('search');
        };
    }

    if (closeFriendsBtn) closeFriendsBtn.onclick = () => friendsModal?.classList.add('hidden');
    if (searchTabBtn) searchTabBtn.onclick = () => switchFriendTab('search');
    if (requestsTabBtn) requestsTabBtn.onclick = () => switchFriendTab('requests');

    if (userSearchInput) {
        userSearchInput.oninput = () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(async () => {
                const queryStr = userSearchInput.value.trim();
                if (queryStr.length < 3) {
                    userSearchResults.innerHTML = '';
                    return;
                }
                const q = query(collection(db, 'users'), where('username_lower', '==', queryStr.toLowerCase()));
                const snap = await getDocs(q);
                renderSearchResults(snap.docs);
            }, 500);
        };
    }
};

// Arkadaşlık Modalını Başlat (DOM Yüklendiğinde)
window.addEventListener('DOMContentLoaded', initFriendsUI);

const switchFriendTab = (tab) => {
    const searchBtn = document.getElementById('search-tab-btn');
    const requestsBtn = document.getElementById('requests-tab-btn');
    const searchContent = document.getElementById('search-content');
    const requestsContent = document.getElementById('requests-content');

    if (!searchBtn || !requestsBtn || !searchContent || !requestsContent) return;

    if (tab === 'search') {
        searchBtn.classList.add('active');
        requestsBtn.classList.remove('active');
        searchContent.classList.remove('hidden');
        requestsContent.classList.add('hidden');
    } else {
        searchBtn.classList.remove('active');
        requestsBtn.classList.add('active');
        searchContent.classList.add('hidden');
        requestsContent.classList.remove('hidden');
    }
};

let searchTimeout = null;

const renderSearchResults = (docs) => {
    if (!userSearchResults) return;

    userSearchResults.innerHTML = '';
    if (docs.length === 0) {
        userSearchResults.innerHTML = '<p style="text-align:center; color:gray; margin-top:20px;">Kullanıcı bulunamadı.</p>';
        return;
    }

    docs.forEach(d => {
        const userData = d.data();
        if (userData.uid === auth.currentUser?.uid) return;

        const div = document.createElement('div');
        div.className = 'user-row';
        div.style = 'display:flex; align-items:center; justify-content:space-between; padding:12px; background:rgba(255,255,255,0.03); border-radius:12px; margin-bottom: 8px; border: 1px solid rgba(255,215,0,0.05);';
        div.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px;">
                <img src="${userData.photoURL}" style="width:36px; height:36px; border-radius:50%; border: 1px solid var(--border-gold);">
                <div style="display:flex; flex-direction:column;">
                    <div style="display:flex; align-items:center; gap:6px;">
                        <span style="font-weight:600; font-size:14px; color:white;">${userData.displayName}</span>
                        ${userData.level ? `<span style="font-size: 9px; background: rgba(197, 160, 89, 0.1); color: var(--brand-color); padding: 1px 4px; border-radius: 4px; border: 0.5px solid var(--border-gold);">Lvl ${userData.level}</span>` : ''}
                    </div>
                    <span style="font-size:11px; color:gray;">@${userData.username}</span>
                </div>
            </div>
            <button class="add-friend-action-btn" data-uid="${userData.uid}" style="background:var(--brand-color); color:black; border:none; padding:8px 16px; border-radius:10px; font-weight:900; cursor:pointer; font-size:12px; transition: 0.2s;">İSTEK AT</button>
        `;
        userSearchResults.appendChild(div);

        div.querySelector('.add-friend-action-btn').onclick = () => sendFriendRequest(userData.uid, userData.displayName);
    });
};

// Arkadaşlık İsteği Gönder
const sendFriendRequest = async (targetUid, targetName) => {
    try {
        const myUid = auth.currentUser.uid;

        // Zaten arkadaş mıyız kontrol et
        const friendCheck = await getDoc(doc(db, 'users', myUid, 'friends', targetUid));
        if (friendCheck.exists()) return showToast("Zaten arkadaşsınız!", "error");

        await setDoc(doc(db, 'friend_requests', `${myUid}_${targetUid}`), {
            fromUid: myUid,
            fromName: auth.currentUser.displayName || "Kullanıcı",
            fromPhoto: auth.currentUser.photoURL,
            toUid: targetUid,
            status: 'pending',
            createdAt: serverTimestamp()
        });
        showToast(`Arkadaşlık isteği ${targetName} adlı kullanıcıya gönderildi!`);
    } catch (err) {
        showToast("İstek gönderilemedi: " + err.message, "error");
    }
};

const listenToFriendRequests = () => {
    if (unsubscribeFriendRequests) unsubscribeFriendRequests();
    const q = query(collection(db, 'friend_requests'), where('toUid', '==', auth.currentUser.uid), where('status', '==', 'pending'));

    unsubscribeFriendRequests = onSnapshot(q, (snap) => {
        incomingRequestsList.innerHTML = '';
        const count = snap.size;

        if (count > 0) {
            friendRequestBadge.innerText = count;
            friendRequestBadge.classList.remove('hidden');
            requestsTabBadge.classList.remove('hidden');
        } else {
            friendRequestBadge.classList.add('hidden');
            requestsTabBadge.classList.add('hidden');
        }

        snap.forEach(d => {
            const req = d.data();
            const div = document.createElement('div');
            div.className = 'user-row';
            div.style = 'display:flex; align-items:center; justify-content:space-between; padding:12px; background:rgba(255,255,255,0.03); border-radius:12px;';
            div.innerHTML = `
                <div style="display:flex; align-items:center; gap:12px;">
                    <img src="${req.fromPhoto}" style="width:32px; height:32px; border-radius:50%;">
                    <span style="font-weight:600;">${req.fromName}</span>
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="accept-req-btn" data-id="${d.id}" style="background:#2ecc71; color:white; border:none; padding:6px 12px; border-radius:8px; cursor:pointer;"><i data-lucide="check"></i></button>
                    <button class="reject-req-btn" data-id="${d.id}" style="background:#e74c3c; color:white; border:none; padding:6px 12px; border-radius:8px; cursor:pointer;"><i data-lucide="x"></i></button>
                </div>
            `;
            incomingRequestsList.appendChild(div);

            div.querySelector('.accept-req-btn').onclick = () => acceptFriendRequest(d.id, req);
            div.querySelector('.reject-req-btn').onclick = () => deleteDoc(doc(db, 'friend_requests', d.id));
        });
        lucide.createIcons();
    });
};

// Arkadaşlık İsteğini Kabul Et
const acceptFriendRequest = async (requestId, req) => {
    try {
        const myUid = auth.currentUser.uid;
        const friendUid = req.fromUid;

        // Karşılıklı ekle
        await setDoc(doc(db, 'users', myUid, 'friends', friendUid), {
            uid: friendUid,
            username: req.fromName,
            photoURL: req.fromPhoto,
            addedAt: serverTimestamp()
        });

        const myDataDoc = await getDoc(doc(db, 'users', myUid));
        const myData = myDataDoc.data();

        await setDoc(doc(db, 'users', friendUid, 'friends', myUid), {
            uid: myUid,
            username: myData.username || "Kullanıcı",
            photoURL: myData.photoURL,
            addedAt: serverTimestamp()
        });

        await deleteDoc(doc(db, 'friend_requests', requestId));
        showToast("Artık arkadaşsınız!");
    } catch (err) {
        showToast("Hata: " + err.message, "error");
    }
};

// Arkadaşları Dinle ve DM Listesini Güncelle
const listenToFriends = () => {
    if (unsubscribeFriends) unsubscribeFriends();
    const q = query(collection(db, 'users', auth.currentUser.uid, 'friends'), orderBy('addedAt', 'desc'));

    unsubscribeFriends = onSnapshot(q, (snap) => {
        myFriends = snap.docs.map(d => d.data());
        if (currentServerId === null) renderDirectMessages(); // Eğer Home sayfasındaysak DM listesini yenile
    });
};

// DM Listesini Render Et (Yalnızca Arkadaşlar)
const renderDirectMessages = () => {
    channelList.innerHTML = `
        <div style="padding: 10px; color: var(--text-secondary); font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px;">
            Özel Mesajlar (Arkadaşlar)
        </div>
    `;

    if (myFriends.length === 0) {
        channelList.innerHTML += `
            <div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 12px;">
                Henüz arkadaşın yok. Arkadaş ekleyerek sohbete başla!
            </div>
        `;
        return;
    }

    myFriends.forEach(friend => {
        const displayName = friend.username || friend.displayName || "Gizemli Arkadaş";
        const div = document.createElement('div');
        div.className = `dm-user-item ${currentDMRecipientId === friend.uid ? 'active' : ''}`;
        div.dataset.uid = friend.uid;
        div.style = 'display:flex; align-items:center; gap:10px; padding:10px; margin:2px 0; border-radius:8px; cursor:pointer; transition:0.2s;';
        div.innerHTML = `
            <img src="${friend.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}`}" style="width:32px; height:32px; border-radius:50%; border: 2px solid rgba(255,215,0,0.2);">
            <div style="display:flex; flex-direction:column;">
                <span style="font-weight:600; font-size:14px;">${displayName}</span>
                <span style="font-size:10px; color:var(--text-secondary);">DM başlatmak için tıkla</span>
            </div>
        `;
        div.onclick = () => switchDM(friend.uid, friend.username);
        channelList.appendChild(div);
    });
};

// --- STATE MANAGEMENT ---
// (State consolidated at top)

// Sayfa yüklendiğinde Davet Kodunu Yakala
const inviteFromUrl = window.location.pathname.split('/invite/')[1];
if (inviteFromUrl) {
    sessionStorage.setItem('pendingInvite', inviteFromUrl);
    window.history.replaceState({}, document.title, "/");
}

// Ödeme Başarısı Kontrolü (Simülasyon Sonu)
const urlParams = new URLSearchParams(window.location.search);
const paymentUserId = urlParams.get('userId');
if (paymentUserId) {
    sessionStorage.setItem('paymentConfirmed', 'true');
    window.history.replaceState({}, document.title, "/");
}

// (State consolidated at top)
// --- UI GLOBALS ---
const channelList = document.getElementById('channel-list');
const messageList = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatHeaderName = document.getElementById('current-channel-name');
const serverListContainer = document.getElementById('server-list');
let textChannelsContainer = document.getElementById('text-channels-container');
let voiceChannelsContainer = document.getElementById('voice-channels-container');
const memberListContainer = document.getElementById('member-list-container');
const activeServerName = document.getElementById('active-server-name');
const inviteBox = document.getElementById('invite-box');
const currentInviteCode = document.getElementById('current-invite-code');
const headerInviteCode = document.getElementById('header-invite-code');

const voiceArea = document.getElementById('voice-area');
const voiceGrid = document.getElementById('voice-grid');
const messageInputContainer = document.getElementById('message-input-container');

// BİLDİRİM SESLERİ
const notificationSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3');
const joinSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3');
const leaveSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3');

notificationSound.volume = 0.5;
joinSound.volume = 0.4;
leaveSound.volume = 0.4;

// SES DURUMU
let isMicMuted = false;
let isDeafened = false;

// --- CUSTOM DIALOGS SYSTEM ---
window.customConfirm = (title, msg) => {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-confirm-modal');
        document.getElementById('confirm-title').innerText = title;
        document.getElementById('confirm-msg').innerText = msg;
        modal.classList.remove('hidden');
        lucide.createIcons(); // Galaktik ikonları yükle

        const cleanup = (res) => {
            modal.classList.add('hidden');
            document.getElementById('confirm-yes-btn').onclick = null;
            document.getElementById('confirm-no-btn').onclick = null;
            resolve(res);
        };

        document.getElementById('confirm-yes-btn').onclick = () => cleanup(true);
        document.getElementById('confirm-no-btn').onclick = () => cleanup(false);
    });
};

window.customPrompt = (title, defaultVal = '') => {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-prompt-modal');
        const input = document.getElementById('prompt-input');
        document.getElementById('prompt-title').innerText = title;
        input.value = defaultVal;
        modal.classList.remove('hidden');
        input.focus();
        lucide.createIcons(); // Galaktik ikonları yükle

        const cleanup = (res) => {
            modal.classList.add('hidden');
            document.getElementById('prompt-ok-btn').onclick = null;
            document.getElementById('prompt-cancel-btn').onclick = null;
            resolve(res);
        };

        document.getElementById('prompt-ok-btn').onclick = () => cleanup(input.value);
        document.getElementById('prompt-cancel-btn').onclick = () => cleanup(null);
    });
};

// --- MESSAGE FUNCTIONS ---

/**
 * Belirli bir kanalın mesajlarını dinle (Real-time)
 */
export const listenToMessages = (channelId) => {
    // Önceki dinleyiciyi temizle
    if (unsubscribeMessages) unsubscribeMessages();

    chatHeaderName.innerText = channelId;
    messageList.innerHTML = ''; // Temizle

    const q = query(
        collection(db, 'messages'),
        where('channelId', '==', channelId),
        orderBy('createdAt', 'asc'),
        limit(50)
    );

    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                renderMessage(change.doc.data(), change.doc.id);
            } else if (change.type === "modified") {
                updateMessageUI(change.doc.data(), change.doc.id);
            } else if (change.type === "removed") {
                removeMessageUI(change.doc.id);
            }
        });
        // En aşağı kaydır
        if (snapshot.docChanges().some(c => c.type === 'added')) {
            messageList.scrollTop = messageList.scrollHeight;
        }
    }, (error) => {
        console.error("Mesajlar yüklenirken hata oluştu:", error);
        if (error.code === 'failed-precondition') {
            console.warn("⚠️ Firestore Endeksi Eksik! Konsoldaki linke tıklayarak endeks oluşturun.");
        }
    });
};



/**
 * Mesajı UI'da render et
 */
const renderMessage = (data, id) => {
    const time = data.createdAt?.toDate() ? data.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Az önce';
    const isMe = data.uid === auth.currentUser?.uid;

    // TEPKİLERİ HESAPLA
    let reactionHtml = '';
    if (data.reactions) {
        reactionHtml = '<div class="reactions-list">';
        for (const [emoji, uids] of Object.entries(data.reactions)) {
            if (uids.length > 0) {
                const mine = uids.includes(auth.currentUser?.uid) ? 'mine' : '';
                reactionHtml += `
                    <div class="reaction-item ${mine}" data-emoji="${emoji}">
                        <span>${emoji}</span>
                        <span class="reaction-count">${uids.length}</span>
                    </div>
                `;
            }
        }
        reactionHtml += '</div>';
    }

    const msgHtml = `
        <div class="message" id="msg-${id}" data-id="${id}" style="display: flex; gap: 16px; margin-bottom: 12px; position: relative;">
            <div class="message-actions-bar">
                <div class="action-icon reaction-btn" title="Tepki Ekle"><i data-lucide="smile" style="width:14px;"></i></div>
                ${isMe ? `
                    <div class="action-icon edit-btn" title="Düzenle"><i data-lucide="edit-3" style="width:14px;"></i></div>
                    <div class="action-icon delete delete-msg-btn" title="Sil"><i data-lucide="trash-2" style="width:14px;"></i></div>
                ` : ''}
            </div>

            <img class="msg-avatar" src="${data.photoURL || data.userPhoto || `https://ui-avatars.com/api/?name=${data.username}&background=random`}" 
                 style="width: 40px; height: 40px; border-radius: 50%; cursor: pointer;">
            <div style="flex:1;">
                <div style="display: flex; gap: 8px; align-items: baseline;">
                    <span class="msg-username" style="font-weight: bold; color: #fff; cursor: pointer;">
                        ${data.username} 
                        ${data.isBot ? '<span style="background: var(--brand-color); color: #000; font-size: 9px; padding: 1px 4px; border-radius: 4px; margin-left: 4px; font-weight: 900;">BOT</span>' : ''}
                    </span>
                    <span style="font-size: 12px; color: var(--text-secondary);">${time}</span>
                    ${data.level ? `<span style="font-size: 10px; color: var(--brand-color); font-weight: 800; border: 1px solid var(--border-gold); padding: 0 4px; border-radius: 4px; margin-left: 4px;">LVL ${data.level}</span>` : ''}
                    ${data.isEdited ? '<span style="font-size: 10px; color: var(--text-secondary); italic;">(düzenlendi)</span>' : ''}
                </div>
                <div class="msg-body">
                    <p class="${data.effect ? 'msg-effect-' + data.effect : ''}" data-text="${data.text || ''}" style="color: #dcddde; margin-top: 2px; white-space: pre-wrap; word-break: break-word; ${data.isBot ? 'background: rgba(197, 160, 89, 0.05); padding: 10px; border-radius: 8px; border-left: 3px solid var(--brand-color);' : ''}">${data.text || ''}</p>
                    ${data.fileURL ? `
                        <div class="cargo-pod">
                            <img src="${data.fileURL}" class="media-message-img">
                            <div style="margin-top: 8px; font-size: 10px; color: var(--brand-color); font-weight: 800; display: flex; align-items: center; gap: 5px;">
                                <i data-lucide="package-check" style="width: 12px;"></i> CARGO RECEIVED
                            </div>
                        </div>
                    ` : ''}
                </div>
                ${reactionHtml}
            </div>
        </div>
    `;
    messageList.insertAdjacentHTML('beforeend', msgHtml);

    const item = messageList.lastElementChild;
    const profileOpen = () => window.openUserProfile({ username: data.username, photoURL: data.photoURL || data.userPhoto, uid: data.uid });
    item.querySelector('.msg-avatar').addEventListener('click', profileOpen);
    item.querySelector('.msg-username').addEventListener('click', profileOpen);

    // ACTIONS
    if (isMe) {
        item.querySelector('.delete-msg-btn').onclick = () => deleteMessage(id);
        item.querySelector('.edit-btn').onclick = () => startEditMessage(id, data.text);
    }

    item.querySelector('.reaction-btn').onclick = (e) => {
        e.stopPropagation();
        const rect = e.target.getBoundingClientRect();
        const picker = document.getElementById('emoji-picker');

        // Picker'ı butonun yanına konumlandır
        picker.style.top = (rect.top - 200) + 'px';
        picker.style.left = (rect.left - 220) + 'px';
        picker.style.bottom = 'auto';
        picker.style.right = 'auto';
        picker.classList.remove('hidden');

        window.lastReactionMsgId = id;
    };

    // Reaction list clicks
    item.querySelectorAll('.reaction-item').forEach(r => {
        r.onclick = () => toggleReaction(id, r.dataset.emoji);
    });

    lucide.createIcons();
};

const updateMessageUI = (data, id) => {
    const oldMsg = document.getElementById(`msg-${id}`);
    if (oldMsg) {
        const scrollPos = messageList.scrollTop;
        const isAtBottom = (messageList.scrollHeight - messageList.scrollTop) <= (messageList.clientHeight + 50);

        oldMsg.remove();
        renderMessage(data, id);

        // Pozisyonu koru veya aşağı kaydır
        if (!isAtBottom) messageList.scrollTop = scrollPos;
    }
};

const removeMessageUI = (id) => {
    const msg = document.getElementById(`msg-${id}`);
    if (msg) msg.remove();
};

export const deleteMessage = async (id) => {
    const ok = await customConfirm("Mesajı Sil", "Bu mesajı sonsuza dek galaksiden silmek istediğinize emin misiniz? 🛸");
    if (ok) {
        try {
            await deleteDoc(doc(db, 'messages', id));
        } catch (err) {
            showToast("Silme başarısız!", "error");
        }
    }
};

export const startEditMessage = async (id, oldText) => {
    const newText = await customPrompt("Mesajı Düzenle", oldText);
    if (newText !== null && newText !== oldText) {
        await updateDoc(doc(db, 'messages', id), {
            text: newText,
            isEdited: true
        });
    }
};

export const toggleReaction = async (msgId, emoji) => {
    const uid = auth.currentUser.uid;
    const msgRef = doc(db, 'messages', msgId);
    const msgSnap = await getDoc(msgRef);
    if (!msgSnap.exists()) return;

    const data = msgSnap.data();
    let reactions = data.reactions || {};

    if (!reactions[emoji]) reactions[emoji] = [];

    if (reactions[emoji].includes(uid)) {
        reactions[emoji] = reactions[emoji].filter(u => u !== uid);
    } else {
        reactions[emoji].push(uid);
    }

    await updateDoc(msgRef, { reactions });
};

// --- USER SYNC TO FIRESTORE ---
const syncUserToFirestore = async (user) => {
    if (!user) return;
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
        const userData = {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName || "Kullanıcı",
            username: (user.displayName || user.email.split('@')[0]).toLowerCase().replace(/\s+/g, '_'),
            photoURL: user.photoURL || 'https://via.placeholder.com/150',
            lastLogin: serverTimestamp()
        };
        await setDoc(userRef, userData, { merge: true });
        console.log("New user created in Firestore:", userData.username);
    } else {
        await updateDoc(userRef, { lastLogin: serverTimestamp() });
        console.log("Existing user updated login timestamp.");
    }
};

// --- AUTHENTICATION LISTENERS ---



// --- EMOJI PICKER ADVANCED LOGIC ---
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');

if (emojiBtn) {
    emojiBtn.onclick = (e) => {
        e.stopPropagation();
        window.lastReactionMsgId = null; // Normal mesaj moduna dön
        emojiPicker.style.bottom = '80px';
        emojiPicker.style.right = '20px';
        emojiPicker.style.top = 'auto';
        emojiPicker.classList.toggle('hidden');
    };
}

// Global click to close picker
document.addEventListener('click', (e) => {
    if (emojiPicker && !emojiPicker.contains(e.target) && e.target !== emojiBtn) {
        emojiPicker.classList.add('hidden');
    }
});

// Update emoji items click
const setupEmojiItems = () => {
    document.querySelectorAll('.emoji-item').forEach(item => {
        item.onclick = (e) => {
            e.stopPropagation();
            if (window.lastReactionMsgId) {
                toggleReaction(window.lastReactionMsgId, item.innerText);
                window.lastReactionMsgId = null;
            } else {
                chatInput.value += item.innerText;
                chatInput.focus();
            }
            emojiPicker.classList.add('hidden');
        };
    });
};
setupEmojiItems(); // Initial setup

// Update listenToDMs and listenToMessages to call icons/emojis if needed
// (renderMessage already calls lucide.createIcons)

// --- DM (DIRECT MESSAGES) SYSTEM ---
// (State consolidated at top)

// Kanal ekleme butonlarını yeniden bağla (event delegation halleddiği için şimdilik ek işlem gereksiz)
const rebindAddChannelButtons = () => {
    // Butonlar document-level event delegation ile çalışıyor, ekstra bağlama gerekmez
};

// Orijinal channel-list HTML yapısını geri yükle ve DOM referanslarını tazele
const restoreChannelListStructure = () => {
    const cl = document.getElementById('channel-list');
    if (!cl) return;
    cl.innerHTML = `
        <!-- Text Channels Section -->
        <div>
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0 8px 8px; color: var(--text-secondary); font-size: 11px; font-weight: 800; text-transform: uppercase;">
                <span>Metin Kanalları</span>
                <i data-lucide="plus" id="add-text-channel-btn" class="add-chan-plus" style="cursor: pointer; width: 14px; height: 14px;"></i>
            </div>
            <div id="text-channels-container"></div>
        </div>

        <!-- Voice Channels Section -->
        <div>
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0 8px 8px; color: var(--text-secondary); font-size: 11px; font-weight: 800; text-transform: uppercase;">
                <span>Ses Kanalları</span>
                <i data-lucide="plus" id="add-voice-channel-btn" class="add-chan-plus" style="cursor: pointer; width: 14px; height: 14px;"></i>
            </div>
            <div id="voice-channels-container"></div>
        </div>
    `;
    // DOM referanslarını güncelle
    textChannelsContainer = document.getElementById('text-channels-container');
    voiceChannelsContainer = document.getElementById('voice-channels-container');
    lucide.createIcons();
    // Kanal ekleme butonlarını yeniden bağla
    rebindAddChannelButtons();
};

const toggleDMView = () => {
    // Mesajlaşma alanını temizle
    messageList.innerHTML = '';
    if (unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }

    if (isDMMode) {
        currentDMRecipientId = null;
        currentChannelId = null;

        dmSidebarTrigger?.classList.add('active');
        const activeServerNameElem = document.getElementById('active-server-name');
        if (activeServerNameElem) activeServerNameElem.innerText = "Özel Mesajlar";
        document.getElementById('current-channel-name').innerText = "Arkadaş Seç";
        
        // Ses alanı ve üye listesini gizle
        document.getElementById('voice-area')?.classList.add('hidden');
        document.getElementById('member-list')?.classList.add('hidden');
        
        loadDMList();
        lucide.createIcons();
    } else {
        // DM'den çıkış — Sunucu moduna dön
        currentDMRecipientId = null;
        currentChannelId = null;

        dmSidebarTrigger?.classList.remove('active');
        const activeServerNameElem = document.getElementById('active-server-name');
        if (activeServerNameElem) activeServerNameElem.innerText = currentServerName || "Sunucu Seçin";
        
        // Görünürlüğü geri getir
        document.getElementById('voice-area')?.classList.add('hidden'); // Ses alanı sadece ses kanalındayken açılır
        document.getElementById('member-list')?.classList.remove('hidden');

        // Kanal yapısını geri yükle
        restoreChannelListStructure();

        if (currentServerId) {
            listenToChannels(currentServerId);
            listenToMembers(currentServerId, currentServerOwnerUid);
        } else {
            channelList.innerHTML = '<div style="padding:20px; text-align:center; color:gray;">Bir galaksi seç veya arkadaşlarınla konuş!</div>';
        }
    }
};

const loadDMList = () => {
    const container = document.getElementById('channel-list');
    if (!container) return;

    if (myFriends.length === 0) {
        container.innerHTML = '<div style="padding:24px; text-align:center; color:var(--text-secondary); font-size:13px;">Henüz hiç arkadaşın yok. Arkadaş ekleyerek sohbete başla!</div>';
        return;
    }

    let html = '<div style="padding:10px; color:var(--brand-color); font-size:11px; font-weight:800; letter-spacing:1px;">ARKADAŞLARIN</div>';
    myFriends.forEach(friend => {
        const displayName = friend.username || friend.displayName || 'Gizemli Arkadaş';
        html += `
            <div class="dm-user-item ${currentDMRecipientId === friend.uid ? 'active' : ''}" data-uid="${friend.uid}" style="display:flex; align-items:center; gap:10px; padding:10px; margin:4px 8px; border-radius:12px; cursor:pointer; color:var(--text-secondary); transition:0.2s;">
                <img src="${friend.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}`}" style="width:32px; height:32px; border-radius:50%; border: 1px solid rgba(255,215,0,0.1);">
                <span style="font-size:14px; font-weight:600;">${displayName}</span>
            </div>
        `;
    });
    container.innerHTML = html;

    container.querySelectorAll('.dm-user-item').forEach(item => {
        item.onclick = () => switchDM(item.dataset.uid, item.querySelector('span').innerText);
    });
};

const switchDM = (uid, name) => {
    currentDMRecipientId = uid;
    currentChannelId = null;

    document.querySelectorAll('.dm-user-item').forEach(i => i.classList.remove('active'));
    document.querySelector(`.dm-user-item[data-uid="${uid}"]`)?.classList.add('active');

    document.getElementById('current-channel-name').innerText = `@${name}`;
    document.getElementById('chat-messages').innerHTML = '';

    listenToDMs(uid);
};

const listenToDMs = (recipientUid) => {
    if (unsubscribeMessages) unsubscribeMessages();
    const container = document.getElementById('chat-messages');
    if (container) container.innerHTML = '';

    const myUid = auth.currentUser.uid;
    const participants = [myUid, recipientUid].sort();
    const dmId = participants.join('_');

    const q = query(
        collection(db, 'direct_messages', dmId, 'messages'),
        orderBy('timestamp', 'asc'),
        limit(50)
    );

    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const msg = change.doc.data();
            if (change.type === "added") {
                renderMessage(msg, change.doc.id);
                // Eer mesaj bizden deilse ve sayfa yklendikten sonra gelmise SES AL
                if (msg.uid !== auth.currentUser.uid) {
                    notificationSound.play().catch(e => console.log("Ses hatas (Browser engeli):", e));
                }
            } else if (change.type === "modified") {
                updateMessageUI(msg, change.doc.id);
            } else if (change.type === "removed") {
                removeMessageUI(change.doc.id);
            }
        });
        const msgList = document.getElementById('chat-messages');
        if (msgList) msgList.scrollTop = msgList.scrollHeight;
    }, (error) => {
        console.error("DM Listener Hata:", error);
    });
};

let unsubscribeGlobalDMs = null;
const initGlobalDMListener = () => {
    if (unsubscribeGlobalDMs) unsubscribeGlobalDMs();
    const myUid = auth.currentUser.uid;
    // TMM mesajlar koleksiyon grubu iin bir indeks gerektirebilir (Firebase konsolunda)
    const q = query(
        collectionGroup(db, 'messages'),
        where('recipientUid', '==', myUid),
        orderBy('timestamp', 'desc'),
        limit(1)
    );

    let isFirstLoad = true;
    unsubscribeGlobalDMs = onSnapshot(q, (snapshot) => {
        if (isFirstLoad) {
            isFirstLoad = false;
            return;
        }
        snapshot.docChanges().forEach(change => {
            if (change.type === "added") {
                const msg = change.doc.data();
                // Eer u an sohbet ettiimiz kii deilse BİLDİRİM VER
                if (msg.uid !== currentDMRecipientId) {
                    notificationSound.play().catch(e => { });
                    showToast(`Yeni Mesaj: ${msg.username}`, "info");
                }
            }
        });
    }, (error) => {
        console.error("Global DM Radar Hatas (Index Hatas olabilir):", error);
        if (error.code === 'failed-precondition') {
            console.warn("DİKKAT: messages koleksiyon grubu için 'Collection Group' kapsamlı bir index gereklidir.");
        }
    });
};

// --- CHAT INPUT & SENDING ---
if (chatInput) {
    chatInput.onkeypress = (e) => {
        if (e.key === 'Enter') {
            const val = chatInput.value.trim();
            if (!val) return;
            if (isDMMode && currentDMRecipientId) {
                sendDM(val);
            } else if (currentChannelId) {
                sendMessage(val);
            }
            chatInput.value = '';
        }
    };
}

// --- CHAT MEDIA UPLOAD (BASE64) ---
const handleChatMediaUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 1024 * 1024) {
        return showToast("Dosya çok büyük! (Max 1MB)", "error");
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
        const base64Data = event.target.result;
        
        // Animasyonu IŞIK HIZINDA tetikle
        const ship = document.createElement('div');
        ship.className = 'cargo-ship-anim';
        ship.style.cssText = "position:fixed; z-index:99999; top:45%; left:-150px; pointer-events:none;";
        // Yeni, daha hzl ve güvenilir ikon
        ship.innerHTML = '<img src="https://cdn-icons-png.flaticon.com/512/1356/1356479.png" style="width: 120px; filter: drop-shadow(0 0 15px #00ffff) blur(1px); transform: rotate(15deg);">';
        document.body.appendChild(ship);
        setTimeout(() => ship.remove(), 1500);

        try {
            if (isDMMode && currentDMRecipientId) {
                await sendDM(base64Data, true);
            } else if (currentChannelId) {
                await sendMessage(base64Data, true);
            }
            showToast("Kargo podu fırlatıldı! 🚀");
        } catch (err) {
            showToast("Görsel hatası: " + err.message, "error");
        }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
};

const chatMediaInput = document.getElementById('chat-media-input');
if (chatMediaInput) {
    chatMediaInput.onchange = handleChatMediaUpload;
}

export const sendMessage = async (content, isFile = false) => {
    if (!auth.currentUser || !currentChannelId) return;

    const msgData = {
        uid: auth.currentUser.uid,
        username: auth.currentUser.displayName || "Kullanıcı",
        photoURL: auth.currentUser.photoURL,
        createdAt: serverTimestamp(),
        channelId: currentChannelId,
        reactions: {}
    };

    if (isFile) {
        msgData.fileURL = content;
        msgData.text = "";
    } else {
        msgData.text = content;
    }

    if (currentMessageEffect !== 'none') {
        msgData.effect = currentMessageEffect;
    }

    // --- GET CURRENT LEVEL ---
    const user = auth.currentUser;
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
        msgData.level = userSnap.data().level || 1;
    }

    const docRef = await addDoc(collection(db, 'messages'), msgData);

    // --- XP & LEVEL SYSTEM ---
    if (userSnap.exists()) {
        const userData = userSnap.data();
        const currentXP = userData.xp || 0;
        const currentLevel = userData.level || 1;
        const newXP = currentXP + 10;
        const nextLevelXP = currentLevel * 100;

        if (newXP >= nextLevelXP) {
            await updateDoc(userRef, { xp: 0, level: currentLevel + 1 });
            showToast(`🚀 TEBRİKLER! Seviye Atladın: ${currentLevel + 1}`, "success");
        } else {
            await updateDoc(userRef, { xp: newXP });
        }
    }

    // --- BOT COMMANDS ---
    if (content.startsWith('/')) {
        handleBotCommand(content, currentChannelId, user);
    }
};

const handleBotCommand = async (cmd, channelId, user) => {
    const command = cmd.toLowerCase().split(' ')[0];
    let botMsg = "";

    if (command === '/yardım') {
        botMsg = `Merhaba **${user.displayName}**! Ben Galaktik Rehber. Sana şu komutlarla yardımcı olabilirim:\n\n` +
                 `🌟 **/seviye** - Mevcut XP ve Seviyeni gösterir.\n` +
                 `📜 **/kurallar** - Galaktik topluluk kurallarını listeler.\n` +
                 `🌌 **/istatistik** - Evrenin güncel durumunu söyler.`;
    } else if (command === '/kurallar') {
        botMsg = `**GALAKTİK KURALLAR:**\n1. Diğer yolculara saygılı davran.\n2. Spam yaparak kara delik oluşturma.\n3. Kozmik barışı koru!`;
    } else if (command === '/seviye') {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        const d = userDoc.data();
        botMsg = `🌟 **${user.displayName}**\n**Seviye:** ${d.level || 1}\n**XP:** ${d.xp || 0} / ${(d.level || 1) * 100}`;
    }

    if (botMsg) {
        await addDoc(collection(db, 'messages'), {
            channelId: channelId,
            text: botMsg,
            uid: 'galactic_guide_bot',
            username: 'Galaktik Rehber',
            photoURL: 'https://cdn-icons-png.flaticon.com/512/2592/2592231.png',
            createdAt: serverTimestamp(),
            isBot: true,
            level: 999 // Bot her zaman son seviye!
        });
    }
};

export const sendDM = async (content, isFile = false) => {
    if (!auth.currentUser || !currentDMRecipientId) return;

    const participants = [auth.currentUser.uid, currentDMRecipientId].sort();
    const dmId = participants.join('_');

    const msgData = {
        uid: auth.currentUser.uid,
        recipientUid: currentDMRecipientId,
        username: auth.currentUser.displayName || "Kullanıcı",
        timestamp: serverTimestamp(),
        reactions: {}
    };

    if (isFile) {
        msgData.fileURL = content;
        msgData.text = "";
    } else {
        msgData.text = content;
    }

    await addDoc(collection(db, `direct_messages/${dmId}/messages`), msgData);
};

export const createServer = async (data) => {
    const user = auth.currentUser;

    // PREMIUM KONTROLÜ (Limit: 5)
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    const isPremium = userDoc.exists() && userDoc.data().isPremium;

    const q = query(collection(db, 'servers'), where('ownerUid', '==', user.uid));
    const serverCount = (await getDocs(q)).size;

    if (serverCount >= 5 && !isPremium) {
        await customConfirm("Limit Aşıldı", "Maksimum 5 sunucu sınırına ulaştınız. Daha fazla sunucu oluşturmak için Chatin Premium'a geçmelisiniz.");
        return null;
    }

    const serverRef = doc(collection(db, 'servers'));
    await setDoc(serverRef, {
        name: data.name,
        description: data.description || "",
        category: data.category || "genel",
        isPublic: data.isPublic !== undefined ? data.isPublic : true,
        requiresApproval: data.requiresApproval || false,
        inviteCode: serverRef.id.substring(0, 6).toUpperCase(),
        ownerUid: user.uid,
        createdAt: Date.now(),
        members: [user.uid],
        memberCount: 1,
        activeMemberCount: 1,
        popularityScore: 0
    });

    // SUNUCU ÜYE LİSTESİNE KENDİNİ EKLE
    await setDoc(doc(db, 'servers', serverRef.id, 'members', user.uid), {
        uid: user.uid,
        username: user.displayName,
        photoURL: user.photoURL,
        joinedAt: Date.now(),
        roles: []
    });

    // Default channel
    await addDoc(collection(db, 'channels'), {
        serverId: serverRef.id,
        name: 'genel',
        type: 'text',
        createdAt: serverTimestamp()
    });

    return serverRef.id;
};

export const joinServer = async (code) => {
    const user = auth.currentUser;
    await customConfirm("Seni Bekliyorlar!", `Bu galaksinin davetini kabul edip içeri giriyoruz... (Kod: ${code})`);

    // Sunucuyu bul
    const q = query(collection(db, 'servers'), where('inviteCode', '==', code));
    const snap = await getDocs(q);
    if (snap.empty) throw new Error("Üzgünüz, bu galaksi haritadan silinmiş veya davet kodu geçersiz.");

    const serverDoc = snap.docs[0];
    const serverId = serverDoc.id;
    const serverData = serverDoc.data();

    // Zaten üye mi?
    if (serverData.members?.includes(user.uid)) {
        showToast("Zaten bu galaksinin bir parçasısınız!", "info");
        return serverId;
    }

    // Onay gerekiyor mu?
    if (serverData.requiresApproval) {
        // İstek zaten var mı kontrol et
        const requestRef = doc(db, 'servers', serverId, 'joinRequests', user.uid);
        const requestSnap = await getDoc(requestRef);
        
        if (requestSnap.exists()) {
            throw new Error("Katılım isteğiniz zaten beklemede! Sabırlı olun Pilot. 🛸");
        }

        await setDoc(requestRef, {
            uid: user.uid,
            username: user.displayName,
            photoURL: user.photoURL,
            requestedAt: Date.now(),
            status: 'pending'
        });

        showToast("Katılım isteğin galaksi yönetimine iletildi! Onay bekliyor... 📡", "success");
        return null; // Henüz katılmadı
    }

    // Sunucu ana dökümanına üye olarak ekle
    await updateDoc(doc(db, 'servers', serverId), {
        members: arrayUnion(user.uid),
        memberCount: (serverData.memberCount || 0) + 1
    });

    // ÖZEL ÜYE LİSTESİNE EKLE
    await setDoc(doc(db, 'servers', serverId, 'members', user.uid), {
        uid: user.uid,
        username: user.displayName,
        photoURL: user.photoURL,
        joinedAt: Date.now(),
        roles: []
    });

    return serverId;

};

export const deleteServer = async (serverId) => {
    if (!serverId) return;
    const confirmed = await customConfirm("SUNUCUYU YOK ET", "Bu sunucuyu ve içindeki tüm verileri (mesajlar, kanallar, roller) kalıcı olarak silmek istediğinize emin misiniz? BU İŞLEM GERİ ALINAMAZ!");
    if (!confirmed) return;

    try {
        await deleteDoc(doc(db, 'servers', serverId));
        showToast("Sunucu başarıyla imha edildi.", "info");
        window.location.reload();
    } catch (err) {
        showToast("Silme hatası: " + err.message, "error");
    }
};

// --- SERVER & CHANNEL LOGIC ---

export const listenToServers = () => {
    const user = auth.currentUser;
    if (unsubscribeServers) unsubscribeServers();

    const q = query(collection(db, 'servers'), where('members', 'array-contains', user.uid));

    unsubscribeServers = onSnapshot(q, (snapshot) => {
        serverListContainer.innerHTML = '';
        snapshot.docs.forEach((doc, index) => {
            renderServerIcon(doc.data(), doc.id);
            // Default to first server if none selected
            if (index === 0 && !currentServerId) {
                switchServer(doc.id, doc.data());
            }
        });
    });
};

export const switchServer = async (serverId, serverData) => {
    // Mesaj alanını temizle ve önceki dinleyiciyi kapat
    if (unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }
    messageList.innerHTML = '';
    currentChannelId = null;

    if (isDMMode) {
        isDMMode = false;
        currentDMRecipientId = null;
        document.getElementById('dm-sidebar-trigger')?.classList.remove('active');
        document.getElementById('member-list')?.classList.remove('hidden');
        
        // Kanal yapısını geri yükle
        restoreChannelListStructure();
    }
    
    currentServerId = serverId;
    currentServerName = serverData.name;
    window.lastActiveServerId = serverId;
    activeServerName.innerText = serverData.name;

    // ATMOSFER UYGULA
    document.body.className = ''; // Temizle
    if (serverData.atmosphere && serverData.atmosphere !== 'default') {
        document.body.classList.add(`theme-${serverData.atmosphere}`);
    }

    // ownerUid eksikse mevcut kullanıcıyı otomatik owner yap (eski sunucular için)
    if (!serverData.ownerUid && auth.currentUser) {
        try {
            await updateDoc(doc(db, 'servers', serverId), {
                ownerUid: auth.currentUser.uid
            });
            serverData.ownerUid = auth.currentUser.uid;
            console.log('✅ ownerUid otomatik eklendi:', auth.currentUser.uid);
        } catch (e) {
            console.warn('ownerUid eklenemedi:', e);
        }
    }

    // Owner UID'ini state'e kaydet
    currentServerOwnerUid = serverData.ownerUid || null;

    // Reset Settings UI
    document.getElementById('server-settings-modal').classList.add('hidden');

    // PATRON / YETKİ KONTROLÜ (Sidebar '+' butonları için)
    const canAddChannels = await checkPermission('manage_channels');
    document.querySelectorAll('.add-chan-plus').forEach(btn => {
        btn.style.display = canAddChannels ? 'flex' : 'none';
    });

    // Show Invite Box
    document.getElementById('invite-box').classList.remove('hidden');
    document.getElementById('current-invite-code').innerText = `#${serverId.slice(0, 7)}`;
    
    // Davet Butonu Mantığı - Sadece sunucu sahibine göster
    const copyInviteBtn = document.getElementById('copy-invite-btn');
    if (copyInviteBtn) {
        const isOwner = auth.currentUser && auth.currentUser.uid === serverData.ownerUid;
        const isAdmin = await checkPermission('manage_channels');
        
        if (isOwner || isAdmin) {
            copyInviteBtn.style.display = 'flex';
            copyInviteBtn.onclick = (e) => {
                e.stopPropagation();
                const inviteUrl = `${window.location.origin}${window.location.pathname}?invite=${serverData.inviteCode || serverId}`;
                navigator.clipboard.writeText(inviteUrl);
                showToast("Galaktik davet linki kopyalandı! 🌌🔗", "success");
            };
        } else {
            copyInviteBtn.style.display = 'none';
        }
    }

    // --- PREMİUM PROMOSYON TETİKLEYİCİ ---
    const userSnap = await getDoc(doc(db, 'users', auth.currentUser.uid));
    const isPremium = userSnap.exists() && userSnap.data().isPremium;
    const hasSeenPromo = sessionStorage.getItem('hasSeenPremiumPromo');

    if (!isPremium && !hasSeenPromo) {
        setTimeout(() => {
            document.getElementById('premium-welcome-modal').classList.remove('hidden');
            sessionStorage.setItem('hasSeenPremiumPromo', 'true');
            lucide.createIcons();
        }, 2000); // 2 saniye sonra şık bir giriş yapsın
    }

    listenToChannels(serverId);
    listenToMembers(serverId, serverData.ownerUid);

    // Refresh Icons for active state
    document.querySelectorAll('.server-icon').forEach(icon => {
        icon.classList.remove('active');
        if (icon.dataset.id === serverId) icon.classList.add('active');
    });
};

// --- ROLE & PERMISSION SYSTEM ---

export const checkPermission = async (perm) => {
    if (!currentServerId || !auth.currentUser) return false;

    // 1. Sunucu Sahibi her şeyi yapabilir
    const serverSnap = await getDoc(doc(db, 'servers', currentServerId));
    if (!serverSnap.exists()) return false;
    if (serverSnap.data().ownerUid === auth.currentUser.uid) return true;

    // 2. Üyenin rollerini al
    const memberSnap = await getDoc(doc(db, 'servers', currentServerId, 'members', auth.currentUser.uid));
    if (!memberSnap.exists()) return false;

    const roleIds = memberSnap.data().roles || [];
    if (roleIds.length === 0) return false;

    // 3. Rollerdeki yetkileri kontrol et
    for (const rid of roleIds) {
        const roleSnap = await getDoc(doc(db, 'servers', currentServerId, 'roles', rid));
        if (roleSnap.exists() && (roleSnap.data().permissions || []).includes(perm)) {
            return true;
        }
    }

    return false;
};

export const createRole = async (name, color = '#c5a059', permissions = [], accessibleChannels = []) => {
    if (!currentServerId) return;
    const rolesRef = collection(db, 'servers', currentServerId, 'roles');
    await addDoc(rolesRef, {
        name,
        color,
        permissions,
        accessibleChannels,
        createdAt: serverTimestamp()
    });
    showToast("Rol ve yetkiler başarıyla oluşturuldu!", "success");
    loadRoles();
};

export const updateRolePermissions = async (roleId, permissions) => {
    if (!currentServerId) return;
    const roleRef = doc(db, 'servers', currentServerId, 'roles', roleId);
    await updateDoc(roleRef, { permissions });
    showToast("Yetkiler güncellendi!", "success");
};

export const deleteRole = async (roleId) => {
    if (!currentServerId) return;
    const confirmed = await customConfirm("Rolü Sil", "Bu rolü silmek istediğinize emin misiniz? Bu işlem geri alınamaz.");
    if (!confirmed) return;
    await deleteDoc(doc(db, 'servers', currentServerId, 'roles', roleId));
    showToast("Rol silindi.", "info");
    loadRoles();
};

const loadRoles = async () => {
    if (!currentServerId) return;
    const rolesRef = collection(db, 'servers', currentServerId, 'roles');
    const snap = await getDocs(rolesRef);
    const roleList = document.getElementById('role-list');
    roleList.innerHTML = '';

    snap.forEach(docSnap => {
        const role = docSnap.data();
        const html = `
            <div class="role-item" data-id="${docSnap.id}" style="border: 1px solid ${role.color}44; display: flex; align-items: center; justify-content: space-between; padding: 12px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 8px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 12px; height: 12px; border-radius: 50%; background: ${role.color};"></div>
                    <span style="font-weight: 600;">${role.name}</span>
                </div>
                <div style="display: flex; gap: 16px;">
                    <div class="edit-role-perms" title="Yetkileri Düzenle" style="cursor: pointer; color: var(--brand-color);"><i data-lucide="shield" style="width: 18px;"></i></div>
                    <div class="delete-role-btn" title="Rolü Sil" style="cursor: pointer; color: var(--error-color);"><i data-lucide="trash-2" style="width: 18px;"></i></div>
                </div>
            </div>
        `;
        roleList.insertAdjacentHTML('beforeend', html);

        const item = roleList.lastElementChild;
        item.querySelector('.edit-role-perms').onclick = (e) => { e.stopPropagation(); openRoleEditor(docSnap.id, role); };
        item.querySelector('.delete-role-btn').onclick = (e) => { e.stopPropagation(); deleteRole(docSnap.id); };
    });
    lucide.createIcons();
};

const loadMembersInSettings = async () => {
    if (!currentServerId) return;
    const membersRef = collection(db, 'servers', currentServerId, 'members');
    const rolesSnap = await getDocs(collection(db, 'servers', currentServerId, 'roles'));
    const rolesList = [];
    rolesSnap.forEach(r => rolesList.push({ id: r.id, ...r.data() }));

    const snap = await getDocs(membersRef);
    const list = document.getElementById('settings-members-list');
    list.innerHTML = '';

    snap.forEach(docSnap => {
        const data = docSnap.data();
        const isSelf = data.uid === auth.currentUser.uid;

        let rolesHtml = '<div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px;">';
        rolesList.forEach(role => {
            const hasRole = (data.roles || []).includes(role.id);
            rolesHtml += `<div class="mini-role-pill" data-uid="${data.uid}" data-rid="${role.id}" style="padding: 2px 8px; border-radius: 4px; font-size: 10px; cursor: pointer; border: 1px solid ${role.color}; background: ${hasRole ? role.color : 'transparent'}; color: ${hasRole ? 'white' : role.color};">${role.name}</div>`;
        });
        rolesHtml += '</div>';

        const html = `
            <div style="background: rgba(255,255,255,0.03); padding: 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <img src="${data.photoURL || `https://ui-avatars.com/api/?name=${data.username}&background=random`}" style="width: 36px; height: 36px; border-radius: 50%;">
                    <div style="flex: 1;">
                        <span style="font-weight: 700; font-size: 14px;">${data.username}</span>
                        <div style="font-size: 10px; color: var(--text-secondary);">Üye ID: ${data.uid.substring(0, 8)}...</div>
                    </div>
                    <button class="kick-btn-settings" data-uid="${data.uid}" style="background: transparent; border: 1px solid var(--error-color); color: var(--error-color); padding: 6px 14px; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 800; ${isSelf ? 'display:none' : ''}">SUNUCUDAN AT</button>
                </div>
                ${rolesHtml}
            </div>
        `;
        list.insertAdjacentHTML('beforeend', html);
    });

    // Rol değişimi dinleyicileri
    list.querySelectorAll('.mini-role-pill').forEach(pill => {
        pill.onclick = async () => {
            const uid = pill.dataset.uid;
            const rid = pill.dataset.rid;
            const memberSnap = await getDoc(doc(db, 'servers', currentServerId, 'members', uid));
            if (!memberSnap.exists()) return;

            let userRoles = memberSnap.data().roles || [];
            if (userRoles.includes(rid)) {
                userRoles = userRoles.filter(id => id !== rid);
            } else {
                userRoles.push(rid);
            }
            await assignRoleToMember(uid, userRoles);
            loadMembersInSettings(); // UI Yenile
        };
    });
};

const loadRoleChannelsUI = async (containerId, selectedChannels = []) => {
    const container = document.getElementById(containerId);
    if (!container || !currentServerId) return;

    const snap = await getDocs(query(collection(db, 'channels'), where('serverId', '==', currentServerId)));
    container.innerHTML = '';

    snap.forEach(docSnap => {
        const chan = docSnap.data();
        const isChecked = selectedChannels.includes(docSnap.id);
        const item = document.createElement('label');
        item.className = 'perm-checkbox';
        item.style.fontSize = '12px';
        item.style.padding = '8px';
        item.innerHTML = `<input type="checkbox" value="${docSnap.id}" ${isChecked ? 'checked' : ''}> # ${chan.name}`;
        container.appendChild(item);
    });
};

const openRoleEditor = (roleId, roleData) => {
    const editor = document.getElementById('role-editor');
    editor.classList.remove('hidden');
    document.getElementById('editing-role-name').innerText = `"${roleData.name}" Yetkileri & Erişimi`;

    // Check checkboxes based on current permissions
    const perms = roleData.permissions || [];
    editor.querySelectorAll('input[data-perm]').forEach(cb => {
        cb.checked = perms.includes(cb.dataset.perm);
    });

    // Load channel access
    loadRoleChannelsUI('edit-role-channels', roleData.accessibleChannels || []);

    window.editingRoleId = roleId;
    window.editingRoleData = roleData;
    editor.scrollIntoView({ behavior: 'smooth' });
};

const listenToChannels = (serverId) => {
    if (unsubscribeChannels) unsubscribeChannels();
    const q = query(collection(db, 'channels'), where('serverId', '==', serverId));

    unsubscribeChannels = onSnapshot(q, async (snapshot) => {
        // --- KULLANICI YETKİLERİNİ BİR KERE AL ---
        const serverSnap = await getDoc(doc(db, 'servers', serverId));
        const isOwner = serverSnap.exists() && serverSnap.data().ownerUid === auth.currentUser.uid;

        let allowedChannelIds = [];
        if (!isOwner) {
            const memberSnap = await getDoc(doc(db, 'servers', serverId, 'members', auth.currentUser.uid));
            if (memberSnap.exists()) {
                const roleIds = memberSnap.data().roles || [];
                for (const rid of roleIds) {
                    const roleSnap = await getDoc(doc(db, 'servers', serverId, 'roles', rid));
                    if (roleSnap.exists()) {
                        const accessible = roleSnap.data().accessibleChannels || [];
                        allowedChannelIds = [...new Set([...allowedChannelIds, ...accessible])];
                    }
                }
            }
        }

        // DOM Referanslarının hala geçerli olduğundan emin ol
        if (!textChannelsContainer || !textChannelsContainer.parentNode) {
            textChannelsContainer = document.getElementById('text-channels-container');
            voiceChannelsContainer = document.getElementById('voice-channels-container');
        }

        if (textChannelsContainer) textChannelsContainer.innerHTML = '';
        if (voiceChannelsContainer) voiceChannelsContainer.innerHTML = '';

        snapshot.docs.forEach((docSnap, index) => {
            const data = docSnap.data();
            const canSee = isOwner || allowedChannelIds.includes(docSnap.id);

            if (canSee) {
                renderChannelItem(data, docSnap.id, isOwner);
                // İlk text kanalına otomatik geçiş
                if (!currentChannelId && data.type === 'text') {
                    switchChannel(docSnap.id, data.name, data.type);
                }
            }
        });
    });
};

export const createChannel = async (name, type = 'text') => {
    if (!currentServerId || !name) return;
    await addDoc(collection(db, 'channels'), {
        serverId: currentServerId,
        name: name,
        type: type,
        createdAt: serverTimestamp()
    });
};

export const deleteChannel = async (channelId) => {
    if (!(await checkPermission('manage_channels'))) return showToast("Bu işlem için yetkiniz yok!", "error");
    const confirmed = await customConfirm("Kanalı Sil", "Bu kanalı silmek istediğinizden emin misiniz?");
    if (!confirmed) return;
    await deleteDoc(doc(db, 'channels', channelId));
};

export const updateChannelName = async (channelId, newName) => {
    if (!(await checkPermission('manage_channels'))) return showToast("Bu işlem için yetkiniz yok!", "error");
    if (!newName) return;
    await updateDoc(doc(db, 'channels', channelId), { name: newName });
};
export const kickMember = async (uid) => {
    if (!currentServerId) return;
    if (!(await checkPermission('kick_members'))) return showToast("Bu işlem için yetkiniz yok!", "error");

    const confirmed = await customConfirm("Üyeyi At", "Bu üyeyi sunucudan atmak istediğinizden emin misiniz?");
    if (!confirmed) return;

    // 1. Sunucu ana listesinden sil
    await updateDoc(doc(db, 'servers', currentServerId), {
        members: arrayRemove(uid)
    });

    // 2. Özel üye listesinden (subcollection) sil
    await deleteDoc(doc(db, 'servers', currentServerId, 'members', uid));

    showToast("Üye başarıyla atıldı.", "info");
};

export const renameChannel = async (channelId, oldName) => {
    if (!(await checkPermission('manage_channels'))) return showToast("Bu işlem için yetkiniz yok!", "error");
    const newName = await customPrompt("Kanalı Yeniden Adlandır", oldName);
    if (newName && newName !== oldName) {
        await updateDoc(doc(db, 'channels', channelId), { name: newName });
    }
};

export const switchChannel = async (channelId, channelName, type = 'text') => {
    // Ses kanalından ayrılıyor olabiliriz (Eğer farklı bir kanala geçiyorsak)
    if (currentVoiceChannelId && currentVoiceChannelId !== channelId) {
        await leaveVoiceChannel(currentVoiceChannelId);
        currentVoiceChannelId = null;
        if (unsubscribeVoiceMembers) unsubscribeVoiceMembers();
        
        const soundEnabled = localStorage.getItem('chatin-sound-enabled') !== 'false';
        if (soundEnabled) leaveSound.play().catch(e => { });
    }

    currentChannelId = channelId;
    currentChannelType = type;
    listenToMessages(channelId);

    if (type === 'voice') {
        currentVoiceChannelId = channelId;
        await joinVoiceChannel(channelId);

        chatHeaderName.innerText = `🔊 ${channelName}`;

        // UI Toggle
        messageList.classList.add('hidden');
        messageInputContainer.classList.add('hidden');
        voiceArea.classList.remove('hidden');

        listenToVoiceParticipants(channelId);
        
        const soundEnabled = localStorage.getItem('chatin-sound-enabled') !== 'false';
        if (soundEnabled) joinSound.play().catch(e => { });
    } else {
        chatHeaderName.innerText = channelName;

        // UI Toggle
        messageList.classList.remove('hidden');
        messageInputContainer.classList.remove('hidden');
        voiceArea.classList.add('hidden');
    }
};

let unsubscribeVoiceMembers = null;
const listenToVoiceParticipants = (channelId) => {
    if (unsubscribeVoiceMembers) unsubscribeVoiceMembers();

    const membersRef = collection(db, 'channels', channelId, 'voice_members');
    unsubscribeVoiceMembers = onSnapshot(membersRef, (snapshot) => {
        voiceGrid.innerHTML = '';
        snapshot.docs.forEach(doc => {
            renderVoiceParticipant(doc.data());
        });
    });
};

const renderVoiceParticipant = (data) => {
    const html = `
        <div class="voice-card" data-uid="${data.uid}" style="cursor: pointer;">
            <img src="${data.photoURL || `https://ui-avatars.com/api/?name=${data.username}&background=random`}" alt="u">
            <span>${data.username}</span>
            <div class="voice-status-icons">
                 <!-- Speaking/Mute icons can go here -->
            </div>
        </div>
    `;
    voiceGrid.insertAdjacentHTML('beforeend', html);

    // Güvenli Tıklama Dinleyicisi
    voiceGrid.lastElementChild.addEventListener('click', () => {
        window.openUserProfile(data);
    });
};

export const assignRoleToMember = async (uid, roleIds) => {
    if (!currentServerId) return;
    const memberRef = doc(db, 'servers', currentServerId, 'members', uid);
    await updateDoc(memberRef, { roles: roleIds });
    showToast("Roller güncellendi!", "success");
};

// Global User Profile Open Handler
window.openUserProfile = async (data) => {
    if (!data || !data.uid) return;
    
    const pfp = document.getElementById('profile-modal-pfp');
    const name = document.getElementById('profile-modal-name');
    const bio = document.getElementById('profile-modal-bio');
    const banner = document.getElementById('profile-modal-banner');
    const editBtn = document.getElementById('open-edit-mode-btn');
    const currentUser = auth.currentUser;

    // 1. Önce eldeki verilerle doldur
    pfp.src = data.photoURL || `https://ui-avatars.com/api/?name=${data.username || 'U'}&background=random`;
    name.innerText = data.username || 'Kullanıcı';
    bio.innerText = data.bio || "Henüz bir biyografi eklenmemiş.";
    if (data.bannerURL) banner.style.backgroundImage = `url(${data.bannerURL})`;
    else banner.style.backgroundImage = 'none';

    // 2. Modalı aç
    const oldPanel = document.getElementById('profile-role-panel');
    if (oldPanel) oldPanel.remove();

    document.getElementById('profile-modal-overlay').classList.remove('hidden');
    document.getElementById('profile-view-mode').classList.remove('hidden');
    document.getElementById('profile-edit-mode').classList.add('hidden');

    // 3. Firestore'dan taze veriyi çek
    try {
        const userDoc = await getDoc(doc(db, 'users', data.uid));
        if (userDoc.exists()) {
            const userData = userDoc.data();
            // Güncelle
            pfp.src = userData.photoURL || pfp.src;
            name.innerText = userData.username || name.innerText;
            bio.innerText = userData.bio || bio.innerText;
            if (userData.bannerURL) banner.style.backgroundImage = `url(${userData.bannerURL})`;

            if (currentUser && currentUser.uid === data.uid) {
                editBtn.classList.remove('hidden');
                document.getElementById('edit-profile-pfp-input').value = userData.photoURL || '';
                document.getElementById('edit-profile-banner-input').value = userData.bannerURL || '';
                document.getElementById('edit-profile-effect-input').value = userData.messageEffect || 'none';
                document.getElementById('edit-profile-name-input').value = userData.username || '';
                document.getElementById('edit-profile-bio-input').value = userData.bio || '';
            } else {
                editBtn.classList.add('hidden');
            }
        }
    } catch (err) {
        console.error("Profil yüklenirken hata:", err);
    }

    // Premium & Rozet Kontrolü
    try {
        const userDoc = await getDoc(doc(db, 'users', data.uid));
        if (userDoc.exists()) {
            const userData = userDoc.data();
            const isPremium = userData.isPremium;

            // Premium Rozeti (🚀)
            const badgeSpot = document.getElementById('premium-badge-spot');
            if (badgeSpot) badgeSpot.innerHTML = isPremium ? '<i data-lucide="zap" style="color: gold; width: 22px; filter: drop-shadow(0 0 5px gold);"></i>' : '';

            // Diğer Rozetler
            const badgesList = document.getElementById('profile-badges');
            if (badgesList) {
                badgesList.innerHTML = '';
                if (isPremium) badgesList.innerHTML += '<div class="role-pill" style="border-color: gold; color: gold; font-size: 9px; padding: 2px 6px;">PREMIUM</div>';
                if (userData.isOwner || data.uid === 'O6VwU1llWheG2PFb9omzx7YqXE82') {
                    badgesList.innerHTML += '<div class="role-pill" style="border-color: #8a2be2; color: #8a2be2; font-size: 9px; padding: 2px 6px;">KURUCU</div>';
                }
                badgesList.innerHTML += '<div class="role-pill" style="border-color: #00ced1; color: #00ced1; font-size: 9px; padding: 2px 6px;">GÖNÜLLÜ TESTER</div>';
            }
            lucide.createIcons();
        }
    } catch (err) {
        console.warn("Rozetler yüklenemedi:", err);
    }

    // Sunucu bağlamı yoksa rol yönetimini atla
    if (!currentServerId || !data.uid || !currentUser) {
        console.log("Rol UI Gösterilemedi - Eksik Veri:", { currentServerId, uid: data?.uid, currentUser: currentUser?.uid });
        return;
    }

    // State'teki ownerUid'i kullan — ek Firestore çağrısı yok
    const isOwner = currentServerOwnerUid === currentUser.uid;
    console.log("Owner Kontrolü:", { currentServerOwnerUid, currentUser: currentUser.uid, isOwner });

    // Kendi rolünü de düzenleyebilmesi için sadece isOwner kontrolü yeterli
    if (isOwner) {
        try {
            const rolesSnap = await getDocs(collection(db, 'servers', currentServerId, 'roles'));

            const rolePanel = document.createElement('div');
            rolePanel.id = 'profile-role-panel';
            rolePanel.style.cssText = 'margin-top: 20px; text-align: left; padding: 12px; background: rgba(0,0,0,0.2); border-radius: 8px;';

            let roleHtml = '<label style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 8px;">ROLLERİ YÖNET</label><div style="display: flex; flex-wrap: wrap; gap: 8px;">';

            rolesSnap.forEach(rDoc => {
                const role = rDoc.data();
                const hasRole = (data.roles || []).includes(rDoc.id);
                roleHtml += `<div class="role-pill" data-id="${rDoc.id}" style="padding: 4px 10px; border-radius: 20px; border: 1px solid ${role.color}; font-size: 12px; cursor: pointer; color: ${hasRole ? 'white' : role.color}; background: ${hasRole ? role.color : 'transparent'}; transition: 0.2s;">${role.name}</div>`;
            });

            if (rolesSnap.empty) {
                roleHtml += '<span style="font-size: 12px; color: var(--text-secondary);">Henüz rol oluşturulmamış. Sunucu Ayarları → Roller</span>';
            }

            roleHtml += '</div>';
            rolePanel.innerHTML = roleHtml;

            const viewMode = document.getElementById('profile-view-mode');
            const editModeBtn = document.getElementById('open-edit-mode-btn');
            if (viewMode && editModeBtn) {
                // NotFoundError çözüm: editModeBtn'in parentNode'unu kullan
                editModeBtn.parentNode.insertBefore(rolePanel, editModeBtn);
            }

            rolePanel.querySelectorAll('.role-pill').forEach(pill => {
                pill.onclick = async () => {
                    const rid = pill.dataset.id;
                    let userRoles = data.roles ? [...data.roles] : [];
                    if (userRoles.includes(rid)) {
                        userRoles = userRoles.filter(id => id !== rid);
                        pill.style.background = 'transparent';
                        pill.style.color = pill.style.borderColor;
                    } else {
                        userRoles.push(rid);
                        pill.style.background = pill.style.borderColor;
                        pill.style.color = 'white';
                    }
                    data.roles = userRoles;
                    await assignRoleToMember(data.uid, userRoles);
                };
            });
        } catch (err) {
            console.warn("Rol paneli yüklenemedi:", err);
        }
    }
};

const listenToMembers = (serverId, ownerUid) => {
    if (unsubscribeMembers) unsubscribeMembers();

    // SADECE BU SUNUCUNUN ÜYELERİNİ DİNLE
    const membersRef = collection(db, 'servers', serverId, 'members');

    unsubscribeMembers = onSnapshot(membersRef, (snapshot) => {
        memberListContainer.innerHTML = '';
        snapshot.docs.forEach(docSnap => {
            const userData = docSnap.data();
            renderMemberItem(userData, serverId, ownerUid);
        });
    });
};

const updateMemberStatusUI = (uid, state) => {
    const memberEl = document.querySelector(`.member-item[data-uid="${uid}"]`);
    if (memberEl) {
        const dot = memberEl.querySelector('.status-dot');
        if (dot) {
            dot.style.background = state === 'online' ? 'var(--success-color)' : '#999';
        }
    }
};

// --- RENDER HELPERS ---

const renderServerIcon = (data, id) => {
    const activeClass = currentServerId === id ? 'active' : '';
    const iconHtml = `
        <div class="server-icon ${activeClass}" data-id="${id}" title="${data.name}">
            ${data.iconURL ? `<img src="${data.iconURL}" style="width:100%; height:100%; object-fit:cover;">` : `<span>${data.name[0]}</span>`}
        </div>
    `;
    serverListContainer.insertAdjacentHTML('beforeend', iconHtml);

    serverListContainer.lastElementChild.addEventListener('click', () => switchServer(id, data));
};

const renderChannelItem = (data, id, isOwner) => {
    const icon = data.type === 'voice' ? 'volume-2' : 'hash';
    const activeStyle = currentChannelId === id ? 'background-color: var(--bg-hover); color: white;' : '';

    const html = `
        <div class="channel-item" data-id="${id}" style="display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 4px; cursor: pointer; color: var(--text-secondary); ${activeStyle} position: relative;">
            <i data-lucide="${icon}" style="width: 16px;"></i> 
            <span style="flex: 1;">${data.name}</span>
            ${isOwner ? `
                <div class="channel-actions" style="display: flex; gap: 4px;">
                    <i data-lucide="edit-3" class="edit-chan-btn" style="width: 12px; cursor: pointer;"></i>
                    <i data-lucide="trash-2" class="delete-chan-btn" style="width: 12px; cursor: pointer;"></i>
                </div>
            ` : ''}
        </div>
    `;

    if (data.type === 'voice') {
        voiceChannelsContainer.insertAdjacentHTML('beforeend', html);
    } else {
        textChannelsContainer.insertAdjacentHTML('beforeend', html);
    }

    const item = data.type === 'voice' ? voiceChannelsContainer.lastElementChild : textChannelsContainer.lastElementChild;
    item.addEventListener('click', (e) => {
        if (!e.target.closest('.channel-actions')) switchChannel(id, data.name, data.type);
    });

    if (isOwner) {
        item.querySelector('.edit-chan-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            window.editingChannelId = id;
            document.getElementById('edit-channel-name-input').value = data.name;
            document.getElementById('edit-channel-modal').classList.remove('hidden');
        });
        item.querySelector('.delete-chan-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteChannel(id);
        });
    }

    lucide.createIcons();
};

// --- KANAL DÜZENLEME MODAL İŞLEMLERİ ---
document.getElementById('save-channel-name-btn').onclick = async () => {
    const newName = document.getElementById('edit-channel-name-input').value.trim();
    if (!newName || !window.editingChannelId) return;

    try {
        await updateChannelName(window.editingChannelId, newName);
        showToast("Kanal ismi başarıyla güncellendi!", "success");
        document.getElementById('edit-channel-modal').classList.add('hidden');
    } catch (err) {
        showToast("Hata: " + err.message, "error");
    }
};

document.getElementById('cancel-edit-channel-btn').onclick = () => {
    document.getElementById('edit-channel-modal').classList.add('hidden');
};

const renderMemberItem = async (data, serverId, ownerUid) => {
    const isOwner = ownerUid === data.uid;
    const canKick = await checkPermission('kick_members');

    // Rol Rengi Belirleme
    let nameColor = 'white';
    if (data.roles && data.roles.length > 0) {
        // En üstteki rolün rengini alalım (ilk rol)
        const roleSnap = await getDoc(doc(db, 'servers', serverId, 'roles', data.roles[0]));
        if (roleSnap.exists()) nameColor = roleSnap.data().color || 'white';
    }

    const html = `
        <div class="member-item" data-uid="${data.uid}" style="cursor: pointer; display: flex; align-items: center; gap: 12px; padding: 8px; border-radius: 8px; transition: 0.2s;">
            <div style="position: relative;">
                <img src="${data.photoURL || `https://ui-avatars.com/api/?name=${data.username}&background=random`}" alt="u" style="width: 32px; height: 32px; border-radius: 50%;">
            </div>
            <span style="font-size: 14px; font-weight: 500; flex: 1; color: ${nameColor};">${data.username}</span>
            ${isOwner ? `<i data-lucide="crown" style="width: 14px; color: gold;" title="Sunucu Sahibi"></i>` : ''}
            ${canKick && data.uid !== auth.currentUser.uid && !isOwner ? `
                <i data-lucide="user-minus" class="kick-btn" style="width: 14px; color: var(--error-color); cursor: pointer;" title="Sunucudan At"></i>
            ` : ''}
        </div>
    `;
    memberListContainer.insertAdjacentHTML('beforeend', html);
    lucide.createIcons();

    const item = memberListContainer.lastElementChild;
    item.addEventListener('click', (e) => {
        if (e.target.closest('.kick-btn')) {
            kickMember(data.uid);
        } else {
            window.openUserProfile(data);
        }
    });
};

// Auth State Listener
auth.onAuthStateChanged(async (user) => {
    if (user) {
        console.log("Logged In:", user.displayName);
        listenToServers();
        listenToFriends();
        listenToFriendRequests();

        // Rehberi sadece giriş yapıldığında başlat
        setTimeout(() => startTour(), 2000);

        // Kullanıcıyı Firestore'a senkronize et
        await syncUserToFirestore(user);
        initGlobalDMListener();

        // ADMIN KONTROLÜ (SADECE SİZİN İÇİN)
        const ADMIN_UID = 'O6VwU1llWheG2PFb9omzx7YqXE82';
        const adminBtn = document.getElementById('admin-launcher-btn');
        if (user.uid === ADMIN_UID) {
            adminBtn.style.display = 'flex';
        } else {
            adminBtn.style.display = 'none';
        }

        // Giriş yapıldığında Ayarlar panelini hazırla
        if (window.openUserSettings) {
             // Opsiyonel: İlk açılışta verileri önceden doldurabiliriz
        }

        // Kullanıcı dökümanını oluştur veya güncelle
        const uRef = doc(db, 'users', user.uid);
        const uSnap = await getDoc(uRef);
        if (!uSnap.exists()) {
            await setDoc(uRef, {
                uid: user.uid,
                username: user.displayName || "Kullanici",
                username_lower: (user.displayName || "").toLowerCase(),
                photoURL: user.photoURL || 'https://via.placeholder.com/150',
                lastSeen: serverTimestamp()
            }, { merge: true });
        } else {
            await updateDoc(uRef, { lastSeen: serverTimestamp() });
        }

        // BEKLEYEN DAVET VAR MI?
        const pendingInvite = sessionStorage.getItem('pendingInvite');
        const urlParams = new URLSearchParams(window.location.search);
        const urlInvite = urlParams.get('invite');
        
        const inviteCode = urlInvite || pendingInvite;

        if (inviteCode) {
            sessionStorage.removeItem('pendingInvite');
            if (urlInvite) {
                // Temiz URL
                window.history.replaceState({}, document.title, window.location.pathname);
            }
            
            try {
                await joinServer(inviteCode);
                showToast(`Davet linki ile katılındı! 🚀`, "success");
            } catch (err) {
                showToast(err.message, "error");
            }
        }

        listenToServers();
    } else {
        console.log("Logged Out");
        document.getElementById('admin-launcher-btn').style.display = 'none';
    }
});

// --- GLOBAL BUTTON LISTENERS ---

// Metin Kanalı Ekleme (+)
document.addEventListener('click', async (e) => {
    const btn = e.target.closest('#add-text-channel-btn');
    if (btn) {
        const name = await customPrompt("Yeni Metin Kanalı", "kanal-adi");
        if (name) await createChannel(name, 'text');
    }
});

// Ses Kanalı Ekleme (+)
document.addEventListener('click', async (e) => {
    const btn = e.target.closest('#add-voice-channel-btn');
    if (btn) {
        const name = await customPrompt("Yeni Ses Kanalı", "Sesli Sohbet");
        if (name) await createChannel(name, 'voice');
    }
});

// Sunucu Başlığına Tıklama -> Sunucu Ayarlarını Aç (Yetkiliyse)
document.getElementById('server-header-btn').onclick = async () => {
    if (!currentServerId) return;
    const canManage = await checkPermission('manage_server');
    if (canManage) {
        document.getElementById('server-settings-modal').classList.remove('hidden');
        loadRoles();
        loadRoleChannelsUI('new-role-channels'); // AYARLAR AÇILDIĞINDA KANALLARI DA YÜKLE

        // Sunucu Verilerini Yükle (Keşfet & Görünüm)
        const serverSnap = await getDoc(doc(db, 'servers', currentServerId));
        if (serverSnap.exists()) {
            const serverData = serverSnap.data();
            
            // Keşfet Ayarları Doldur
            document.getElementById('discovery-public-toggle').checked = serverData.isPublic !== false;
            document.getElementById('discovery-approval-toggle').checked = serverData.requiresApproval === true;
            document.getElementById('discovery-category-select').value = serverData.category || 'genel';
            document.getElementById('discovery-desc-input').value = serverData.description || '';
            document.getElementById('discovery-lang-select').value = serverData.language || 'tr';
            document.getElementById('discovery-tags-input').value = (serverData.tags || []).join(', ');
            document.getElementById('discovery-atmosphere-select').value = serverData.atmosphere || 'default';
            document.getElementById('server-banner-url').value = serverData.bannerURL || '';
            document.getElementById('server-logo-url').value = serverData.logoURL || '';

            // Sahibi Premium mu kontrol et (Temalar için)
            const ownerSnap = await getDoc(doc(db, 'users', serverData.ownerUid));
            const isPremium = ownerSnap.exists() && ownerSnap.data().isPremium;
            const themeArea = document.getElementById('theme-selector-area');

            if (isPremium) {
                themeArea.classList.remove('hidden');
            } else {
                themeArea.classList.add('hidden');
            }
        }
    } else {
        showToast("Sunucu ayarları için yetkiniz yok.", "error");
    }
};

// BANNER & LOGO UPLOAD HANDLERS
const setupImageUpload = (fileId, urlId, label) => {
    const fileInput = document.getElementById(fileId);
    if (!fileInput) return;
    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Max 500KB since it's Firestore Base64
        if (file.size > 500 * 1024) {
            return showToast("Görsel boyutu çok yüksek (Max 500KB)!", "error");
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            document.getElementById(urlId).value = event.target.result;
            showToast(`${label} hazır! Kaydet butonuna basmayı unutma.`, "success");
        };
        reader.readAsDataURL(file);
    };
};
setupImageUpload('server-banner-file', 'server-banner-url', 'Banner');
setupImageUpload('server-logo-file', 'server-logo-url', 'Logo');

// KEŞFET AYARLARINI KAYDET
document.getElementById('save-discovery-settings').onclick = async () => {
    if (!currentServerId) return;
    try {
        const isPublic = document.getElementById('discovery-public-toggle').checked;
        const requiresApproval = document.getElementById('discovery-approval-toggle').checked;
        const category = document.getElementById('discovery-category-select').value;
        const description = document.getElementById('discovery-desc-input').value.trim();
        const language = document.getElementById('discovery-lang-select').value;
        const tags = document.getElementById('discovery-tags-input').value.split(',').map(t => t.trim().replace('#','')).filter(t => t);
        const atmosphere = document.getElementById('discovery-atmosphere-select').value;
        const bannerURL = document.getElementById('server-banner-url').value;
        const logoURL = document.getElementById('server-logo-url').value;

        await updateDoc(doc(db, 'servers', currentServerId), {
            isPublic,
            requiresApproval,
            category,
            description,
            language,
            tags,
            atmosphere,
            bannerURL,
            logoURL
        });

        showToast("Keşfet ayarları başarıyla güncellendi! 🪐", "success");
    } catch (err) {
        showToast("Hata: " + err.message, "error");
    }
};

// Sunucu Ayarları Kapatma
document.getElementById('close-server-settings').onclick = () => {
    document.getElementById('server-settings-modal').classList.add('hidden');
};

// --- ROL OLUŞTURMA FİNAL ---
document.getElementById('add-role-btn-final').onclick = async () => {
    const name = document.getElementById('new-role-name').value.trim();
    const color = document.getElementById('new-role-color').value;
    const permissions = Array.from(document.querySelectorAll('#new-role-permissions input:checked')).map(cb => cb.value);
    const accessibleChannels = Array.from(document.querySelectorAll('#new-role-channels input:checked')).map(cb => cb.value);

    if (!name) return showToast("Rol ismi boş olamaz!", "error");

    try {
        await createRole(name, color, permissions, accessibleChannels);
        showToast("Rol başarıyla oluşturuldu!", "success");
        document.getElementById('new-role-name').value = '';
        loadRoles();
        // Checkboxları sıfırla
        document.querySelectorAll('#new-role-permissions input, #new-role-channels input').forEach(cb => cb.checked = false);
    } catch (err) {
        showToast("Hata: " + err.message, "error");
    }
};

// --- ROL YETKİ VE ERİŞİM KAYDETME ---
document.getElementById('save-role-perms-btn').onclick = async () => {
    if (!window.editingRoleId) return;

    const perms = Array.from(document.querySelectorAll('#role-editor input[data-perm]:checked')).map(cb => cb.dataset.perm);
    const accessibleChannels = Array.from(document.querySelectorAll('#edit-role-channels input:checked')).map(cb => cb.value);

    try {
        await updateDoc(doc(db, 'servers', currentServerId, 'roles', window.editingRoleId), {
            permissions: perms,
            accessibleChannels: accessibleChannels
        });
        showToast("Rol güncellendi!", "success");
        document.getElementById('role-editor').classList.add('hidden');
        loadRoles();
    } catch (err) {
        showToast("Hata: " + err.message, "error");
    }
};

// Ayarlar Sekme Geçişleri
document.querySelectorAll('.settings-nav-item').forEach(item => {
    item.onclick = () => {
        const targetTab = item.dataset.tab;
        
        // Aktif buton görseli
        document.querySelectorAll('.settings-nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        // İçerik geçişi
        const tabs = ['roles', 'members', 'requests', 'discovery'];
        tabs.forEach(tabId => {
            const el = document.getElementById(`${tabId}-tab`);
            if (el) {
                if (tabId === targetTab) {
                    el.classList.remove('hidden');
                } else {
                    el.classList.add('hidden');
                }
            }
        });

        // Sekmeye özel veri yükleme
        if (targetTab === 'roles') {
            loadRoles();
            loadRoleChannelsUI('new-role-channels');
        } else if (targetTab === 'members') {
            loadMembersInSettings();
        } else if (targetTab === 'requests') {
            loadJoinRequests();
        }

    };
});

// --- JOIN REQUESTS LOGIC ---
const loadJoinRequests = async () => {
    const listContainer = document.getElementById('settings-requests-list');
    if (!listContainer || !currentServerId) return;

    listContainer.innerHTML = '<div style="color: grey; text-align: center; padding: 20px;">İstekler taranıyor... 📡</div>';

    try {
        const q = query(collection(db, 'servers', currentServerId, 'joinRequests'), where('status', '==', 'pending'));
        const snap = await getDocs(q);

        if (snap.empty) {
            listContainer.innerHTML = '<div style="color: grey; text-align: center; padding: 20px;">Bekleyen katılım isteği bulunamadı. 🌌</div>';
            return;
        }

        let requests = [];
        snap.forEach(docSnap => {
            const data = docSnap.data();
            data.id = docSnap.id;
            requests.push(data);
        });

        // Client-side sorting (En yeni en üstte)
        requests.sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));

        listContainer.innerHTML = '';
        requests.forEach(data => {
            const requestItem = document.createElement('div');

            requestItem.className = 'role-item'; // Reuse role-item styling for consistency
            requestItem.style.background = 'rgba(255,255,255,0.03)';
            requestItem.style.padding = '16px';
            
            requestItem.innerHTML = `
                <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
                    <img src="${data.photoURL || `https://ui-avatars.com/api/?name=${data.username}&background=random`}" style="width: 32px; height: 32px; border-radius: 50%;">
                    <div>
                        <div style="font-weight: 700; color: white;">${data.username}</div>
                        <div style="font-size: 11px; color: var(--text-secondary);">${new Date(data.requestedAt).toLocaleString()}</div>
                    </div>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button class="approve-req-btn auth-btn" data-uid="${data.uid}" style="background: var(--success-color); padding: 6px 12px; font-size: 11px; width: auto;">ONAYLA</button>
                    <button class="reject-req-btn auth-btn" data-uid="${data.uid}" style="background: var(--error-color); padding: 6px 12px; font-size: 11px; width: auto;">REDDET</button>
                </div>
            `;
            listContainer.appendChild(requestItem);
        });

        // Event Listeners for buttons
        listContainer.querySelectorAll('.approve-req-btn').forEach(btn => {
            btn.onclick = () => approveJoinRequest(btn.dataset.uid);
        });
        listContainer.querySelectorAll('.reject-req-btn').forEach(btn => {
            btn.onclick = () => rejectJoinRequest(btn.dataset.uid);
        });

    } catch (err) {
        listContainer.innerHTML = `<div style="color: var(--error-color); text-align: center;">Hata: ${err.message}</div>`;
    }
};

const approveJoinRequest = async (userId) => {
    if (!currentServerId || !userId) return;

    try {
        const serverRef = doc(db, 'servers', currentServerId);
        const serverSnap = await getDoc(serverRef);
        if (!serverSnap.exists()) return;

        const serverData = serverSnap.data();
        const requestRef = doc(db, 'servers', currentServerId, 'joinRequests', userId);
        const requestSnap = await getDoc(requestRef);
        if (!requestSnap.exists()) return;

        const userData = requestSnap.data();

        // 1. Üye listesini güncelle
        await updateDoc(serverRef, {
            members: arrayUnion(userId),
            memberCount: (serverData.memberCount || 0) + 1
        });

        // 2. Sub-collection'a ekle
        await setDoc(doc(db, 'servers', currentServerId, 'members', userId), {
            uid: userId,
            username: userData.username,
            photoURL: userData.photoURL,
            joinedAt: Date.now(),
            roles: []
        });

        // 3. İsteği sil
        await deleteDoc(requestRef);

        showToast(`${userData.username} artık bu galaksinin bir parçası! 🚀`, "success");
        
        // Hoş geldin mesajı gönder
        const channelsSnap = await getDocs(query(collection(db, 'servers', currentServerId, 'channels'), limit(1)));
        if (!channelsSnap.empty) {
            const firstChannelId = channelsSnap.docs[0].id;
            await addDoc(collection(db, 'messages'), {
                channelId: firstChannelId,
                text: `✨ Yolcu **${userData.username}** galaksimize iniş yaptı! Hoş geldin!`,
                uid: 'galactic_guide_bot',
                username: 'Galaktik Rehber',
                photoURL: 'https://cdn-icons-png.flaticon.com/512/2592/2592231.png',
                createdAt: serverTimestamp(),
                isBot: true
            });
        }
        
        loadJoinRequests(); // Listeyi yenile
    } catch (err) {
        showToast("Onaylama hatası: " + err.message, "error");
    }
};

const rejectJoinRequest = async (userId) => {
    if (!currentServerId || !userId) return;

    try {
        const requestRef = doc(db, 'servers', currentServerId, 'joinRequests', userId);
        await deleteDoc(requestRef);
        showToast("İstek reddedildi.", "info");
        loadJoinRequests();
    } catch (err) {
        showToast("Reddetme hatası: " + err.message, "error");
    }
};


const loadPremiumStatus = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    const isPremium = userDoc.exists() && userDoc.data().isPremium;

    const indicator = document.getElementById('premium-status-indicator');
    const statusText = document.getElementById('p-status-text');
    const buyBtn = document.getElementById('buy-premium-btn');
    const themeArea = document.getElementById('theme-selector-area');

    if (isPremium) {
        if (indicator) indicator.style.background = 'rgba(255, 215, 0, 0.2)';
        if (statusText) statusText.innerText = "TEBRİKLER, PREMIUM ÜYESİNİZ! 🚀";
        if (buyBtn) buyBtn.classList.add('hidden');
        if (themeArea) themeArea.classList.remove('hidden');
    } else {
        if (indicator) indicator.style.background = 'rgba(255, 215, 0, 0.05)';
        if (statusText) statusText.innerText = "PREMIUM DEĞİLSİNİZ";
        if (buyBtn) buyBtn.classList.remove('hidden');
        if (themeArea) themeArea.classList.add('hidden');
    }
};

const buyPremiumBtn = document.getElementById('buy-premium-btn');
if (buyPremiumBtn) {
    buyPremiumBtn.onclick = async () => {
        const user = auth.currentUser;
        if (!user) return;

        const confirmed = await customConfirm("Premium Talebi", "Şu anda ödeme altyapımız bakımda olduğundan talebiniz manuel olarak incelenecektir. Yöneticiye Premium talebi göndermek istiyor musunuz?");
        if (confirmed) {
            try {
                await setDoc(doc(db, 'premium_requests', user.uid), {
                    uid: user.uid,
                    username: user.displayName || user.username || "Kullanıcı",
                    status: 'pending',
                    createdAt: serverTimestamp()
                });
                showToast("Talebin galaktik komuta merkezine iletildi. Onaylanınca haberin olacak!", "success");
            } catch (err) {
                showToast("Talebin iletilemedi: " + err.message, "error");
            }
        }
    };
}

// --- ADMIN PANELİ (KOMUTA MERKEZİ) MANTIĞI ---
// (Consolidated premium requests listener)

document.getElementById('admin-launcher-btn').onclick = () => {
    document.getElementById('admin-panel-modal').classList.remove('hidden');
    listenToPremiumRequests();
};

const listenToPremiumRequests = () => {
    const list = document.getElementById('admin-request-list');
    list.innerHTML = '<div style="display: flex; justify-content: center; padding: 40px;"><i class="lucide-refresh-cw spin" style="color: gold; width: 40px; height: 40px;"></i></div>';

    if (unsubscribePremiumRequests) unsubscribePremiumRequests();

    unsubscribePremiumRequests = onSnapshot(collection(db, 'premium_requests'), (snapshot) => {
        list.innerHTML = '';
        if (snapshot.empty) {
            list.innerHTML = '<p style="color: var(--text-secondary); text-align: center; margin-top: 20px;">Henüz bekleyen talep yok.</p>';
            return;
        }

        snapshot.docs.forEach(docSnap => {
            const req = docSnap.data();
            const date = req.createdAt?.toDate() ? req.createdAt.toDate().toLocaleDateString() : 'Bilinmiyor';
            const card = document.createElement('div');
            card.style.cssText = `
                background: rgba(255,255,255,0.03); 
                padding: 16px 20px; 
                border-radius: 16px; 
                display: flex; 
                align-items: center; 
                justify-content: space-between; 
                border: 1px solid rgba(255,215,0,0.1);
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            `;
            card.onmouseenter = () => {
                card.style.background = 'rgba(255,215,0,0.05)';
                card.style.borderColor = 'rgba(255,215,0,0.3)';
                card.style.transform = 'translateX(5px)';
            };
            card.onmouseleave = () => {
                card.style.background = 'rgba(255,255,255,0.03)';
                card.style.borderColor = 'rgba(255,215,0,0.1)';
                card.style.transform = 'none';
            };

            card.innerHTML = `
                <div style="display: flex; align-items: center; gap: 15px;">
                    <div style="width: 45px; height: 45px; background: gold; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: black; font-weight: 900; font-size: 20px;">
                        ${req.username ? req.username.charAt(0).toUpperCase() : '?'}
                    </div>
                    <div>
                        <p style="color: white; font-weight: 800; font-size: 16px; margin: 0;">${req.username || 'Bilinmeyen Üye'}</p>
                        <p style="color: grey; font-size: 11px; margin: 2px 0;">ID: ${docSnap.id}</p>
                        <p style="color: gold; font-size: 10px; font-weight: 700; opacity: 0.8;">📅 TALEP TARİHİ: ${date}</p>
                    </div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="auth-btn" style="width: auto; background: gold; color: black; padding: 10px 15px; font-size: 11px; font-weight: 900; border-radius: 10px;" id="approve-${docSnap.id}">
                        ONAYLA
                    </button>
                    <button class="auth-btn" style="width: auto; background: rgba(255,0,0,0.2); color: #ff4d4d; border: 1px solid rgba(255,0,0,0.3); padding: 10px 15px; font-size: 11px; font-weight: 900; border-radius: 10px;" id="reject-${docSnap.id}">
                        REDDET
                    </button>
                </div>
            `;
            list.appendChild(card);

            document.getElementById(`approve-${docSnap.id}`).onclick = async () => {
                try {
                    const uRef = doc(db, 'users', docSnap.id);
                    await setDoc(uRef, { isPremium: true }, { merge: true });
                    await deleteDoc(doc(db, 'premium_requests', docSnap.id));
                    showToast(`${req.username} artık Premium! 🚀`, "success");
                } catch (err) {
                    showToast("Onay hatası: " + err.message, "error");
                }
            };

            document.getElementById(`reject-${docSnap.id}`).onclick = async () => {
                try {
                    await deleteDoc(doc(db, 'premium_requests', docSnap.id));
                    showToast("Talep reddedildi.", "info");
                } catch (err) {
                    showToast("Red hatası: " + err.message, "error");
                }
            };
        });
        lucide.createIcons();
    });
};

const themes = {
    default: { brand: '#c5a059', bg: '#05060f', side: 'rgba(10, 11, 24, 0.95)' },
    solar: { brand: '#e94560', bg: '#1a1a2e', side: '#16213e' },
    nebula: { brand: '#a000ff', bg: '#10002b', side: '#240046' },
    cyberpunk: { brand: '#00ffcc', bg: '#0a0a0a', side: 'rgba(20, 20, 20, 0.95)' },
    gold: { brand: '#ffd700', bg: '#111111', side: 'rgba(20, 20, 20, 0.9)' }
};

document.querySelectorAll('.theme-option').forEach(btn => {
    btn.onclick = async () => {
        const themeKey = btn.dataset.theme;
        
        if (themeKey === 'cyberpunk' || themeKey === 'gold') {
            const serverSnap = await getDoc(doc(db, 'servers', currentServerId));
            if (serverSnap.exists()) {
                const ownerUid = serverSnap.data().ownerUid;
                const ownerSnap = await getDoc(doc(db, 'users', ownerUid));
                const isPremium = ownerSnap.exists() && ownerSnap.data().isPremium;

                if (!isPremium) {
                    return showToast("Bu tema sadece Premium sunucular içindir! 👑", "error");
                }
            }
        }

        const theme = themes[themeKey];
        document.documentElement.style.setProperty('--brand-color', theme.brand);
        document.documentElement.style.setProperty('--bg-deep', theme.bg);
        document.documentElement.style.setProperty('--bg-side', theme.side);
        showToast(`Tema güncellendi: ${btn.dataset.theme}`, "success");
    };
});

const saveCustomInviteBtn = document.getElementById('save-custom-invite');
if (saveCustomInviteBtn) {
    saveCustomInviteBtn.onclick = async () => {
        if (!currentServerId) return;
        const newCode = document.getElementById('custom-invite-input').value.trim();
        if (!newCode) return;

        if (newCode.length < 3) return showToast("Özel kod en az 3 karakter olmalı!", "error");

        try {
            const serverSnap = await getDoc(doc(db, 'servers', currentServerId));
            if (!serverSnap.exists()) return;

            const ownerUid = serverSnap.data().ownerUid;
            const ownerSnap = await getDoc(doc(db, 'users', ownerUid));
            const isPremium = ownerSnap.exists() && ownerSnap.data().isPremium;

            if (!isPremium) {
                return showToast("Özel davet kodu sadece Premium sunucular içindir! 💎", "error");
            }

            // Çakışma kontrolü
            const q = query(collection(db, 'servers'), where('inviteCode', '==', newCode));
            const snap = await getDocs(q);

            // Kendi kodumuzsa sorun yok, başkasınındaysa hata ver
            const isAlreadyTakenByOthers = snap.docs.some(d => d.id !== currentServerId);
            if (isAlreadyTakenByOthers) {
                return showToast("Bu galaktik kod zaten başka bir sunucu tarafından kapılmış! 🛸", "error");
            }

            await updateDoc(doc(db, 'servers', currentServerId), { inviteCode: newCode });
            showToast(`Özel bağlantın artık aktif: chatin/invite/${newCode} ✨`, "success");
        } catch (err) {
            console.error(err);
            showToast("Davet kodu güncellenirken hata oluştu!", "error");
        }
    };
}



document.getElementById('delete-server-btn-trigger').onclick = () => {
    deleteServer(currentServerId);
};

// Sunucu Ekleme Modalı Aç
document.addEventListener('click', (e) => {
    const btn = e.target.closest('#add-server-btn');
    if (btn) {
        document.getElementById('create-server-modal').classList.remove('hidden');
    }
});


// MODALLARI KAPAT (X Butonları, İptal Butonları veya Boşluğa Tıklama)
document.addEventListener('mousedown', (e) => {
    const isCancelBtn = e.target.closest('#cancel-server-btn') || e.target.closest('#cancel-join-btn') || e.target.closest('#cancel-profile-btn');
    const isCloseIcon = e.target.closest('.close-modal') || e.target.closest('#close-voice-settings');
    const isOverlay = e.target.id.endsWith('-modal'); // Arka plana tıklandıysa (IDsı -modal ile bitenler)

    if (isCancelBtn || isCloseIcon || isOverlay) {
        const modals = document.querySelectorAll('[id$="-modal"]');
        modals.forEach(m => m.classList.add('hidden'));
    }
});

// SUNUCU KURMA (MODAL FINAL BUTONU)
document.addEventListener('click', async (e) => {
    if (e.target.closest('#create-server-final-btn')) {
        const nameInput = document.getElementById('server-name-input');
        const catInput = document.getElementById('server-category-input');
        const descInput = document.getElementById('server-description-input');
        const publicCheck = document.getElementById('server-public-checkbox');
        const approvalCheck = document.getElementById('server-approval-checkbox');

        const name = nameInput.value.trim();
        if (!name) return showToast("Sunucu adı boş olamaz!", "error");

        try {
            await createServer({
                name: name,
                category: catInput.value,
                description: descInput.value.trim(),
                isPublic: publicCheck.checked,
                requiresApproval: approvalCheck.checked
            });
            document.getElementById('create-server-modal').classList.add('hidden');
            
            // Clear fields
            nameInput.value = '';
            descInput.value = '';
            
            showToast("Güneş Sistemi'nde yeni bir sunucu doğdu!", "success");
            listenToServers(); // Listeyi yenile
        } catch (err) {
            showToast(err.message, "error");
        }
    }
});

// SUNUCUYA KATILMA (MODAL FINAL BUTONU)
// ANA TIKLAMA DİNLEYİCİSİ (GLOBAL EVENT DELEGATION)
document.addEventListener('click', async (e) => {
    // MODAL KAPATMA BUTONLARI (X)
    if (e.target.closest('#settings-close-btn')) document.getElementById('user-settings-modal')?.classList.add('hidden');
    if (e.target.closest('#close-server-settings')) document.getElementById('server-settings-modal')?.classList.add('hidden');
    if (e.target.closest('#close-friends-btn')) document.getElementById('friends-modal')?.classList.add('hidden');
    if (e.target.closest('#close-profile-btn')) document.getElementById('profile-modal-overlay')?.classList.add('hidden');
    if (e.target.closest('#close-voice-settings')) document.getElementById('voice-settings-modal')?.classList.add('hidden');

    // 1. Sunucuya Katılma (Modal Butonu)
    if (e.target.closest('#join-server-final-btn')) {
        const inviteInput = document.getElementById('join-invite-input');
        const code = inviteInput.value.trim();
        if (!code) return showToast("Davet kodu girmelisin!", "error");
        try {
            await joinServer(code);
            document.getElementById('join-server-modal').classList.add('hidden');
            inviteInput.value = '';
            listenToServers();
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    // 2. Ayarlar Popover Kontrolü
    const settingsBtn = e.target.closest('#settings-btn');
    const popover = document.getElementById('settings-popover');
    if (settingsBtn) {
        e.stopPropagation();
        popover?.classList.toggle('hidden');
        lucide.createIcons();
    } else if (popover && !popover.contains(e.target)) {
        popover.classList.add('hidden');
    }

    // 3. Profil Görüntüleme
    const profileBtn = e.target.closest('#user-profile-btn') || e.target.closest('#open-profile-edit');
    if (profileBtn) {
        const user = auth.currentUser;
        if (user && window.openUserProfile) {
            window.openUserProfile({
                uid: user.uid,
                username: user.displayName || "Kullanıcı",
                photoURL: user.photoURL
            });
        }
    }

    // 4. Hesap Ayarları Modalı
    if (e.target.closest('#open-account-settings')) {
        document.getElementById('account-settings-modal')?.classList.remove('hidden');
    }

    // 5. Oturumu Kapat
    if (e.target.closest('#logout-btn-trigger')) {
        const confirmed = await customConfirm("Oturumu Kapat", "Galaksiden ayrılmak istediğinize emin misiniz?");
        if (confirmed) {
            await signOut(auth);
            window.location.reload();
        }
    }

    // --- SES KANALI AKSİYONLARI ---

    // Mikrofon Kontrolü (Global Alt Bar + Ses Paneli)
    const micBtn = e.target.closest('#mic-btn');
    const vMicActive = e.target.closest('#voice-mic-active');
    if (micBtn || vMicActive) {
        isMicMuted = !isMicMuted;
        toggleLocalMic(!isMicMuted);
        
        const mainMic = document.getElementById('mic-btn');
        const sideMic = document.getElementById('voice-mic-active');
        [mainMic, sideMic].forEach(btn => {
            if (btn) {
                btn.classList.toggle('off', isMicMuted);
                const icon = btn.querySelector('i, svg');
                if (icon) icon.setAttribute('data-lucide', isMicMuted ? 'mic-off' : 'mic');
                btn.title = isMicMuted ? "Sesi Aç" : "Sesi Kapat";
            }
        });
        lucide.createIcons();
        showToast(isMicMuted ? "Mikrofon kapatıldı" : "Mikrofon açıldı");
    }

    // Kulaklık / Sağırlaştırma
    const deafenBtn = e.target.closest('#deafen-btn');
    if (deafenBtn) {
        isDeafened = !isDeafened;
        document.querySelectorAll('audio').forEach(audio => {
            if (audio.id.startsWith('audio-')) audio.muted = isDeafened;
        });
        const icon = deafenBtn.querySelector('i, svg');
        if (icon) icon.setAttribute('data-lucide', isDeafened ? 'volume-x' : 'headphones');
        deafenBtn.classList.toggle('off', isDeafened);
        deafenBtn.title = isDeafened ? "Sesi Aç" : "Sağırlaştır";
        lucide.createIcons();
        showToast(isDeafened ? "Sesler kapatıldı" : "Sesler açıldı");
    }

    // Ekran Paylaşımı
    const voiceScreen = e.target.closest('#voice-screen-share');
    if (voiceScreen) {
        const isSharing = !voiceScreen.classList.contains('sharing');
        if (isSharing) {
            const success = await startScreenShare();
            if (success) {
                voiceScreen.classList.add('sharing');
                voiceScreen.style.color = 'var(--brand-color)';
            }
        } else {
            await stopScreenShare();
            voiceScreen.classList.remove('sharing');
            voiceScreen.style.color = 'white';
        }
    }

    // Ses Kanalından Ayrılma
    if (e.target.closest('#disconnect-voice-btn')) {
        if (currentVoiceChannelId) {
            await leaveVoiceChannel(currentVoiceChannelId);
            currentVoiceChannelId = null;
            if (unsubscribeVoiceMembers) unsubscribeVoiceMembers();
            
            const soundEnabled = localStorage.getItem('chatin-sound-enabled') !== 'false';
            if (soundEnabled) leaveSound.play().catch(e => { });

            showToast("Ses kanalından ayrıldınız.", "info");

            // İlk Metin Kanalına Dön
            const textChannels = document.querySelectorAll('#text-channels-container .channel-item');
            if (textChannels.length > 0) {
                const firstChan = textChannels[0];
                switchChannel(firstChan.dataset.id, firstChan.querySelector('span').innerText, 'text');
            } else {
                voiceArea.classList.add('hidden');
                messageList.classList.remove('hidden');
                messageInputContainer.classList.remove('hidden');
                chatHeaderName.innerText = "Kanal Seçin";
            }
        }
    }

    // Ses Ayarları ve Mobil Menü
    if (e.target.closest('#voice-settings-active')) {
        document.getElementById('voice-settings-modal')?.classList.remove('hidden');
        lucide.createIcons();
    }
    if (e.target.closest('#mobile-sidebar-toggle')) {
        document.body.classList.toggle('show-sidebar');
        document.body.classList.remove('show-members');
    }
    if (e.target.closest('#mobile-members-toggle')) {
        document.body.classList.toggle('show-members');
        document.body.classList.remove('show-sidebar');
    }
    if (e.target.closest('#chat-messages') || e.target.closest('#chat-input')) {
        document.body.classList.remove('show-sidebar');
        document.body.classList.remove('show-members');
    }
});



// --- PREMIUM KARŞILAMA MODAL BUTONLARI ---
const reqPremiumWelcomeBtn = document.getElementById('request-premium-welcome-btn');
if (reqPremiumWelcomeBtn) {
    reqPremiumWelcomeBtn.onclick = async () => {
        const user = auth.currentUser;
        if (!user) return;
        try {
            await setDoc(doc(db, 'premium_requests', user.uid), {
                uid: user.uid,
                username: user.displayName || "Kullanıcı",
                status: 'pending',
                createdAt: serverTimestamp()
            });
            showToast("Premium talebin iletildi! ✨", "success");
            document.getElementById('premium-welcome-modal').classList.add('hidden');
        } catch (err) {
            showToast("Hata: " + err.message, "error");
        }
    };
}

const closePremiumWelcomeBtn = document.getElementById('close-premium-welcome-btn');
if (closePremiumWelcomeBtn) {
    closePremiumWelcomeBtn.onclick = () => {
        document.getElementById('premium-welcome-modal').classList.add('hidden');
    };
}

// --- KULLANICI AYARLARI MANTIĞI ---
const openUserSettings = async (tab = 'account') => {
    console.log("Ayarlar açılıyor, sekme:", tab);
    const user = auth.currentUser;
    
    const modal = document.getElementById('user-settings-modal');
    if (!modal) return console.error("Ayarlar modali bulunamadı!");
    
    modal.classList.remove('hidden');

    const nameDisplay = document.getElementById('settings-name-display');
    const emailDisplay = document.getElementById('settings-email-display');
    const pfpPreview = document.getElementById('settings-pfp-preview');

    if (!user) {
        if (nameDisplay) nameDisplay.innerText = "Giriş Yapılmadı";
        return;
    }

    // 1. Önce auth verileriyle doldur (Hızlı yükleme)
    if (nameDisplay) nameDisplay.innerText = user.displayName || 'İsimsiz Üye';
    if (emailDisplay) emailDisplay.innerText = user.email || 'E-posta Yok';
    if (pfpPreview) pfpPreview.src = user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName || 'U'}`;

    // 2. Sekmeyi değiştir
    switchSettingsTab(tab);

    // 3. Firestore'dan en güncel veriyi çek ve güncelle
    try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
            const userData = userDoc.data();
            const isPremium = userData.isPremium || false;

            if (nameDisplay) nameDisplay.innerText = userData.username || user.displayName || 'İsimsiz Üye';
            if (pfpPreview) pfpPreview.src = userData.photoURL || user.photoURL || `https://ui-avatars.com/api/?name=${userData.username || 'U'}`;

            // Premium kutusunu güncelle
            const premBox = document.getElementById('settings-premium-box');
            if (premBox) {
                if (isPremium) {
                    premBox.style.borderColor = 'gold';
                    premBox.style.background = 'rgba(255,215,0,0.05)';
                    premBox.innerHTML = `
                        <i data-lucide="shield-check" style="width: 60px; height: 60px; color: gold; margin-bottom: 20px;"></i>
                        <h3 style="color: gold; font-size: 20px;">AKTİF PREMIUM ÜYE</h3>
                        <div style="width: 100%; margin-top: 20px; background: rgba(255,255,255,0.05); border-radius: 10px; padding: 10px; border: 1px solid var(--border-gold);">
                            <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 5px;">
                                <span>KOZMİK SEVİYE: ${userData.level || 1}</span>
                                <span>XP: ${userData.xp || 0} / ${(userData.level || 1) * 100}</span>
                            </div>
                            <div style="width: 100%; height: 6px; background: #000; border-radius: 3px; overflow: hidden;">
                                <div style="width: ${(userData.xp || 0) / ((userData.level || 1) * 100) * 100}%; height: 100%; background: var(--brand-color); box-shadow: 0 0 10px var(--brand-color);"></div>
                            </div>
                        </div>
                        <p style="color: var(--text-secondary); margin-top: 15px;">Galaktik Chatin ayrıcalıklarının tadını çıkarıyorsun! 🚀</p>
                    `;
                } else {
                    premBox.style.borderColor = 'rgba(255,255,255,0.05)';
                    premBox.style.background = 'rgba(255,255,255,0.02)';
                    premBox.innerHTML = `
                        <i data-lucide="shield-alert" style="width: 60px; height: 60px; color: grey; margin-bottom: 20px; opacity: 0.5;"></i>
                        <h3 style="color: white; font-size: 20px;">Henüz Premium Değilsiniz</h3>
                        <p style="color: var(--text-secondary); margin-bottom: 25px;">Galaktik bannerlar, özel mesaj efektleri ve daha fazlası için Premium'a geçin.</p>
                        <button class="auth-btn buy-premium-trigger" style="background: gold; color: black; font-weight: 900;">HEMEN PREMIUM OL</button>
                    `;
                }
                if (window.lucide) lucide.createIcons();
            }
        }
    } catch (err) {
        console.warn("Firestore'dan ayarlar çekilemedi (Normal olabilir):", err);
    }
};
window.openUserSettings = openUserSettings;

const switchSettingsTab = (tabId) => {
    // Nav itemları güncelle
    document.querySelectorAll('.user-settings-nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tabId);
    });
    // İçerikleri güncelle
    document.querySelectorAll('.settings-tab-content').forEach(content => {
        content.classList.toggle('hidden', content.id !== `settings-tab-${tabId}`);
    });
};

// Sekme Tıklamaları
document.querySelectorAll('.user-settings-nav-item[data-tab]').forEach(item => {
    item.onclick = () => switchSettingsTab(item.dataset.tab);
});

// Kapatma
document.getElementById('settings-close-btn').onclick = () => {
    document.getElementById('user-settings-modal').classList.add('hidden');
};

// --- THEME SELECTION FOR USER SETTINGS ---
document.querySelectorAll('.theme-card').forEach(card => {
    card.onclick = async () => {
        const user = auth.currentUser;
        if (!user) return;

        const themeKey = card.dataset.theme;
        
        // Default tema dışındakiler Premium kontrolü gerektirir
        if (themeKey !== 'default') {
            const userDoc = await getDoc(doc(db, 'users', user.uid));
            const isPremium = userDoc.exists() && userDoc.data().isPremium;

            if (!isPremium) {
                return showToast("Bu tema sadece Premium üyelere özeldir! 👑", "error");
            }
        }

        applyTheme(themeKey);
        localStorage.setItem('chatin-theme', themeKey);
        
        // UI Güncelleme (active class)
        document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        
        showToast(`Tema başarıyla uygulandı: ${themeKey.toUpperCase()}`, "success");
    };
});

// Helper for theme applying
const applyTheme = (themeKey) => {
    const themes = {
        default: { brand: '#c5a059', bg: '#05060f', side: 'rgba(10, 11, 24, 0.95)' },
        solar: { brand: '#e94560', bg: '#1a1a2e', side: '#16213e' },
        nebula: { brand: '#a000ff', bg: '#10002b', side: '#240046' },
        cyberpunk: { brand: '#00ffcc', bg: '#0a0a0a', side: 'rgba(20, 20, 20, 0.95)' },
        gold: { brand: '#ffd700', bg: '#111111', side: 'rgba(20, 20, 20, 0.9)' }
    };
    const theme = themes[themeKey];
    if (theme) {
        document.documentElement.style.setProperty('--brand-color', theme.brand);
        document.documentElement.style.setProperty('--bg-deep', theme.bg);
        document.documentElement.style.setProperty('--bg-side', theme.side);
    }
};

// --- GLOBAL PREMIUM REQUEST TRIGGER ---
document.addEventListener('click', (e) => {
    if (e.target.closest('.buy-premium-trigger')) {
        const buyBtn = document.getElementById('buy-premium-btn');
        if (buyBtn) buyBtn.click(); // Mevcut premium talep mantığını tetikle
    }
});

// Şifre Sıfırlama
document.getElementById('reset-password-btn').onclick = async () => {
    const user = auth.currentUser;
    if (user && user.email) {
        try {
            await sendPasswordResetEmail(auth, user.email);
            showToast("Şifre sıfırlama bağlantısı e-postana gönderildi! 📧", "success");
        } catch (err) {
            showToast("E-posta gönderilemedi: " + err.message, "error");
        }
    }
};



// YAZI BOYUTU
document.getElementById('font-size-slider').oninput = (e) => {
    const val = e.target.value;
    document.documentElement.style.setProperty('--chat-font-size', val + 'px');
    localStorage.setItem('chatin-font-size', val);
};

// BİLDİRİM SESİ
document.getElementById('notif-sound-toggle').onchange = (e) => {
    localStorage.setItem('chatin-sound-enabled', e.target.checked);
};

// ÇIKIŞ
document.getElementById('direct-logout-btn').onclick = async () => {
    if (confirm("Galaksiden ayrılmak istediğine emin misin? 🌠")) {
        await signOut(auth);
        location.reload();
    }
};

// SAYFA YÜKLENDİĞİNDE AYARLARI UYGULA
const initSettings = () => {
    const savedTheme = localStorage.getItem('chatin-theme') || 'default';
    const savedFont = localStorage.getItem('chatin-font-size') || '14';
    const soundEnabled = localStorage.getItem('chatin-sound-enabled') !== 'false';

    applyTheme(savedTheme);
    document.documentElement.style.setProperty('--chat-font-size', savedFont + 'px');
    document.getElementById('font-size-slider').value = savedFont;
    document.getElementById('notif-sound-toggle').checked = soundEnabled;

    // Aktif tema kartını işaretle
    document.querySelectorAll('.theme-card').forEach(c => c.classList.toggle('active', c.dataset.theme === savedTheme));
};

// Init settings after small delay or directly
setTimeout(initSettings, 500);

// --- GALACTIC WIZARD (ONBOARDING) ---
const tourSteps = [
    {
        title: "Hoş Geldin Pilot!",
        body: "Chatin galaksisine ilk adımını attın. Sana gemi kontrollerini hızlıca öğreteyim.",
        target: null, 
        position: "center"
    },
    {
        title: "Sunucu Filosu",
        body: "Katıldığın tüm galaksiler (sunucular) burada listelenir. Yeni bir tane oluşturabilir veya keşfe çıkabilirsin.",
        target: "#server-sidebar",
        position: "right"
    },
    {
        title: "Haberleşme Kanalları",
        body: "Her galaksinin kendi kanalları vardır. Yazılı kanallarda mesajlaşabilir, sesli kanallarda telsiz bağlantısı kurabilirsin.",
        target: "#channel-list",
        position: "right"
    },
    {
        title: "Galaktik Keşif",
        body: "Yeni dünyalar ve topluluklar keşfetmek için bu pusulayı kullanabilirsin!",
        target: "#explore-btn",
        position: "right"
    },
    {
        title: "Kişisel Kontroller",
        body: "Profilini buradan düzenleyebilir, ses ayarlarını yapabilir veya gelişmiş ayarlara ulaşabilirsin.",
        target: "#user-status-bar",
        position: "top"
    },
    {
        title: "Galaktik Ayrıcalıklar",
        body: "Premium'a geçerek özel temalar, mesaj efektleri ve daha fazlasına sahip olabilirsin. Galaksinin en parlak yıldızı sen ol!",
        target: "#settings-btn",
        position: "top"
    }
];

let currentTourStep = 0;

const renderTourStep = () => {
    const step = tourSteps[currentTourStep];
    const card = document.getElementById("wizard-card");
    const body = document.getElementById("wizard-body");
    const nextBtn = document.getElementById("wizard-next-btn");
    const overlay = document.getElementById("wizard-overlay");

    document.querySelectorAll(".spotlight-active").forEach(el => el.classList.remove("spotlight-active"));

    if (!card || !body || !nextBtn || !overlay) return;

    const titleSpan = document.querySelector(".wizard-header span");
    if (titleSpan) titleSpan.innerText = step.title;

    body.innerHTML = step.body;
    nextBtn.innerText = currentTourStep === tourSteps.length - 1 ? "Galaksiyi Keşfet!" : "Devam Et";

    // Reset card and overlay
    card.style.transform = "none";
    card.style.top = "auto";
    card.style.left = "auto";
    card.style.right = "auto";
    card.style.bottom = "auto";
    overlay.style.clipPath = "none";

    if (step.target) {
        const el = document.querySelector(step.target);
        if (el) {
            el.classList.add("spotlight-active");
            const rect = el.getBoundingClientRect();
            const pad = 10;
            
            // Create hole in overlay using clip-path
            const l = rect.left - pad, t = rect.top - pad, r = rect.right + pad, b = rect.bottom + pad;
            overlay.style.clipPath = `polygon(0% 0%, 0% 100%, 100% 100%, 100% 0%, 0% 0%, ${l}px ${t}px, ${r}px ${t}px, ${r}px ${b}px, ${l}px ${b}px, ${l}px ${t}px)`;
            
            if (step.position === "right") {
                card.style.top = rect.top + "px";
                card.style.left = (rect.right + 25) + "px";
            } else if (step.position === "top") {
                card.style.bottom = (window.innerHeight - rect.top + 25) + "px";
                card.style.left = rect.left + "px";
            }
        }
    } else {
        card.style.top = "50%";
        card.style.left = "50%";
        card.style.transform = "translate(-50%, -50%)";
    }

    if (window.lucide) lucide.createIcons();
};

const startTour = () => {
    const hasSeenTour = localStorage.getItem("chatin-tour-completed");
    if (hasSeenTour) return;

    const container = document.getElementById("wizard-container");
    if(container) {
        container.classList.remove("hidden");
        renderTourStep();
    }
};

const wizNext = document.getElementById("wizard-next-btn");
if(wizNext) {
    wizNext.onclick = () => {
        currentTourStep++;
        if (currentTourStep < tourSteps.length) {
            renderTourStep();
        } else {
            completeTour();
        }
    };
}

const wizSkip = document.getElementById("wizard-skip-btn");
if(wizSkip) {
    wizSkip.onclick = () => completeTour();
}

const completeTour = () => {
    document.getElementById("wizard-container").classList.add("hidden");
    document.querySelectorAll(".spotlight-active").forEach(el => el.classList.remove("spotlight-active"));
    localStorage.setItem("chatin-tour-completed", "true");
    showToast("Rehber tamamlandı. İyi uçuşlar Pilot! 🚀", "success");
};

// --- DISCOVER SERVERS LOGIC ---
let currentDiscoverCategory = 'all';
let discoverSearchQuery = '';
let discoverSortBy = 'popularity';
let isMapView = true; // Map is default

const exploreBtn = document.getElementById('explore-btn');
const discoverOverlay = document.getElementById('discover-overlay');

if (exploreBtn) {
    exploreBtn.onclick = () => {
        discoverOverlay.classList.remove('hidden');
        renderGalaxyMap(); // Haritayı direkt yükle
    };
}

document.getElementById('close-discover-btn').onclick = () => {
    discoverOverlay.classList.add('hidden');
};

// Kategori Filtreleme
document.querySelectorAll('.discover-nav-item').forEach(item => {
    item.onclick = () => {
        document.querySelectorAll('.discover-nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        currentDiscoverCategory = item.dataset.category;
        
        if (isMapView) renderGalaxyMap();
        else loadDiscoverServers();
    };
});

// Arama
document.getElementById('discover-search-input').oninput = (e) => {
    discoverSearchQuery = e.target.value.toLowerCase().trim();
    if (!isMapView) loadDiscoverServers();
};

// Sıralama
document.getElementById('discover-sort-select').onchange = (e) => {
    discoverSortBy = e.target.value;
    if (!isMapView) loadDiscoverServers();
};

const loadDiscoverServers = async () => {
    const grid = document.getElementById('discover-results-grid');
    grid.innerHTML = '<div style="color: grey; grid-column: 1/-1; text-align: center; padding: 50px;">Galaksiler taranıyor... 🛸</div>';

    try {
        let q = query(collection(db, 'servers'), where('isPublic', '==', true));
        
        if (currentDiscoverCategory !== 'all') {
            q = query(q, where('category', '==', currentDiscoverCategory));
        }

        const snap = await getDocs(q);
        let servers = [];
        snap.forEach(doc => {
            const data = doc.data();
            data.id = doc.id;
            
            // Arama filtresi (Client-side for simplicity in MVP)
            if (discoverSearchQuery && !data.name.toLowerCase().includes(discoverSearchQuery) && !data.description?.toLowerCase().includes(discoverSearchQuery)) {
                return;
            }
            servers.push(data);
        });

        // Sorting
        if (discoverSortBy === 'newest') {
            servers.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        } else if (discoverSortBy === 'members') {
            servers.sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0));
        } else {
            // Popularity: Score = members + (active * 5)
            servers.sort((a, b) => {
                const scoreA = (a.memberCount || 0) + (a.activeMemberCount || 0) * 5;
                const scoreB = (b.memberCount || 0) + (b.activeMemberCount || 0) * 5;
                return scoreB - scoreA;
            });
        }

        if (servers.length === 0) {
            grid.innerHTML = '<div style="color: grey; grid-column: 1/-1; text-align: center; padding: 50px;">Bu sektörde hiç galaksi bulunamadı. 🌌</div>';
            return;
        }

        grid.innerHTML = '';
        servers.forEach(server => {
            const card = document.createElement('div');
            card.className = 'server-card';
            card.onclick = () => openServerDetail(server);
            
            const banner = server.bannerURL || 'https://images.unsplash.com/photo-1464802686167-b939a67e06a1?q=80&w=2069&auto=format&fit=crop';
            const logoText = server.name.charAt(0).toUpperCase();
            
            card.innerHTML = `
                <div class="server-card-banner" style="background-image: url('${banner}')">
                    <div class="server-card-logo" style="${server.logoURL ? `background-image: url(${server.logoURL}); color: transparent;` : ''}">${logoText}</div>
                </div>
                <div class="server-card-content">
                    <div class="server-card-title">${server.name}</div>
                    <div class="server-card-desc">${server.description || 'Bu galaksi henüz bir keşif raporu yayınlamadı.'}</div>
                    <div class="server-card-footer">
                        <div class="member-badge">
                            <i data-lucide="users" style="width: 14px;"></i>
                            <span>${server.memberCount || 0} Üye</span>
                        </div>
                        <div class="member-badge">
                            <div class="online-dot"></div>
                            <span>${server.activeMemberCount || 0} Aktif</span>
                        </div>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });
        lucide.createIcons();

    } catch (err) {
        grid.innerHTML = `<div style="color: var(--error-color); grid-column: 1/-1; text-align: center;">Tarama hatası: ${err.message}</div>`;
    }
};

// SERVER DETAIL MODAL
let detailTargetServerId = null;

const openServerDetail = (server) => {
    detailTargetServerId = server.id;
    const modal = document.getElementById('server-detail-modal');
    modal.classList.remove('hidden');

    document.getElementById('detail-banner').style.backgroundImage = `url('${server.bannerURL || 'https://images.unsplash.com/photo-1464802686167-b939a67e06a1?q=80&w=2069&auto=format&fit=crop'}')`;
    const logo = document.getElementById('detail-logo');
    logo.innerText = server.name.charAt(0).toUpperCase();
    if (server.logoURL) {
        logo.style.backgroundImage = `url('${server.logoURL}')`;
        logo.style.color = 'transparent';
    } else {
        logo.style.backgroundImage = 'none';
        logo.style.color = 'black';
    }

    document.getElementById('detail-name').innerText = server.name;
    document.getElementById('detail-description').innerText = server.description || 'Açıklama belirtilmemiş.';
    document.getElementById('detail-member-count').innerText = server.memberCount || 0;
    document.getElementById('detail-active-count').innerText = server.activeMemberCount || 0;

    const tagsContainer = document.getElementById('detail-tags');
    tagsContainer.innerHTML = (server.tags || []).map(t => `<span style="background: rgba(255,255,255,0.05); padding: 4px 10px; border-radius: 6px; font-size: 11px; color: gold;">#${t}</span>`).join('');
    
    // Katılım Kontrolü
    const user = auth.currentUser;
    const isMember = server.members?.includes(user?.uid);
    const joinBtn = document.getElementById('detail-join-btn');
    
    if (isMember) {
        joinBtn.innerText = "ZATEN ÜYESİNİZ";
        joinBtn.disabled = true;
        joinBtn.style.opacity = "0.5";
    } else {
        joinBtn.innerText = "GALAKSİYE KATIL";
        joinBtn.disabled = false;
        joinBtn.style.opacity = "1";
    }

    lucide.createIcons();
};

document.getElementById('detail-close-btn').onclick = () => {
    document.getElementById('server-detail-modal').classList.add('hidden');
};

document.getElementById('detail-join-btn').onclick = async () => {
    if (!detailTargetServerId) return;
    try {
        await joinServerById(detailTargetServerId);
        document.getElementById('server-detail-modal').classList.add('hidden');
        document.getElementById('discover-overlay').classList.add('hidden');
        showToast("Başarıyla katıldınız! Hoş geldiniz.", "success");
    } catch (err) {
        showToast("Katılma hatası: " + err.message, "error");
    }
};

// HELPER: Join Server by ID
const joinServerById = async (serverId) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Giriş yapmalısınız.");

    const serverRef = doc(db, 'servers', serverId);
    const serverSnap = await getDoc(serverRef);
    if (!serverSnap.exists()) throw new Error("Sunucu bulunamadı.");

    const data = serverSnap.data();
    if (data.members.includes(user.uid)) return;

    // Onay gerekiyor mu?
    if (data.requiresApproval) {
        const requestRef = doc(db, 'servers', serverId, 'joinRequests', user.uid);
        const requestSnap = await getDoc(requestRef);
        if (requestSnap.exists()) {
            throw new Error("Katılım isteğiniz zaten beklemede.");
        }
        await setDoc(requestRef, {
            uid: user.uid,
            username: user.displayName,
            photoURL: user.photoURL,
            requestedAt: Date.now(),
            status: 'pending'
        });
        showToast("Katılım isteği gönderildi.", "success");
        return;
    }

    // Üye listesini güncelle
    const newMembers = [...data.members, user.uid];
    await updateDoc(serverRef, { 
        members: newMembers,
        memberCount: (data.memberCount || 0) + 1
    });

    // Sub-collection'a ekle
    await setDoc(doc(db, 'servers', serverId, 'members', user.uid), {
        uid: user.uid,
        username: user.displayName,
        photoURL: user.photoURL,
        joinedAt: Date.now(),
        roles: []
    });

    listenToServers(); // Listeyi yenile
};


// --- MESSAGE EFFECTS PICKER ---
const effectBtn = document.getElementById('msg-effect-btn');
const effectPicker = document.getElementById('effect-picker');

if (effectBtn) {
    effectBtn.onclick = (e) => {
        e.stopPropagation();
        effectPicker?.classList.toggle('hidden');
    };
}

document.querySelectorAll('#effect-picker .popover-item').forEach(item => {
    item.onclick = () => {
        currentMessageEffect = item.dataset.effect;
        if (currentMessageEffect === 'none') {
            effectBtn.style.color = 'var(--text-secondary)';
            effectBtn.innerHTML = '<i data-lucide="sparkles"></i>';
        } else {
            effectBtn.style.color = 'var(--brand-color)';
            effectBtn.innerHTML = '<i data-lucide="sparkles" class="effect-neon"></i>';
            showToast(`${item.innerText} aktif! Sonraki mesajın büyüleyici olacak. 💫`, "success");
        }
        effectPicker.classList.add('hidden');
        lucide.createIcons();
    };
});

// --- GALAXY MAP LOGIC ---
const toggleViewBtn = document.getElementById('toggle-discovery-view');
const gridView = document.getElementById('discover-results-grid');
const mapView = document.getElementById('discover-galaxy-map');
const nodesContainer = document.getElementById('galaxy-nodes-container');

if (toggleViewBtn) {
    toggleViewBtn.onclick = () => {
        isMapView = !isMapView;
        if (isMapView) {
            gridView.classList.add('hidden');
            mapView.classList.remove('hidden');
            toggleViewBtn.innerHTML = '<i data-lucide="layout-grid"></i> Liste Görünümü';
            renderGalaxyMap();
        } else {
            gridView.classList.remove('hidden');
            mapView.classList.add('hidden');
            toggleViewBtn.innerHTML = '<i data-lucide="map"></i> Galaksi Haritası';
            loadDiscoverServers(); // Listeyi tekrar yükle
        }
        lucide.createIcons();
    };
}

const renderGalaxyMap = async () => {
    if (!nodesContainer) return;
    nodesContainer.innerHTML = '';
    
    const q = query(collection(db, 'servers'), where('isPublic', '==', true), limit(50));
    const snap = await getDocs(q);
    
    snap.forEach(docSnap => {
        const server = docSnap.data();
        const id = docSnap.id;
        
        // Determinate position based on ID (to stay consistent)
        let hash = 0;
        for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
        
        const x = 1700 + (hash % 600);
        const y = 1700 + ((hash >> 8) % 600);
        const size = 50 + (server.memberCount || 0) * 3;
        
        const node = document.createElement('div');
        node.className = 'server-star';
        node.style.cssText = `
            position: absolute;
            left: ${x}px;
            top: ${y}px;
            width: ${size}px;
            height: ${size}px;
            background: ${server.atmosphere === 'supernova' ? '#ff4757' : (server.atmosphere === 'nebula' ? '#a000ff' : 'var(--brand-color)')};
            border-radius: 50%;
            cursor: pointer;
            box-shadow: 0 0 30px ${server.atmosphere === 'supernova' ? 'rgba(255, 71, 87, 0.5)' : (server.atmosphere === 'nebula' ? 'rgba(160, 0, 255, 0.5)' : 'rgba(0, 255, 255, 0.5)')}, inset 0 0 10px white;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.3s;
            z-index: 10;
            border: 2px solid white;
        `;
        
        node.innerHTML = `
            <div style="position: absolute; bottom: -25px; white-space: nowrap; font-size: 11px; font-weight: 800; color: white; text-shadow: 0 2px 4px #000;">
                ${server.name}
            </div>
            <img src="${server.logoURL || `https://ui-avatars.com/api/?name=${server.name}&background=random`}" style="width: 80%; height: 80%; border-radius: 50%; object-fit: cover;">
        `;
        
        node.onclick = () => {
            document.getElementById('discover-overlay').classList.add('hidden');
            joinServerById(id);
        };
        
        node.onmouseenter = () => node.style.transform = 'scale(1.2)';
        node.onmouseleave = () => node.style.transform = 'scale(1)';
        
        nodesContainer.appendChild(node);
    });

    // Başlangıçta zoom uygula
    nodesContainer.style.transform = `scale(${mapZoom})`;
};

// Map Drag & Zoom Functionality
let isDraggingMap = false;
let mapStartX, mapStartY;
let mapZoom = 0.5; // Start a bit zoomed out to see more stars

if (mapView) {
    // Zoom Logic
    mapView.onwheel = (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        mapZoom = Math.min(Math.max(0.1, mapZoom + delta), 2); // 0.1x ile 2x arasnda
        nodesContainer.style.transform = `scale(${mapZoom})`;
    };

    mapView.onmousedown = (e) => {
        isDraggingMap = true;
        mapStartX = e.clientX - nodesContainer.offsetLeft;
        mapStartY = e.clientY - nodesContainer.offsetTop;
        mapView.style.cursor = 'grabbing';
    };
    
    window.onmousemove = (e) => {
        if (!isDraggingMap) return;
        // Zoom seviyesine göre sürükleme hızını ayarla
        const x = (e.clientX - mapStartX);
        const y = (e.clientY - mapStartY);
        nodesContainer.style.left = `${x}px`;
        nodesContainer.style.top = `${y}px`;
    };
    
    window.onmouseup = () => {
        isDraggingMap = false;
        if (mapView) mapView.style.cursor = 'grab';
    };
}

// --- IMAGE CROPPER & UPLOAD LOGIC ---
let activeCropper = null;

const openCropper = (file, aspect, callback) => {
    const modal = document.getElementById('cropper-modal');
    const image = document.getElementById('cropper-image');
    if (!modal || !image) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        image.src = e.target.result;
        modal.classList.remove('hidden');

        if (activeCropper) activeCropper.destroy();
        activeCropper = new Cropper(image, {
            aspectRatio: aspect,
            viewMode: 1,
            autoCropArea: 1,
            responsive: true,
        });
    };
    reader.readAsDataURL(file);

    document.getElementById('cropper-save-btn').onclick = () => {
        const canvas = activeCropper.getCroppedCanvas();
        canvas.toBlob((blob) => {
            callback(blob);
            modal.classList.add('hidden');
            activeCropper.destroy();
            activeCropper = null;
        }, 'image/jpeg', 0.8);
    };

    document.getElementById('cropper-cancel-btn').onclick = () => {
        modal.classList.add('hidden');
        if (activeCropper) activeCropper.destroy();
        activeCropper = null;
    };
};

const handleImageUpload = (inputId, aspect, path, onComplete) => {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        openCropper(file, aspect, async (blob) => {
            try {
                showToast("Görsel işleniyor...", "info");

                // Storage yerine Base64 kullan (ücretsiz, CORS yok)
                const reader = new FileReader();
                reader.onload = async (ev) => {
                    const base64url = ev.target.result;

                    // 1MB sınırı kontrolü (Firestore döküman limiti için)
                    if (base64url.length > 900000) {
                        showToast("Görsel çok büyük! Daha küçük bir resim seç.", "error");
                        return;
                    }

                    onComplete(base64url);
                    showToast("Görsel başarıyla güncellendi! ✨", "success");
                };
                reader.readAsDataURL(blob);
            } catch (err) {
                showToast("İşlem hatası: " + err.message, "error");
            }
        });
    };
};

// Hook up all upload inputs
handleImageUpload('pfp-file-input', 1, 'profiles', async (url) => {
    const user = auth.currentUser;
    // Base64 çok uzun olduğu için Firebase Auth'a yazamıyoruz, sadece Firestore'a yaz
    await updateDoc(doc(db, 'users', user.uid), { photoURL: url });
    // Ayarlar panelindeki önizlemeyi güncelle
    const pfpPreview = document.getElementById('settings-pfp-preview');
    if (pfpPreview) pfpPreview.src = url;
    // Profil modaldaki fotoğrafı güncelle
    const profileModalPfp = document.getElementById('profile-modal-pfp');
    if (profileModalPfp) profileModalPfp.src = url;
    // Kullanıcı durum çubuğundaki avatarı güncelle
    const userBarAvatar = document.getElementById('user-bar-avatar');
    if (userBarAvatar) userBarAvatar.src = url;
    // Sayfadaki tüm bu kullanıcıya ait avatarları güncelle
    document.querySelectorAll(`img[data-uid="${user.uid}"]`).forEach(img => img.src = url);
    showToast('Profil fotoğrafın güncellendi! ✨', 'success');
});

handleImageUpload('banner-file-input', 3/1, 'banners', async (url) => {
    const user = auth.currentUser;
    await updateDoc(doc(db, 'users', user.uid), { bannerURL: url });
});

handleImageUpload('server-logo-file', 1, 'server_logos', async (url) => {
    if (!currentServerId) return;
    await updateDoc(doc(db, 'servers', currentServerId), { logoURL: url });
});

handleImageUpload('server-banner-file', 2/1, 'server_banners', async (url) => {
    if (!currentServerId) return;
    await updateDoc(doc(db, 'servers', currentServerId), { bannerURL: url });
});


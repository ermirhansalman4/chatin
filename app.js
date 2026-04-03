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
    setDoc
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
// --- GLOBAL STATE ---
let currentServerId = null; 
let currentChannelId = null; 
let currentChannelType = 'text';
let currentServerOwnerUid = null;
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

// --- FRIENDSHIP SYSTEM LOGIC ---

const friendsModal = document.getElementById('friends-modal');
const userSearchInput = document.getElementById('user-search-input');
const userSearchResults = document.getElementById('user-search-results');
const incomingRequestsList = document.getElementById('incoming-requests-list');
const friendRequestBadge = document.getElementById('friend-request-badge');
const requestsTabBadge = document.getElementById('requests-tab-badge');

// Arkadaşlık Modalını Aç
document.getElementById('add-friend-btn').onclick = () => {
    friendsModal.classList.remove('hidden');
    switchFriendTab('search');
};

document.getElementById('close-friends-btn').onclick = () => friendsModal.classList.add('hidden');

// Tab Değiştirme
const switchFriendTab = (tab) => {
    const searchBtn = document.getElementById('search-tab-btn');
    const requestsBtn = document.getElementById('requests-tab-btn');
    const searchContent = document.getElementById('search-content');
    const requestsContent = document.getElementById('requests-content');

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

document.getElementById('search-tab-btn').onclick = () => switchFriendTab('search');
document.getElementById('requests-tab-btn').onclick = () => switchFriendTab('requests');

// Kullanıcı Ara
let searchTimeout = null;
userSearchInput.oninput = () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        const queryStr = userSearchInput.value.trim();
        if (queryStr.length < 3) return;

        const q = query(collection(db, 'users'), where('username', '==', queryStr));
        const snap = await getDocs(q);
        renderSearchResults(snap.docs);
    }, 500);
};

const renderSearchResults = (docs) => {
    userSearchResults.innerHTML = '';
    if (docs.length === 0) {
        userSearchResults.innerHTML = '<p style="text-align:center; color:gray; margin-top:20px;">Kullanıcı bulunamadı.</p>';
        return;
    }

    docs.forEach(d => {
        const userData = d.data();
        if (userData.uid === auth.currentUser.uid) return; // Kendini ekleyemezsin

        const div = document.createElement('div');
        div.className = 'user-row';
        div.style = 'display:flex; align-items:center; justify-content:space-between; padding:12px; background:rgba(255,255,255,0.03); border-radius:12px;';
        div.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px;">
                <img src="${userData.photoURL}" style="width:32px; height:32px; border-radius:50%;">
                <span style="font-weight:600;">${userData.username}</span>
            </div>
            <button class="add-friend-action-btn" data-uid="${userData.uid}" style="background:var(--brand-color); color:black; border:none; padding:6px 12px; border-radius:8px; font-weight:800; cursor:pointer;">EKLE</button>
        `;
        userSearchResults.appendChild(div);

        div.querySelector('.add-friend-action-btn').onclick = () => sendFriendRequest(userData.uid, userData.username);
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
        const div = document.createElement('div');
        div.className = `dm-user-item ${currentDMRecipientId === friend.uid ? 'active' : ''}`;
        div.dataset.uid = friend.uid;
        div.style = 'display:flex; align-items:center; gap:10px; padding:10px; margin:2px 0; border-radius:8px; cursor:pointer; transition:0.2s;';
        div.innerHTML = `
            <img src="${friend.photoURL}" style="width:32px; height:32px; border-radius:50%; border: 2px solid rgba(255,215,0,0.2);">
            <div style="display:flex; flex-direction:column;">
                <span style="font-weight:600; font-size:14px;">${friend.username}</span>
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
const messageList = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatHeaderName = document.getElementById('current-channel-name');
const serverListContainer = document.getElementById('server-list');
const textChannelsContainer = document.getElementById('text-channels-container');
const voiceChannelsContainer = document.getElementById('voice-channels-container');
const memberListContainer = document.getElementById('member-list-container');
const activeServerName = document.getElementById('active-server-name');
const inviteBox = document.getElementById('invite-box');
const currentInviteCode = document.getElementById('current-invite-code');
const headerInviteCode = document.getElementById('header-invite-code');

const voiceArea = document.getElementById('voice-area');
const voiceGrid = document.getElementById('voice-grid');
const messageInputContainer = document.getElementById('message-input-container');

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
    const time = data.createdAt?.toDate() ? data.createdAt.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Az önce';
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

            <img class="msg-avatar" src="${data.userPhoto || `https://ui-avatars.com/api/?name=${data.username}&background=random`}" 
                 style="width: 40px; height: 40px; border-radius: 50%; cursor: pointer;">
            <div style="flex:1;">
                <div style="display: flex; gap: 8px; align-items: baseline;">
                    <span class="msg-username" style="font-weight: bold; color: #fff; cursor: pointer;">
                        ${data.username}
                    </span>
                    <span style="font-size: 12px; color: var(--text-secondary);">${time}</span>
                    ${data.isEdited ? '<span style="font-size: 10px; color: var(--text-secondary); italic;">(düzenlendi)</span>' : ''}
                </div>
                <div class="msg-body">
                    <p class="${data.messageEffect ? 'effect-' + data.messageEffect : ''}" data-text="${data.text || ''}" style="color: #dcddde; margin-top: 2px; white-space: pre-wrap; word-break: break-word;">${data.text || ''}</p>
                    ${data.fileURL ? `<img src="${data.fileURL}" class="media-message-img">` : ''}
                </div>
                ${reactionHtml}
            </div>
        </div>
    `;
    messageList.insertAdjacentHTML('beforeend', msgHtml);
    
    const item = messageList.lastElementChild;
    const profileOpen = () => window.openUserProfile({username: data.username, photoURL: data.userPhoto, uid: data.uid});
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
    const userData = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || "Kullanıcı",
        username: (user.displayName || user.email.split('@')[0]).toLowerCase().replace(/\s+/g, '_'),
        photoURL: user.photoURL || 'https://via.placeholder.com/150',
        lastLogin: serverTimestamp()
    };
    await setDoc(userRef, userData, { merge: true });
    console.log("User synced to Firestore:", userData.username);
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

const dmSidebarTrigger = document.getElementById('dm-sidebar-trigger');
if (dmSidebarTrigger) {
    dmSidebarTrigger.onclick = () => {
        isDMMode = !isDMMode;
        toggleDMView();
    };
}

const toggleDMView = () => {
    const serversList = document.getElementById('server-list');
    const channelsSidebar = document.getElementById('channels-sidebar');
    const serverHeader = document.getElementById('server-header');
    
    if (isDMMode) {
        dmSidebarTrigger.classList.add('active');
        // Sunucu listesini değil, kanalları değiştiriyoruz
        document.getElementById('current-server-name').innerText = "Özel Mesajlar";
        document.getElementById('channels-container').innerHTML = '<div style="padding:10px; color:var(--text-secondary); font-size:12px;">Yakınlardaki Galaksiler (DM)</div>';
        loadDMList();
        
        // Sunucu bazlı UI'ları gizle
        document.getElementById('voice-channels-area').classList.add('hidden');
    } else {
        dmSidebarTrigger.classList.remove('active');
        // Sunucu moduna geri dön
        if (currentServerId) {
            const btn = document.querySelector(`.server-icon[data-id="${currentServerId}"]`);
            if (btn) btn.click();
        }
    }
};

const loadDMList = async () => {
    const container = document.getElementById('channels-container');
    // Basitçe sunucudaki üyeleri veya genel üyeleri göster (Örnek olarak genel üyeler)
    const q = query(collection(db, 'users'), limit(20));
    const snap = await getDocs(q);
    
    let html = '';
    snap.forEach(docSnap => {
        const data = docSnap.data();
        if (data.uid === auth.currentUser.uid) return;
        
        html += `
            <div class="dm-user-item ${currentDMRecipientId === data.uid ? 'active' : ''}" data-uid="${data.uid}">
                <img src="${data.photoURL || `https://ui-avatars.com/api/?name=${data.username}`}">
                <span>${data.username}</span>
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
    currentChannelId = null; // Sunucu kanalını temizle
    
    document.querySelectorAll('.dm-user-item').forEach(i => i.classList.remove('active'));
    document.querySelector(`.dm-user-item[data-uid="${uid}"]`)?.classList.add('active');
    
    chatHeaderName.innerText = `@${name}`;
    listenToDMs(uid);
};

const listenToDMs = (recipientUid) => {
    if (unsubscribeMessages) unsubscribeMessages();
    messageList.innerHTML = '';
    
    const myUid = auth.currentUser.uid;
    const participants = [myUid, recipientUid].sort();
    const dmId = participants.join('_'); // Benzersiz DM IDsi
    
    const q = query(
        collection(db, 'direct_messages'),
        where('dmId', '==', dmId),
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
        messageList.scrollTop = messageList.scrollHeight;
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
        try {
            if (isDMMode && currentDMRecipientId) {
                await sendDM(base64Data, true);
            } else if (currentChannelId) {
                await sendMessage(base64Data, true);
            }
            showToast("Görsel gönderildi! 📸");
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
        timestamp: serverTimestamp(),
        reactions: {}
    };

    if (isFile) {
        msgData.fileURL = content;
        msgData.text = "";
    } else {
        msgData.text = content;
    }

    await addDoc(collection(db, `servers/${currentServerId}/channels/${currentChannelId}/messages`), msgData);
};

export const sendDM = async (content, isFile = false) => {
    if (!auth.currentUser || !currentDMRecipientId) return;

    const participants = [auth.currentUser.uid, currentDMRecipientId].sort();
    const dmId = participants.join('_');

    const msgData = {
        uid: auth.currentUser.uid,
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

export const createServer = async (serverName) => {
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
        name: serverName,
        inviteCode: serverRef.id.substring(0, 6).toUpperCase(),
        ownerUid: user.uid,
        createdAt: Date.now(),
        members: [user.uid]
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
    
    // Sunucu ana dökümanına üye olarak ekle
    await updateDoc(doc(db, 'servers', serverId), {
        members: arrayUnion(user.uid)
    });

    // ÖZEL ÜYE LİSTESİNE EKLE
    await setDoc(doc(db, 'servers', serverId, 'members', user.uid), {
        uid: user.uid,
        username: user.displayName,
        photoURL: user.photoURL,
        joinedAt: Date.now()
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
    } catch(err) {
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
    currentServerId = serverId;
    window.lastActiveServerId = serverId;
    activeServerName.innerText = serverData.name;

    // ownerUid eksikse mevcut kullanıcıyı otomatik owner yap (eski sunucular için)
    if (!serverData.ownerUid && auth.currentUser) {
        try {
            await updateDoc(doc(db, 'servers', serverId), {
                ownerUid: auth.currentUser.uid
            });
            serverData.ownerUid = auth.currentUser.uid;
            console.log('✅ ownerUid otomatik eklendi:', auth.currentUser.uid);
        } catch(e) {
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
        if(icon.dataset.id === serverId) icon.classList.add('active');
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
    rolesSnap.forEach(r => rolesList.push({id: r.id, ...r.data()}));

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
                        <div style="font-size: 10px; color: var(--text-secondary);">Üye ID: ${data.uid.substring(0,8)}...</div>
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
        // --- BU KISIM ÖNEMLİ: KULLANICI ROLÜNE GÖRE FİLTRELEME ---
        const serverDoc = await getDoc(doc(db, 'servers', currentServerId));
        const isOwner = serverDoc.exists() && serverDoc.data().ownerUid === auth.currentUser.uid;
        
        let allowedChannelIds = [];
        if (!isOwner) {
            const memberRef = doc(db, 'servers', currentServerId, 'members', auth.currentUser.uid);
            const memberSnap = await getDoc(memberRef);
            if (memberSnap.exists()) {
                const roleIds = memberSnap.data().roles || [];
                for (const rid of roleIds) {
                    const roleSnap = await getDoc(doc(db, 'servers', currentServerId, 'roles', rid));
                    if (roleSnap.exists()) {
                        const accessible = roleSnap.data().accessibleChannels || [];
                        allowedChannelIds = [...new Set([...allowedChannelIds, ...accessible])];
                    }
                }
            }
        }

        textChannelsContainer.innerHTML = '';
        voiceChannelsContainer.innerHTML = '';
        snapshot.docs.forEach((doc, index) => {
            const data = doc.data();
            // Eğer sahip değilsek ve bu kanal bizim kanal listemizde yoksa GÖSTERME (Erişim kısıtlıysa)
            // Not: Eğer sunucuda hiç rol yoksa veya rolün içine kanal eklenmemişse görünürlük durumunu sunucu sahibine bırakıyoruz
            const canSee = isOwner || allowedChannelIds.includes(doc.id);
            
            if (canSee) {
                renderChannelItem(data, doc.id);
                // Auto switch to first text channel if not set
                if (index === 0 && !currentChannelId && data.type === 'text') {
                    switchChannel(doc.id, data.name, data.type);
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
    // Ses kanalından ayrılıyor olabiliriz
    if (currentVoiceChannelId && currentVoiceChannelId !== channelId) {
        await leaveVoiceChannel(currentVoiceChannelId);
        currentVoiceChannelId = null;
        if (unsubscribeVoiceMembers) unsubscribeVoiceMembers();
    }

    currentChannelId = channelId;
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
    const pfp = document.getElementById('profile-modal-pfp');
    const name = document.getElementById('profile-modal-name');
    const bio = document.getElementById('profile-modal-bio');
    const editBtn = document.getElementById('open-edit-mode-btn');
    const currentUser = auth.currentUser;

    pfp.src = data.photoURL || `https://ui-avatars.com/api/?name=${data.username}&background=random`;
    name.innerText = data.username;
    bio.innerText = data.bio || "Henüz bir biyografi eklenmemiş.";

    // Önce modalı aç — async işlemler sonradan dolduracak
    if (currentUser && currentUser.uid === data.uid) {
        editBtn.classList.remove('hidden');
        document.getElementById('edit-profile-pfp-input').value = data.photoURL || '';
        document.getElementById('edit-profile-banner-input').value = data.bannerURL || '';
        document.getElementById('edit-profile-effect-input').value = data.messageEffect || 'none';
        document.getElementById('edit-profile-name-input').value = data.username || '';
        document.getElementById('edit-profile-bio-input').value = data.bio || '';
    } else {
        editBtn.classList.add('hidden');
    }

    const banner = document.getElementById('profile-modal-banner');
    if (data.bannerURL) {
        banner.style.backgroundImage = `url(${data.bannerURL})`;
    } else {
        banner.style.backgroundImage = 'none';
    }

    // Eski rol panelini temizle
    const oldPanel = document.getElementById('profile-role-panel');
    if (oldPanel) oldPanel.remove();

    document.getElementById('profile-modal-overlay').classList.remove('hidden');
    document.getElementById('profile-view-mode').classList.remove('hidden');
    document.getElementById('profile-edit-mode').classList.add('hidden');

    // Premium & Rozet Kontrolü
    const userDoc = await getDoc(doc(db, 'users', data.uid));
    if (userDoc.exists()) {
        const userData = userDoc.data();
        const isPremium = userData.isPremium;
        
        // Premium Rozeti (🚀)
        const badgeSpot = document.getElementById('premium-badge-spot');
        badgeSpot.innerHTML = isPremium ? '<i data-lucide="zap" style="color: gold; width: 22px; filter: drop-shadow(0 0 5px gold);"></i>' : '';

        // Diğer Rozetler
        const badgesList = document.getElementById('profile-badges');
        badgesList.innerHTML = '';
        if (isPremium) badgesList.innerHTML += '<div class="role-pill" style="border-color: gold; color: gold; font-size: 9px; padding: 2px 6px;">PREMIUM</div>';
        if (userData.isOwner || data.uid === 'SİZİN_ADMIN_UID_NİZ') {
            badgesList.innerHTML += '<div class="role-pill" style="border-color: #8a2be2; color: #8a2be2; font-size: 9px; padding: 2px 6px;">KURUCU</div>';
        }
        badgesList.innerHTML += '<div class="role-pill" style="border-color: #00ced1; color: #00ced1; font-size: 9px; padding: 2px 6px;">GÖNÜLLÜ TESTER</div>';
        
        lucide.createIcons();
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

const renderChannelItem = async (data, id) => {
    const icon = data.type === 'voice' ? 'volume-2' : 'hash';
    const activeStyle = currentChannelId === id ? 'background-color: var(--bg-hover); color: white;' : '';
    
    // Check if user is owner to show management icons
    const serverDoc = await getDoc(doc(db, 'servers', currentServerId));
    const isOwner = serverDoc.exists() && serverDoc.data().ownerUid === auth.currentUser.uid;

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
        
        // Kullanıcıyı Firestore'a senkronize et
        await syncUserToFirestore(user);
        
        // ADMIN KONTROLÜ (SADECE SİZİN İÇİN)
        const ADMIN_UID = 'JU4pSd1VslcS6zJoaImsKjESzhl2';
        const adminBtn = document.getElementById('admin-launcher-btn');
        if (user.uid === ADMIN_UID) {
            adminBtn.style.display = 'flex';
        } else {
            adminBtn.style.display = 'none';
        }

        // Kullanıcı dökümanını oluştur veya güncelle
        await setDoc(doc(db, 'users', user.uid), {
            uid: user.uid,
            username: user.displayName,
            photoURL: user.photoURL,
            lastSeen: serverTimestamp()
        }, { merge: true });

        // BEKLEYEN DAVET VAR MI?
        const pendingInvite = sessionStorage.getItem('pendingInvite');
        if (pendingInvite) {
            sessionStorage.removeItem('pendingInvite');
            try {
                await joinServer(pendingInvite);
                showToast(`Başarıyla katıldın!`, "success");
            } catch(err) {
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
        
        // Sunucu Verilerini Yükle (Premium & Davet Kodu)
        const serverSnap = await getDoc(doc(db, 'servers', currentServerId));
        if (serverSnap.exists()) {
            const serverData = serverSnap.data();
            document.getElementById('custom-invite-input').value = serverData.inviteCode || '';
            
            // Sahibi Premium mu kontrol et
            const ownerSnap = await getDoc(doc(db, 'users', serverData.ownerUid));
            const isPremium = ownerSnap.exists() && ownerSnap.data().isPremium;
            
            const statusIndicator = document.getElementById('premium-status-indicator');
            const themeArea = document.getElementById('theme-selector-area');
            
            if (isPremium) {
                statusIndicator.style.background = 'rgba(255, 215, 0, 0.1)';
                statusIndicator.innerHTML = '<p style="font-weight: 800; color: gold;">BU SUNUCU PREMIUM AYRICALIKLARINA SAHİP! 💎</p>';
                themeArea.classList.remove('hidden');
            } else {
                statusIndicator.style.background = 'rgba(255, 255, 255, 0.05)';
                statusIndicator.innerHTML = '<p style="color: var(--text-secondary);">BU SUNUCU STANDART SÜRÜMDE. ÖZEL KOD VE TEMALAR İÇİN PREMIUM GEREKLİ.</p>';
                themeArea.classList.add('hidden');
            }
        }
    } else {
        showToast("Sunucu ayarları için yetkiniz yok.", "error");
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
        const tab = item.dataset.tab;
        document.querySelectorAll('.settings-nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        if (tab === 'roles') {
            document.getElementById('roles-tab').classList.remove('hidden');
            document.getElementById('members-tab').classList.add('hidden');
            document.getElementById('premium-tab').classList.add('hidden');
            loadRoles();
            loadRoleChannelsUI('new-role-channels');
        } else if (tab === 'members') {
            document.getElementById('roles-tab').classList.add('hidden');
            document.getElementById('members-tab').classList.remove('hidden');
            document.getElementById('premium-tab').classList.add('hidden');
            loadMembersInSettings();
        } else if (tab === 'premium') {
            document.getElementById('roles-tab').classList.add('hidden');
            document.getElementById('members-tab').classList.add('hidden');
            document.getElementById('premium-tab').classList.remove('hidden');
            loadPremiumStatus();
        }
    };
});

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
        indicator.style.background = 'rgba(255, 215, 0, 0.2)';
        statusText.innerText = "TEBRİKLER, PREMIUM ÜYESİNİZ! 🚀";
        buyBtn.classList.add('hidden');
        themeArea.classList.remove('hidden');
    } else {
        indicator.style.background = 'rgba(255, 215, 0, 0.05)';
        statusText.innerText = "PREMIUM DEĞİLSİNİZ";
        buyBtn.classList.remove('hidden');
        themeArea.classList.add('hidden');
    }
};

document.getElementById('buy-premium-btn').onclick = async () => {
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
        } catch(err) {
            showToast("Talebin iletilemedi: " + err.message, "error");
        }
    }
};

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
                    await updateDoc(doc(db, 'users', docSnap.id), { isPremium: true });
                    await deleteDoc(doc(db, 'premium_requests', docSnap.id));
                    showToast(`${req.username} artık Premium! 🚀`, "success");
                } catch(err) {
                    showToast("Onay hatası: " + err.message, "error");
                }
            };

            document.getElementById(`reject-${docSnap.id}`).onclick = async () => {
                try {
                    await deleteDoc(doc(db, 'premium_requests', docSnap.id));
                    showToast("Talep reddedildi.", "info");
                } catch(err) {
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
    nebula: { brand: '#a000ff', bg: '#10002b', side: '#240046' }
};

document.querySelectorAll('.theme-option').forEach(btn => {
    btn.onclick = () => {
        const theme = themes[btn.dataset.theme];
        document.documentElement.style.setProperty('--brand-color', theme.brand);
        document.documentElement.style.setProperty('--bg-deep', theme.bg);
        document.documentElement.style.setProperty('--bg-side', theme.side);
        showToast(`Tema güncellendi: ${btn.dataset.theme}`, "success");
    };
});

document.getElementById('save-custom-invite').onclick = async () => {
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

// Keşfet Modalı Aç
document.addEventListener('click', (e) => {
    const btn = e.target.closest('#explore-btn');
    if (btn) {
        document.getElementById('join-server-modal').classList.remove('hidden');
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
        const name = nameInput.value.trim();
        if(!name) return showToast("Sunucu adı boş olamaz!", "error");
        
        try {
            await createServer(name);
            document.getElementById('create-server-modal').classList.add('hidden');
            nameInput.value = '';
            showToast("Güneş Sistemi'nde yeni bir sunucu doğdu!", "success");
            listenToServers(); // Listeyi yenile
        } catch(err) {
            showToast(err.message, "error");
        }
    }
});

// SUNUCUYA KATILMA (MODAL FINAL BUTONU)
document.addEventListener('click', async (e) => {
    if (e.target.closest('#join-server-final-btn')) {
        const inviteInput = document.getElementById('join-invite-input');
        const code = inviteInput.value.trim();
        if(!code) return showToast("Davet kodu girmelisin!", "error");
        
        try {
            await joinServer(code);
            document.getElementById('join-server-modal').classList.add('hidden');
            inviteInput.value = '';

            listenToServers(); // Listeyi yenile
        } catch(err) {
            showToast(err.message, "error");
        }
    }
});

// Ses Ayarları
let isMuted = false;
let isDeafened = false;

document.addEventListener('click', async (e) => {
    const micBtn = e.target.closest('#mic-btn');
    if (micBtn) {
        isMuted = !isMuted;
        toggleLocalMic(!isMuted); // GERÇEK MİKROFONU KAPAT/AÇ
        const icon = isMuted ? 'mic-off' : 'mic';
        micBtn.innerHTML = `<i data-lucide="${icon}"></i>`;
        micBtn.style.color = isMuted ? 'var(--error-color)' : 'var(--text-secondary)';
        micBtn.style.background = isMuted ? 'rgba(255, 71, 87, 0.1)' : '';
        lucide.createIcons();
        showToast(isMuted ? "Mikrofon kapatıldı" : "Mikrofon açıldı");
    }

    const deafBtn = e.target.closest('#deafen-btn');
    if (deafBtn) {
        isDeafened = !isDeafened;
        // Lucide'de headphones-off olmadığı için aynı ikonu tutup rengini değiştiriyoruz
        deafBtn.innerHTML = `<i data-lucide="headphones"></i>`;
        deafBtn.style.color = isDeafened ? 'var(--error-color)' : 'var(--text-secondary)';
        deafBtn.style.background = isDeafened ? 'rgba(255, 71, 87, 0.1)' : '';
        lucide.createIcons();
        showToast(isDeafened ? "Sesler kapatıldı" : "Sesler açıldı");
    }

    const settingsBtn = e.target.closest('#settings-btn');
    const popover = document.getElementById('settings-popover');
    if (settingsBtn) {
        e.stopPropagation();
        popover.classList.toggle('hidden');
        lucide.createIcons();
    } else {
        // Herhangi bir yere tıklandığında popover'ı kapat
        popover.classList.add('hidden');
    }

    const profileBtn = e.target.closest('#user-profile-btn') || e.target.closest('#open-profile-edit');
    if (profileBtn) {
        const user = auth.currentUser;
        if (user && window.openUserProfile) {
            window.openUserProfile({
                uid: user.uid,
                username: user.displayName || user.username || "Kullanıcı",
                photoURL: user.photoURL
            });
        }
    }

    const accSetsTrigger = e.target.closest('#open-account-settings');
    if (accSetsTrigger) {
        document.getElementById('account-settings-modal').classList.remove('hidden');
    }

    const logoutTrigger = e.target.closest('#logout-btn-trigger');
    if (logoutTrigger) {
        const { logout } = await import('./auth.js');
        const confirmed = await customConfirm("Oturumu Kapat", "Galaksiden ayrılmak istediğinize emin misiniz?");
        if(confirmed) {
            await logout(); 
            window.location.reload();
        }
    }

    // --- SES KANALI AKSİYONLARI ---
    
    // Ses Kanalı Mikrofonu
    const voiceMic = e.target.closest('#voice-mic-active');
    if (voiceMic) {
        voiceMic.classList.toggle('muted');
        const isMute = voiceMic.classList.contains('muted');
        voiceMic.innerHTML = `<i data-lucide="${isMute ? 'mic-off' : 'mic'}"></i>`;
        voiceMic.style.color = isMute ? 'var(--error-color)' : 'white';
        lucide.createIcons();
    }

    // Ses Kanalı Ekran Paylaşımı
    const voiceScreen = e.target.closest('#voice-screen-share');
    if (voiceScreen) {
        voiceScreen.classList.toggle('sharing');
        const isSharing = voiceScreen.classList.contains('sharing');
        
        if (isSharing) {
            startScreenShare().then(success => {
                if (!success) {
                    voiceScreen.classList.remove('sharing');
                    showToast("Ekran paylaşımı başlatılamadı.", "error");
                } else {
                    voiceScreen.style.color = 'var(--brand-color)';
                    showToast("Ekran paylaşımı başladı!", "success");
                }
            });
        } else {
            stopScreenShare();
            voiceScreen.style.color = 'white';
            showToast("Ekran paylaşımı durduruldu.", "info");
        }
    }

    // Ses Kanalı Ayrılma
    const voiceLeave = e.target.closest('#disconnect-voice-btn');
    if (voiceLeave) {
        window.dispatchEvent(new CustomEvent('leave-voice'));
        showToast("Ses kanalından ayrıldınız.", "info");
    }

    // Ses Kanalı Ayarları Modalı Aç
    const voiceSets = e.target.closest('#voice-settings-active');
    if (voiceSets) {
        document.getElementById('voice-settings-modal').classList.remove('hidden');
        lucide.createIcons();
    }

    // Ses Kanalı Ayarları Kapat (X veya Kaydet)
    if (e.target.closest('#close-voice-settings') || e.target.closest('#save-voice-settings')) {
        document.getElementById('voice-settings-modal').classList.add('hidden');
        if (e.target.closest('#save-voice-settings')) {
            showToast("Ses ayarları başarıyla kaydedildi!", "success");
        }
    }
    // MOBİL MENÜ KONTROLLERİ
    const sidebarToggle = e.target.closest('#mobile-sidebar-toggle');
    if (sidebarToggle) {
        document.body.classList.toggle('show-sidebar');
        document.body.classList.remove('show-members');
    }

    const membersToggle = e.target.closest('#mobile-members-toggle');
    if (membersToggle) {
        document.body.classList.toggle('show-members');
        document.body.classList.remove('show-sidebar');
    }

    // Ekranın herhangi bir yerine tıklandığında menüleri kapat (Chat alanı tıklandığında)
    if (e.target.closest('#chat-messages') || e.target.closest('#chat-input')) {
        document.body.classList.remove('show-sidebar');
        document.body.classList.remove('show-members');
    }
});


// --- PREMIUM KARŞILAMA MODAL BUTONLARI ---
document.getElementById('request-premium-welcome-btn').onclick = async () => {
    const user = auth.currentUser;
    if (!user) return;

    try {
        await addDoc(collection(db, 'premium_requests'), {
            uid: user.uid,
            username: user.displayName || user.email.split('@')[0],
            email: user.email,
            status: 'pending',
            createdAt: serverTimestamp()
        });
        showToast("Premium talebi Galaksi Adminine iletildi!", "success");
        document.getElementById('premium-welcome-modal').classList.add('hidden');
    } catch (err) {
        showToast("Hata: " + err.message, "error");
    }
};

document.getElementById('close-premium-welcome-btn').onclick = () => {
    document.getElementById('premium-welcome-modal').classList.add('hidden');
};

// --- KULLANICI AYARLARI MANTIĞI ---
window.openUserSettings = (tab = 'account') => {
    const user = auth.currentUser;
    if (!user) return;

    document.getElementById('user-settings-modal').classList.remove('hidden');
    
    // Verileri yükle
    document.getElementById('settings-pfp-preview').src = user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName || 'Üye'}`;
    document.getElementById('settings-name-display').innerText = user.displayName || 'İsimsiz Üye';
    document.getElementById('settings-email-display').innerText = user.email;

    // Premium durumu kontrol
    getDoc(doc(db, 'users', user.uid)).then(docSnap => {
        const isPremium = docSnap.exists() && docSnap.data().isPremium;
        const premBox = document.getElementById('settings-premium-box');
        if (isPremium) {
            premBox.style.borderColor = 'gold';
            premBox.style.background = 'rgba(255,215,0,0.05)';
            premBox.innerHTML = `
                <i data-lucide="shield-check" style="width: 60px; height: 60px; color: gold; margin-bottom: 20px;"></i>
                <h3 style="color: gold; font-size: 20px;">AKTİF PREMIUM ÜYE</h3>
                <p style="color: var(--text-secondary); margin-bottom: 15px;">Galaktik Chatin ayrıcalıklarının tadını çıkarıyorsun! 🚀</p>
            `;
        } else {
             premBox.innerHTML = `
                <i data-lucide="shield-alert" style="width: 60px; height: 60px; color: grey; margin-bottom: 20px; opacity: 0.5;"></i>
                <h3 style="color: white; font-size: 20px;">Henüz Premium Değilsiniz</h3>
                <p style="color: var(--text-secondary); margin-bottom: 25px;">Galaktik bannerlar, özel mesaj efektleri ve daha fazlası için Premium'a geçin.</p>
                <button class="auth-btn" style="background: gold; color: black; font-weight: 900;" onclick="document.getElementById('user-settings-modal').classList.add('hidden'); document.getElementById('open-premium-promo-test')?.click();">HEMEN PREMIUM OL</button>
            `;
        }
        lucide.createIcons();
    });

    switchSettingsTab(tab);
};

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

// TEMA MANTIĞI
const themes_config = {
    default: { brand: '#c5a059', bg: '#05060f', side: 'rgba(10, 11, 24, 0.95)' },
    solar: { brand: '#e94560', bg: '#1a1a2e', side: '#16213e' },
    nebula: { brand: '#a000ff', bg: '#10002b', side: '#240046' }
};

document.querySelectorAll('.theme-card').forEach(card => {
    card.onclick = () => {
        const themeK = card.dataset.theme;
        applyTheme(themeK);
        localStorage.setItem('chatin-theme', themeK);
        // Aktif kartı güncelle
        document.querySelectorAll('.theme-card').forEach(c => c.classList.toggle('active', c.dataset.theme === themeK));
    };
});

const applyTheme = (themeKey) => {
    const t = themes_config[themeKey] || themes_config.default;
    document.documentElement.style.setProperty('--brand-color', t.brand);
    document.documentElement.style.setProperty('--bg-deep', t.bg);
    document.documentElement.style.setProperty('--bg-side', t.side);
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

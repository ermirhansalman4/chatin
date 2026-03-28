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
    deleteDoc
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

import { 
    ref as rtdbRef, 
    onValue as onRtdbValue 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

import { joinVoiceChannel, leaveVoiceChannel, startScreenShare, stopScreenShare } from './voice.js';
import { rtdb } from './firebase.config.js';

import { 
    ref, 
    uploadBytesResumable, 
    getDownloadURL 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

// --- STATE MANAGEMENT ---
let currentServerId = null; 
let currentChannelId = null; 
let unsubscribeMessages = null;
let unsubscribeServers = null;
let unsubscribeChannels = null;
let unsubscribeMembers = null;
let currentVoiceChannelId = null;

const messageList = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatHeaderName = document.getElementById('active-channel-name');
const serverListContainer = document.getElementById('server-list');
const textChannelsContainer = document.getElementById('text-channels-container');
const voiceChannelsContainer = document.getElementById('voice-channels-container');
const memberListContainer = document.getElementById('member-list-container');
const activeServerName = document.getElementById('active-server-name');
const inviteBox = document.getElementById('invite-box');
const currentInviteCode = document.getElementById('current-invite-code');

const voiceArea = document.getElementById('voice-area');
const voiceGrid = document.getElementById('voice-grid');
const messageInputContainer = document.getElementById('message-input-container');

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
            }
        });
        // En aşağı kaydır
        messageList.scrollTop = messageList.scrollHeight;
    }, (error) => {
        console.error("Mesajlar yüklenirken hata oluştu:", error);
        if (error.code === 'failed-precondition') {
            console.warn("⚠️ Firestore Endeksi Eksik! Konsoldaki linke tıklayarak endeks oluşturun.");
        }
    });
};

/**
 * Mesaj gönder
 */
export const sendMessage = async (text, file = null) => {
    if (!text && !file) return;

    try {
        const user = auth.currentUser;
        let fileURL = null;

        if (file) {
            fileURL = await uploadFile(file);
        }

        await addDoc(collection(db, 'messages'), {
            channelId: currentChannelId,
            userId: user.uid,
            username: user.displayName,
            userPhoto: user.photoURL,
            text: text,
            fileURL: fileURL,
            type: file ? 'image' : 'text', // Basitçe image/text ayırıyoruz
            createdAt: serverTimestamp()
        });

        chatInput.value = ''; // Inputu temizle
    } catch (error) {
        console.error("Message send error:", error);
    }
};

/**
 * Dosya yükleme (Base64 yöntemi ile CORS sorununu baypas eder)
 */
const uploadFile = async (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(file);
    });
};

/**
 * Mesajı UI'da render et
 */
const renderMessage = (data, id) => {
    const time = data.createdAt?.toDate() ? data.createdAt.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Az önce';
    
    const msgHtml = `
        <div class="message-item" id="${id}" style="display: flex; gap: 16px; margin-bottom: 16px;">
            <img class="msg-avatar" src="${data.userPhoto || `https://ui-avatars.com/api/?name=${data.username}&background=random`}" 
                 style="width: 40px; height: 40px; border-radius: 50%; cursor: pointer;">
            <div>
                <div style="display: flex; gap: 8px; align-items: baseline;">
                    <span class="msg-username" style="font-weight: bold; color: #fff; cursor: pointer;">
                        ${data.username}
                    </span>
                    <span style="font-size: 12px; color: var(--text-secondary);">${time}</span>
                </div>
                <p style="color: #dcddde; margin-top: 2px;">${data.text}</p>
                ${data.fileURL ? `<img src="${data.fileURL}" style="max-width: 300px; border-radius: 8px; margin-top: 8px; cursor: pointer;">` : ''}
            </div>
        </div>
    `;
    messageList.insertAdjacentHTML('beforeend', msgHtml);
    
    // Güvenli Tıklama Dinleyicileri (CSP Friendly)
    const item = messageList.lastElementChild;
    const profileOpen = () => window.openUserProfile({username: data.username, photoURL: data.userPhoto});
    item.querySelector('.msg-avatar').addEventListener('click', profileOpen);
    item.querySelector('.msg-username').addEventListener('click', profileOpen);
};

// --- EVENT LISTENERS ---

chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage(chatInput.value);
    }
});

// --- SERVER & CHANNEL FUNCTIONS ---

export const createServer = async (name, iconFile = null) => {
    const user = auth.currentUser;
    let iconURL = null;
    if (iconFile) iconURL = await uploadFile(iconFile);

    const inviteCode = Math.random().toString(36).substring(2, 9);

    const serverRef = await addDoc(collection(db, 'servers'), {
        name,
        ownerId: user.uid,
        members: [user.uid],
        iconURL: iconURL,
        inviteCode: inviteCode,
        createdAt: serverTimestamp()
    });

    // Create default channel
    await addDoc(collection(db, 'channels'), {
        serverId: serverRef.id,
        name: 'genel',
        type: 'text',
        createdAt: serverTimestamp()
    });

    return serverRef.id;
};

export const joinServer = async (inviteCode) => {
    const user = auth.currentUser;
    const q = query(collection(db, 'servers'), where('inviteCode', '==', inviteCode));
    const querySnapshot = await getDocs(q); // getDocs needs to be imported

    if (querySnapshot.empty) throw new Error("Geçersiz davet kodu!");

    const serverDoc = querySnapshot.docs[0];
    await updateDoc(doc(db, 'servers', serverDoc.id), {
        members: arrayUnion(user.uid)
    });
    
    return serverDoc.id;
};

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

export const switchServer = (serverId, serverData) => {
    currentServerId = serverId;
    window.lastActiveServerId = serverId;
    activeServerName.innerText = serverData.name;
    
    // Show Invite Box
    inviteBox.classList.remove('hidden');
    currentInviteCode.innerText = serverData.inviteCode;

    listenToChannels(serverId);
    listenToMembers(serverId);
    
    // Refresh Icons for active state
    document.querySelectorAll('.server-icon').forEach(icon => {
        icon.classList.remove('active');
        if(icon.dataset.id === serverId) icon.classList.add('active');
    });
};

const listenToChannels = (serverId) => {
    if (unsubscribeChannels) unsubscribeChannels();
    const q = query(collection(db, 'channels'), where('serverId', '==', serverId));
    
    unsubscribeChannels = onSnapshot(q, (snapshot) => {
        textChannelsContainer.innerHTML = '';
        voiceChannelsContainer.innerHTML = '';
        snapshot.docs.forEach((doc, index) => {
            const data = doc.data();
            renderChannelItem(data, doc.id);
            // Auto switch to first text channel if not set
            if (index === 0 && !currentChannelId && data.type === 'text') {
                switchChannel(doc.id, data.name, data.type);
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
    if (!confirm("Bu kanalı silmek istediğinizden emin misiniz?")) return;
    await deleteDoc(doc(db, 'channels', channelId));
};

export const renameChannel = async (channelId, oldName) => {
    const newName = prompt("Yeni kanal adı:", oldName);
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

const listenToMembers = (serverId) => {
    if (unsubscribeMembers) unsubscribeMembers();
    
    // Member listesi: Tüm kullanıcıları göster
    const q = query(collection(db, 'users'));
    
    unsubscribeMembers = onSnapshot(q, (snapshot) => {
        memberListContainer.innerHTML = '';
        snapshot.docs.forEach(docSnap => {
            const userData = docSnap.data();
            renderMemberItem(userData);
            
            // HER ÜYE İÇİN RTDB'DEKİ GERÇEK ZAMANLI DURUMU DİNLE
            const userStatusPath = rtdbRef(rtdb, '/status/' + userData.uid);
            onRtdbValue(userStatusPath, (snap) => {
                const statusData = snap.val();
                const state = statusData ? statusData.state : 'offline';
                updateMemberStatusUI(userData.uid, state);
            });
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
    const isOwner = serverDoc.exists() && serverDoc.data().ownerId === auth.currentUser.uid;

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
        item.querySelector('.edit-chan-btn').addEventListener('click', () => renameChannel(id, data.name));
        item.querySelector('.delete-chan-btn').addEventListener('click', () => deleteChannel(id));
    }

    lucide.createIcons();
};

const renderMemberItem = (data) => {
    const html = `
        <div class="member-item" data-uid="${data.uid}" style="cursor: pointer; display: flex; align-items: center; gap: 12px; padding: 8px; border-radius: 8px; transition: 0.2s;">
            <div style="position: relative;">
                <img src="${data.photoURL || `https://ui-avatars.com/api/?name=${data.username}&background=random`}" alt="u" style="width: 32px; height: 32px; border-radius: 50%;">
                <div class="status-dot" style="position: absolute; bottom: 0; right: 0; width: 10px; height: 10px; border-radius: 50%; background: #999; border: 2px solid var(--bg-deep);"></div>
            </div>
            <span style="font-size: 14px; font-weight: 500;">${data.username}</span>
        </div>
    `;
    memberListContainer.insertAdjacentHTML('beforeend', html);
    
    // Güvenli Tıklama Dinleyicisi
    memberListContainer.lastElementChild.addEventListener('click', () => {
        window.openUserProfile(data);
    });
};

// Auth başarısından sonra kapıları aç (UI Sync)
window.addEventListener('auth-success', (e) => {
    const authOverlay = document.getElementById('auth-overlay');
    const appContainer = document.getElementById('app-container');
    const nameEl = document.getElementById('current-user-name');
    const pfpEl = document.getElementById('current-user-avatar');

    if (authOverlay) authOverlay.classList.add('hidden');
    if (appContainer) appContainer.classList.remove('hidden');

    const user = e.detail;
    if (nameEl) nameEl.innerText = user.displayName || user.username || "Kullanıcı";
    if (pfpEl) pfpEl.src = user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}&background=random`;

    listenToServers();
});

// Oturum kapatıldığında giriş ekranına dön
window.addEventListener('auth-logout', () => {
    document.getElementById('auth-overlay').classList.remove('hidden');
    document.getElementById('app-container').classList.add('hidden');
});

// Ses kanalından ayrılma butonu tetiklendiğinde
window.addEventListener('leave-voice', async () => {
    if (currentVoiceChannelId) {
        await leaveVoiceChannel(currentVoiceChannelId);
        
        // UI'yı metin kanalı moduna çek (aktif olan son metin kanalına dönebiliriz veya boş bırakabiliriz)
        // Şimdilik sadece ses alanını gizleyip mesaj listesini gösterelim
        messageList.classList.remove('hidden');
        messageInputContainer.classList.remove('hidden');
        voiceArea.classList.add('hidden');
        
        chatHeaderName.innerText = "Sohbet";
        currentVoiceChannelId = null;
        if (unsubscribeVoiceMembers) unsubscribeVoiceMembers();
    }
});

// --- GLOBAL BUTTON LISTENERS ---

// Metin Kanalı Ekleme (+)
document.addEventListener('click', async (e) => {
    const btn = e.target.closest('#add-text-channel-btn');
    if (btn) {
        const name = prompt("Yeni metin kanalı adı:");
        if (name) await createChannel(name, 'text');
    }
});

// Ses Kanalı Ekleme (+)
document.addEventListener('click', async (e) => {
    const btn = e.target.closest('#add-voice-channel-btn');
    if (btn) {
        const name = prompt("Yeni ses kanalı adı:");
        if (name) await createChannel(name, 'voice');
    }
});

// Sunucu Ekleme
document.addEventListener('click', (e) => {
    const btn = e.target.closest('#add-server-btn');
    if (btn) {
        const name = prompt("Yeni sunucu adı:");
        if (name) {
            createServer(name).then(() => listenToServers());
        }
    }
});

// Davetle Katılma (Keşfet)
document.addEventListener('click', (e) => {
    const btn = e.target.closest('#explore-btn');
    if (btn) {
        const code = prompt("Katılmak istediğiniz sunucunun davet kodunu girin:");
        if (code) {
            joinServer(code).then(() => listenToServers()).catch(err => alert(err.message));
        }
    }
});

// Ses Ayarları
let isMuted = false;
let isDeafened = false;

document.addEventListener('click', (e) => {
    const micBtn = e.target.closest('#mic-btn');
    if (micBtn) {
        isMuted = !isMuted;
        const icon = isMuted ? 'mic-off' : 'mic';
        micBtn.innerHTML = `<i data-lucide="${icon}"></i>`;
        micBtn.style.color = isMuted ? 'var(--error-color)' : 'var(--text-secondary)';
        lucide.createIcons();
    }

    const deafBtn = e.target.closest('#deafen-btn');
    if (deafBtn) {
        isDeafened = !isDeafened;
        // Lucide'de headphones-off olmadığı için aynı ikonu tutup rengini değiştiriyoruz
        deafBtn.innerHTML = `<i data-lucide="headphones"></i>`;
        deafBtn.style.color = isDeafened ? 'var(--error-color)' : 'var(--text-secondary)';
        lucide.createIcons();
    }

    const settingsBtn = e.target.closest('#settings-btn');
    const profileBtn = e.target.closest('#user-profile-btn');
    if (settingsBtn || profileBtn) {
        const user = auth.currentUser;
        if (user && window.openUserProfile) {
            window.openUserProfile({
                uid: user.uid,
                username: user.displayName || user.username || "Kullanıcı",
                photoURL: user.photoURL
            });
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
});

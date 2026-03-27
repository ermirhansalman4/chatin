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

import { joinVoiceChannel, leaveVoiceChannel } from './voice.js';
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

const messageList = document.getElementById('message-list');
const chatInput = document.getElementById('chat-input');
const chatHeaderName = document.getElementById('active-channel-name');
const serverListContainer = document.getElementById('server-list');
const textChannelsContainer = document.getElementById('text-channels-container');
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
            <img src="${data.userPhoto || `https://ui-avatars.com/api/?name=${data.username}&background=random`}" 
                 onclick='window.openUserProfile({username: "${data.username}", photoURL: "${data.userPhoto}", status: "online"})'
                 style="width: 40px; height: 40px; border-radius: 50%; cursor: pointer;">
            <div>
                <div style="display: flex; gap: 8px; align-items: baseline;">
                    <span style="font-weight: bold; color: #fff; cursor: pointer;" 
                          onclick='window.openUserProfile({username: "${data.username}", photoURL: "${data.userPhoto}", status: "online"})'>
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
        snapshot.docs.forEach((doc, index) => {
            renderChannelItem(doc.data(), doc.id);
            // Auto switch to first channel if not set
            if (index === 0 && !currentChannelId) {
                switchChannel(doc.id, doc.data().name, doc.data().type);
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
        <div class="voice-card" data-uid="${data.uid}" 
             onclick='window.openUserProfile(${JSON.stringify(data)})'
             style="cursor: pointer;">
            <img src="${data.photoURL || `https://ui-avatars.com/api/?name=${data.username}&background=random`}" alt="u">
            <span>${data.username}</span>
            <div class="voice-status-icons">
                 <!-- Speaking/Mute icons can go here -->
            </div>
        </div>
    `;
    voiceGrid.insertAdjacentHTML('beforeend', html);
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
    textChannelsContainer.insertAdjacentHTML('beforeend', html);
    
    const item = textChannelsContainer.lastElementChild;
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
        <div class="member-item" data-uid="${data.uid}" onclick='window.openUserProfile(${JSON.stringify(data)})' style="cursor: pointer;">
            <div style="position: relative;">
                <img src="${data.photoURL || `https://ui-avatars.com/api/?name=${data.username}&background=random`}" alt="u" style="width: 32px; height: 32px; border-radius: 50%;">
                <div class="status-dot" style="position: absolute; bottom: 0; right: 0; width: 10px; height: 10px; border-radius: 50%; background: #999; border: 2px solid var(--bg-members);"></div>
            </div>
            <span>${data.username}</span>
        </div>
    `;
    memberListContainer.insertAdjacentHTML('beforeend', html);
};

// Auth başarısından sonra mesajları dinlemeye başla
window.addEventListener('auth-success', () => {
    listenToServers();
});

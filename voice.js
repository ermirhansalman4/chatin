import { db, auth } from './firebase.config.js';
import { 
    collection, 
    addDoc, 
    onSnapshot, 
    doc, 
    updateDoc, 
    getDoc,
    setDoc,
    deleteDoc,
    query,
    where
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const servers = {
    iceServers: [
        {
            urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
        },
    ],
    iceCandidatePoolSize: 10,
};

let localStream = null;
let screenStream = null;
let peerConnections = {}; // uid -> RTCPeerConnection
let unsubscribeOffers = null; // Offer dinleyicisini temizlemek için

// UI Elements for feedback (optional, we can use a hidden audio pool)
const audioContainer = document.createElement('div');
audioContainer.id = 'remote-audio-container';
audioContainer.style.display = 'none';
document.body.appendChild(audioContainer);

/**
 * Ses kanalına katılır. Diğer kullanıcılarla WebRTC bağlantısı kurar.
 */
export const joinVoiceChannel = async (channelId) => {
    const user = auth.currentUser;
    if (!user) return;

    console.log(`🎤 Kanal ${channelId} bağlantısı kuruluyor...`);

    // 1. Microphone Al
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Bağlantınız güvenli (HTTPS) değil. Ekran paylaşımı ve ses için HTTPS veya localhost zorunludur.");
        return;
    }

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
        console.error("Mikrofon erişimi reddedildi:", e);
        return;
    }

    // 2. Kanala Katılım Kaydı
    const channelRef = doc(db, 'channels', channelId);
    const membersRef = collection(channelRef, 'voice_members');
    
    await setDoc(doc(membersRef, user.uid), {
        uid: user.uid,
        username: user.displayName,
        photoURL: user.photoURL,
        isSharing: !!screenStream, // EĞER PAYLAŞIM VARSA YENİ GELENLERE BİLDİR
        joinedAt: Date.now()
    });

    // 3. Mevcut üyeleri dinle
    onSnapshot(membersRef, (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            const memberData = change.doc.data();
            if (memberData.uid === user.uid) return;

            if (change.type === 'added') {
                if (user.uid < memberData.uid) initiateCall(channelId, memberData.uid);
            } else if (change.type === 'removed') {
                closeConnection(memberData.uid);
            }
        });
    });

    const offersRef = collection(channelRef, 'offers');
    const now = Date.now();
    if (unsubscribeOffers) unsubscribeOffers();
    const q = query(offersRef, where('createdAt', '>', now));
    
    unsubscribeOffers = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            const data = change.doc.data();
            if (data.targetUid === user.uid) {
                if (change.type === 'added' || change.type === 'modified') {
                    handleIncomingCall(channelId, data, change.doc.id);
                }
            }
        });
    });
};

const initiateCall = async (channelId, targetUid) => {
    const user = auth.currentUser;
    const pc = createPeerConnection(targetUid);
    peerConnections[targetUid] = pc;

    // Sesi Ekle
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    // EĞER ŞU AN EKRAN PAYLAŞIYORSAK, BUNU DA EKLE!
    if (screenStream) {
        screenStream.getTracks().forEach(track => pc.addTrack(track, screenStream));
    }

    const offerDoc = doc(collection(db, 'channels', channelId, 'offers'));
    const offerCandidates = collection(offerDoc, 'offerCandidates');
    pc.onicecandidate = (event) => event.candidate && addDoc(offerCandidates, event.candidate.toJSON());

    const offerDescription = await pc.createOffer();
    await pc.setLocalDescription(offerDescription);

    const offer = {
        sdp: offerDescription.sdp,
        type: offerDescription.type,
        senderUid: user.uid,
        targetUid: targetUid,
        createdAt: Date.now()
    };
    await setDoc(offerDoc, offer);

    // RENEGOTIATION (Ekran paylaşımı açılıp kapandığında burası tetiklenir)
    pc.onnegotiationneeded = async () => {
        console.log("Renegotiation needed for:", targetUid);
        const newOffer = await pc.createOffer();
        await pc.setLocalDescription(newOffer);
        await updateDoc(offerDoc, {
            sdp: newOffer.sdp,
            type: newOffer.type,
            createdAt: Date.now()
        });
    };

    onSnapshot(offerDoc, (snapshot) => {
        const data = snapshot.data();
        if (data?.answer && pc.signalingState === 'have-local-offer') {
            pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
    });

    const answerCandidates = collection(offerDoc, 'answerCandidates');
    onSnapshot(answerCandidates, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added' && pc.remoteDescription) {
                pc.addIceCandidate(new RTCIceCandidate(change.doc.data())).catch(e => {});
            }
        });
    });
};

const handleIncomingCall = async (channelId, data, offerDocId) => {
    const senderUid = data.senderUid;
    let pc = peerConnections[senderUid];
    
    if (!pc) {
        pc = createPeerConnection(senderUid);
        peerConnections[senderUid] = pc;
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        if (screenStream) {
            screenStream.getTracks().forEach(track => pc.addTrack(track, screenStream));
        }
    }

    const offerDoc = doc(db, 'channels', channelId, 'offers', offerDocId);
    const answerCandidates = collection(offerDoc, 'answerCandidates');
    const offerCandidates = collection(offerDoc, 'offerCandidates');

    pc.onicecandidate = (event) => event.candidate && addDoc(answerCandidates, event.candidate.toJSON());

    await pc.setRemoteDescription(new RTCSessionDescription({ type: data.type, sdp: data.sdp }));
    const answerDescription = await pc.createAnswer();
    await pc.setLocalDescription(answerDescription);

    await updateDoc(offerDoc, { answer: { type: answerDescription.type, sdp: answerDescription.sdp } });

    onSnapshot(offerCandidates, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added' && pc.remoteDescription) {
                pc.addIceCandidate(new RTCIceCandidate(change.doc.data())).catch(e => {});
            }
        });
    });
};

const createPeerConnection = (targetUid) => {
    const pc = new RTCPeerConnection(servers);
    pc.ontrack = (event) => {
        const remoteStream = event.streams[0];
        if (event.track.kind === 'audio') {
            let audio = document.getElementById(`audio-${targetUid}`);
            if (!audio) {
                audio = document.createElement('audio');
                audio.id = `audio-${targetUid}`;
                document.body.appendChild(audio);
            }
            audio.srcObject = remoteStream;
            audio.autoplay = true;
        } 
        
        if (event.track.kind === 'video') {
            const display = document.getElementById('screen-share-display');
            if (display) {
                display.classList.remove('hidden');
                display.innerHTML = ''; 
                const video = document.createElement('video');
                video.autoplay = true;
                video.playsInline = true;
                video.srcObject = remoteStream;
                display.appendChild(video);
            }
        }
    };

    pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            closeConnection(targetUid);
        }
    };
    return pc;
};

const closeConnection = (uid) => {
    if (peerConnections[uid]) {
        peerConnections[uid].close();
        delete peerConnections[uid];
        const audio = document.getElementById(`audio-${uid}`);
        if (audio) audio.remove();
    }
};

export const toggleLocalMic = (enabled) => {
    if (localStream) {
        localStream.getAudioTracks().forEach(track => {
            track.enabled = enabled;
        });
    }
};

export const startScreenShare = async () => {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        
        // Kendi Önizlemeni Aç
        const display = document.getElementById('screen-share-display');
        if (display) {
            display.classList.remove('hidden');
            display.innerHTML = ''; 
            const localVideo = document.createElement('video');
            localVideo.autoplay = true;
            localVideo.muted = true;
            localVideo.srcObject = screenStream;
            display.appendChild(localVideo);
        }

        // MEVCUT TÜM BAĞLANTILARA TRACK EKLE! (onnegotiationneeded sayesinde karşıya gider)
        screenStream.getTracks().forEach(track => {
            Object.values(peerConnections).forEach(pc => {
                pc.addTrack(track, screenStream);
            });
        });

        screenStream.getVideoTracks()[0].onended = () => stopScreenShare();
        return true;
    } catch (e) {
        console.error("Ekran paylaşımı hatası:", e);
        return false;
    }
};

export const stopScreenShare = async () => {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
        
        // Geniş ekranı gizle
        const display = document.getElementById('screen-share-display');
        if (display) {
            display.classList.add('hidden');
            display.innerHTML = '';
        }

        console.log("Ekran paylaşımı durduruldu.");
    }
};

export const leaveVoiceChannel = async (channelId) => {
    const user = auth.currentUser;
    if (!user) return;

    console.log(`🔇 Kanaldan ayrılıyor: ${channelId}`);
    
    // Ekran paylaşımını durdur
    stopScreenShare();

    // Dinleyicileri temizle
    if (unsubscribeOffers) {
        unsubscribeOffers();
        unsubscribeOffers = null;
    }

    // Firestore'dan üyelik kaydını sil
    await deleteDoc(doc(db, 'channels', channelId, 'voice_members', user.uid));

    // Tüm bağlantıları kapat
    Object.keys(peerConnections).forEach(uid => closeConnection(uid));

    // Mikrofonu kapat
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
};

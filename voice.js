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
let peerConnections = {}; // uid -> RTCPeerConnection

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
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    // 2. Kanala Katılım Kaydı (Firestore)
    const channelRef = doc(db, 'channels', channelId);
    const membersRef = collection(channelRef, 'voice_members');
    
    // Kendimizi online olarak işaretle
    await setDoc(doc(membersRef, user.uid), {
        uid: user.uid,
        username: user.displayName,
        photoURL: user.photoURL,
        joinedAt: Date.now()
    });

    // 3. Diğer üyeleri dinle (Mevcut üyeler için PC başlat)
    onSnapshot(membersRef, (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            const memberData = change.doc.data();
            if (memberData.uid === user.uid) return; // Kendimizle konuşmayız

            if (change.type === 'added') {
                // Her yeni üye için bir bağlantı kur
                // Strateji: UID'si alfabetik olarak "küçük" olan arar (offer), "büyük" olan bekler
                if (user.uid < memberData.uid) {
                    initiateCall(channelId, memberData.uid);
                }
            } else if (change.type === 'removed') {
                closeConnection(memberData.uid);
            }
        });
    });

    // 4. Bize gelen teklifleri (offers) dinle
    const offersRef = collection(channelRef, 'offers');
    onSnapshot(offersRef, (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            const data = change.doc.data();
            if (data.targetUid === user.uid && change.type === 'added') {
                handleIncomingCall(channelId, data, change.doc.id);
            }
        });
    });

    // Pencere kapandığında çıkış yap
    window.addEventListener('beforeunload', () => leaveVoiceChannel(channelId));
};

/**
 * Başka bir kullanıcıya çağrı başlatır (Offer)
 */
const initiateCall = async (channelId, targetUid) => {
    const user = auth.currentUser;
    const pc = createPeerConnection(targetUid);
    peerConnections[targetUid] = pc;

    // Local stream'i PeerConnection'a ekle
    localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
    });

    const channelRef = doc(db, 'channels', channelId);
    const offersRef = collection(channelRef, 'offers');
    const offerDoc = doc(offersRef); // Rastgele ID ile yeni döküman

    // ICE adaylarını Firebase'e kaydet (Offer sahibi olarak)
    const offerCandidates = collection(offerDoc, 'offerCandidates');
    pc.onicecandidate = (event) => {
        event.candidate && addDoc(offerCandidates, event.candidate.toJSON());
    };

    // Offer oluştur
    const offerDescription = await pc.createOffer();
    await pc.setLocalDescription(offerDescription);

    const offer = {
        sdp: offerDescription.sdp,
        type: offerDescription.type,
        senderUid: user.uid,
        targetUid: targetUid
    };

    await setDoc(offerDoc, offer);

    // Answer'ı dinle
    onSnapshot(offerDoc, (snapshot) => {
        const data = snapshot.data();
        if (!pc.currentRemoteDescription && data?.answer) {
            const answerDescription = new RTCSessionDescription(data.answer);
            pc.setRemoteDescription(answerDescription);
        }
    });

    // Uzak ICE adaylarını dinle
    const answerCandidates = collection(offerDoc, 'answerCandidates');
    onSnapshot(answerCandidates, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
                pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
            }
        });
    });
};

/**
 * Gelen çağrıyı yanıtlar (Answer)
 */
const handleIncomingCall = async (channelId, data, offerDocId) => {
    const senderUid = data.senderUid;
    const pc = createPeerConnection(senderUid);
    peerConnections[senderUid] = pc;

    localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
    });

    const offerDoc = doc(db, 'channels', channelId, 'offers', offerDocId);
    const answerCandidates = collection(offerDoc, 'answerCandidates');
    const offerCandidates = collection(offerDoc, 'offerCandidates');

    pc.onicecandidate = (event) => {
        event.candidate && addDoc(answerCandidates, event.candidate.toJSON());
    };

    await pc.setRemoteDescription(new RTCSessionDescription(data));

    const answerDescription = await pc.createAnswer();
    await pc.setLocalDescription(answerDescription);

    const answer = {
        type: answerDescription.type,
        sdp: answerDescription.sdp,
    };

    await updateDoc(offerDoc, { answer });

    onSnapshot(offerCandidates, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
                pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
            }
        });
    });
};

/**
 * Ortak PeerConnection oluşturma ve event bağlama
 */
const createPeerConnection = (targetUid) => {
    const pc = new RTCPeerConnection(servers);

    pc.ontrack = (event) => {
        console.log(`🔊 Uzak ses akışı alındı: ${targetUid}`);
        const remoteStream = event.streams[0];
        
        let audio = document.getElementById(`audio-${targetUid}`);
        if (!audio) {
            audio = document.createElement('audio');
            audio.id = `audio-${targetUid}`;
            audio.autoplay = true;
            audioContainer.appendChild(audio);
        }
        audio.srcObject = remoteStream;
    };

    pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'disconnected') {
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

export const leaveVoiceChannel = async (channelId) => {
    const user = auth.currentUser;
    if (!user) return;

    console.log(`🔇 Kanaldan ayrılıyor: ${channelId}`);
    
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

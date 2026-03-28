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
        alert("Tarayıcınız mikrofon erişimine izin vermiyor veya bağlantınız güvenli (HTTPS) değil. Ses kanalı için HTTPS veya localhost gereklidir.");
        console.error("navigator.mediaDevices bulunamadı. Güvenli olmayan bir bağlantı (HTTP) kullanıyor olabilirsiniz.");
        return;
    }

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
        console.error("Mikrofon erişimi reddedildi:", e);
        alert("Mikrofon izni verilmedi. Ses kanalına katılamazsınız.");
        return;
    }

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

    // 4. Bize gelen teklifleri (offers) dinle (Sadece yeni teklifler)
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
        targetUid: targetUid,
        createdAt: Date.now()
    };

    await setDoc(offerDoc, offer);

    // Re-negotiation (Yeniden el sıkışma) olayını dinle
    pc.onnegotiationneeded = async () => {
        console.log("Renegotiation needed for:", targetUid);
        const newOffer = await pc.createOffer();
        await pc.setLocalDescription(newOffer);
        await updateDoc(offerDoc, {
            sdp: newOffer.sdp,
            type: newOffer.type,
            createdAt: Date.now() // Diğer tarafın 'modified' olarak yakalayabilmesi için
        });
    };

    onSnapshot(offerDoc, (snapshot) => {
        const data = snapshot.data();
        // Sadece bekleyen bir offer varsa answer'ı kabul et
        if (data?.answer && pc.signalingState === 'have-local-offer') {
            console.log("Setting remote answer from modified doc");
            const answerDescription = new RTCSessionDescription(data.answer);
            pc.setRemoteDescription(answerDescription).catch(e => console.error("Remote description error:", e));
        }
    });

    // Uzak ICE adaylarını dinle (Sadece bir kez başlat)
    if (!pc._iceStarted) {
        pc._iceStarted = true;
        const answerCandidates = collection(offerDoc, 'answerCandidates');
        onSnapshot(answerCandidates, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added' && pc.remoteDescription) {
                    pc.addIceCandidate(new RTCIceCandidate(change.doc.data())).catch(e => {});
                }
            });
        });
    }
};

/**
 * Gelen çağrıyı yanıtlar (Answer)
 */
const handleIncomingCall = async (channelId, data, offerDocId) => {
    const senderUid = data.senderUid;
    let pc = peerConnections[senderUid];
    
    if (!pc) {
        pc = createPeerConnection(senderUid);
        peerConnections[senderUid] = pc;
        localStream.getTracks().forEach((track) => {
            pc.addTrack(track, localStream);
        });
    }

    const offerDoc = doc(db, 'channels', channelId, 'offers', offerDocId);
    const answerCandidates = collection(offerDoc, 'answerCandidates');
    const offerCandidates = collection(offerDoc, 'offerCandidates');

    pc.onicecandidate = (event) => {
        event.candidate && addDoc(answerCandidates, event.candidate.toJSON());
    };

    await pc.setRemoteDescription(new RTCSessionDescription({
        type: data.type,
        sdp: data.sdp
    }));

    const answerDescription = await pc.createAnswer();
    await pc.setLocalDescription(answerDescription);

    const answer = {
        type: answerDescription.type,
        sdp: answerDescription.sdp,
    };

    await updateDoc(offerDoc, { answer });

    if (!pc._iceInStarted) {
        pc._iceInStarted = true;
        onSnapshot(offerCandidates, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added' && pc.remoteDescription) {
                    pc.addIceCandidate(new RTCIceCandidate(change.doc.data())).catch(e => {});
                }
            });
        });
    }
};

/**
 * Ortak PeerConnection oluşturma ve event bağlama
 */
const createPeerConnection = (targetUid) => {
    const pc = new RTCPeerConnection(servers);

    pc.ontrack = (event) => {
        console.log(`🔊 Uzak akış alındı: ${targetUid}`, event.streams[0]);
        const remoteStream = event.streams[0];
        const track = event.track;

        if (track.kind === 'audio') {
            let audio = document.getElementById(`audio-${targetUid}`);
            if (!audio) {
                audio = document.createElement('audio');
                audio.id = `audio-${targetUid}`;
                audioContainer.appendChild(audio);
            }
            audio.srcObject = remoteStream;
            audio.autoplay = true;
            audio.play().catch(e => console.warn("Otomatik oynatma engellendi:", e));
        } 
        
        if (track.kind === 'video') {
            // GENİŞ EKRANA GÖRÜNTÜYÜ VER
            const display = document.getElementById('screen-share-display');
            if (display) {
                display.classList.remove('hidden');
                display.innerHTML = ''; // Önceki görüntüyü temizle
                
                const video = document.createElement('video');
                video.id = `video-${targetUid}`;
                video.autoplay = true;
                video.playsInline = true;
                video.srcObject = remoteStream;
                display.appendChild(video);
            }
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log(`Connection State (${targetUid}):`, pc.iceConnectionState);
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
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
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
             throw new Error("HTTPS Gereklidir! Ekran paylaşımı güvenli olmayan bağlantılarda (HTTP) çalışmaz.");
        }

        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        const user = auth.currentUser;
        
        // 1. Kendi Geniş Ekran Önizlemeni Aç
        const display = document.getElementById('screen-share-display');
        if (display) {
            display.classList.remove('hidden');
            display.innerHTML = ''; 
            
            const localVideo = document.createElement('video');
            localVideo.id = `video-${user.uid}`;
            localVideo.autoplay = true;
            localVideo.muted = true;
            localVideo.playsInline = true;
            localVideo.srcObject = screenStream;
            display.appendChild(localVideo);
        }

        // 2. Her bağlantıya ekran paylam track'ini ekle
        const videoTrack = screenStream.getVideoTracks()[0];
        
        Object.values(peerConnections).forEach(pc => {
            pc.addTrack(videoTrack, screenStream);
        });

        // Paylaşım durdurulduğunda (Tarayıcı barından)
        videoTrack.onended = () => stopScreenShare();

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

const sounds = {
    click: new Audio('click.mp3'),
    ok: new Audio('ok.mp3'),
    falha: new Audio('falha.mp3')
};

let currentStudyDeck = [];
let currentCardIndex = 0;
let currentCard = null;
let textErrors = 0;
let bestSpeechErrors = Infinity;
let speechTries = 0;

window.showScreen = (id) => {
    sounds.click.play();
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
};

const sanitizeForFirestore = (obj) => {
    return JSON.parse(JSON.stringify(obj));
};

// Salvar Baralho
window.saveDeck = async () => {
    const month = document.getElementById('deck-month').value;
    const name = document.getElementById('deck-name').value;
    const vocabRaw = document.getElementById('deck-vocab').value;
    const phrase = document.getElementById('deck-phrase').value;

    if (!month || !name || !vocabRaw || !phrase) {
        alert("Preencha todos os campos!");
        return;
    }

    const vocabArray = vocabRaw.split('.').map(s => s.trim()).filter(Boolean);
    const fsrsCard = window.FSRS_Lib.createEmptyCard();
    const safeFsrsCard = sanitizeForFirestore(fsrsCard);

    const docData = {
        mesAno: month,
        nome: name,
        vocabulario: vocabArray,
        frase: phrase,
        criadoEm: new Date(),
        fsrs: safeFsrsCard
    };

    await window.salvarBaralhoDB(docData);
    sounds.ok.play();
    alert("Salvo com sucesso!");
    showScreen('menu-screen');
};

// Carregar Baralhos
window.loadDecks = async () => {
    const snapshot = await window.carregarBaralhosDB();
    const list = document.getElementById('decks-list');
    list.innerHTML = "";
    
    let currentMonth = "";
    snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const mesAno = data.mesAno || "sem-data";
        
        if (mesAno !== currentMonth) {
            currentMonth = mesAno;
            list.innerHTML += `<div class="month-title">${formatMonth(currentMonth)}</div>`;
        }
        
        let isDue = new Date(data.fsrs.due) <= new Date();
        let badge = isDue ? '🔴 Revisar' : '✅ Em dia';

        list.innerHTML += `<div class="deck-item" onclick="startStudy('${docSnap.id}', '${escape(JSON.stringify(data))}')">${data.nome} - ${badge}</div>`;
    });
};

const formatMonth = (mesAno) => {
    if (!mesAno || !mesAno.includes('-')) return "OUTROS";
    const [y, m] = mesAno.split('-');
    const date = new Date(y, m - 1);
    return date.toLocaleString('pt-BR', { month: 'long', year: 'numeric' }).toUpperCase();
};

// Lógica de Estudo
window.startStudy = (id, dataStr) => {
    currentCard = JSON.parse(unescape(dataStr));
    currentCard.id = id;
    textErrors = 0;
    bestSpeechErrors = Infinity;
    speechTries = 0;
    
    document.getElementById('study-input').value = "";
    document.getElementById('study-input').disabled = false;
    document.getElementById('btn-check').style.display = 'block';
    document.getElementById('speech-section').style.display = 'none';
    document.getElementById('btn-next').style.display = 'none';
    
    renderVocab();
    showScreen('study-screen');
};

const renderVocab = () => {
    const cont = document.getElementById('vocab-buttons');
    cont.innerHTML = "";
    currentCard.vocabulario.forEach(word => {
        cont.innerHTML += `<button class="vocab-btn" onclick="playAudio('${word}')">${word}</button>`;
    });
};

window.playAudio = (text) => {
    const ut = new SpeechSynthesisUtterance(text);
    ut.lang = 'de-DE';
    window.speechSynthesis.speak(ut);
};

window.playPhrase = () => playAudio(currentCard.frase);

const levenshtein = (a, b) => {
    const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
    for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
        }
    }
    return matrix[a.length][b.length];
};

const normalize = (str) => str.toLowerCase().replace(/[^\w\säöüß]/gi, '').trim();

window.checkText = () => {
    const input = document.getElementById('study-input').value;
    const expected = normalize(currentCard.frase);
    const typed = normalize(input);
    
    textErrors = levenshtein(expected, typed);
    
    if (textErrors === 0) sounds.ok.play();
    else sounds.falha.play();

    document.getElementById('study-input').disabled = true;
    document.getElementById('btn-check').style.display = 'none';
    document.getElementById('speech-section').style.display = 'block';
    document.getElementById('speech-tries').innerText = speechTries;
};

window.startSpeech = () => {
    if (speechTries >= 3) return;
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert("Reconhecimento de fala não suportado neste navegador.");
        document.getElementById('btn-next').style.display = 'block';
        return;
    }

    const reco = new SpeechRecognition();
    reco.lang = 'de-DE';
    reco.start();

    reco.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        const errs = levenshtein(normalize(currentCard.frase), normalize(transcript));
        
        if (errs < bestSpeechErrors) bestSpeechErrors = errs;
        speechTries++;
        
        document.getElementById('speech-result').innerText = `Entendido: "${transcript}" (Erros: ${errs})`;
        document.getElementById('speech-tries').innerText = speechTries;

        if (errs === 0 || speechTries >= 3) {
            document.getElementById('btn-speak').style.display = 'none';
            document.getElementById('btn-next').style.display = 'block';
            if(errs === 0) sounds.ok.play();
        }
    };
};

window.nextCard = async () => {
    if (bestSpeechErrors === Infinity) bestSpeechErrors = 5;
    
    let rating = 1; 
    if (textErrors === 0 && bestSpeechErrors === 0) rating = 4; 
    else if (textErrors <= 2 && bestSpeechErrors <= 2) rating = 3; 
    else if (textErrors <= 5 && bestSpeechErrors <= 5) rating = 2; 

    const f = new window.FSRS_Lib.fsrs();
    
    currentCard.fsrs.due = new Date(currentCard.fsrs.due);
    if (currentCard.fsrs.last_review) currentCard.fsrs.last_review = new Date(currentCard.fsrs.last_review);

    const schedulingCards = f.repeat(currentCard.fsrs, new Date());
    const nextFSRSRecord = sanitizeForFirestore(schedulingCards[rating].card);

    await window.atualizarCardDB(currentCard.id, nextFSRSRecord);

    showScreen('decks-screen');
    loadDecks();
};

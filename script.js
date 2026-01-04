/* ---------------------------------------------------
   MycoManager JS completo
   - Supabase Auth
   - Profili
   - Onboarding
   - Dashboard
   - Conversazioni + Messaggi su Supabase
   - Lazy loading
   - Realtime intelligente
   - Worker Claude (risposte + titoli automatici conversazioni)
--------------------------------------------------- */

/* -------------------------
   CONFIG
------------------------- */

const SUPABASE_URL = "https://pgmzhlhawjoinwhhveqx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_XKcDofMMMIWI3wY2s5R7Zg_-3w1WrEa";
const WORKER_URL = "https://claude.daviderappa96.workers.dev";

const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* -------------------------
   STATE
------------------------- */

let currentUser = null;
let userProfile = null;

let conversations = [];
let currentConversationId = null;
let isSendingMessage = false;

let messagesCache = new Map(); // conversationId -> messages[]
let realtimeChannel = null;

/* -------------------------
   DOM REFERENCES
------------------------- */

// Screens
const screenLanding = document.getElementById("screen-landing");
const screenAuth = document.getElementById("screen-auth");
const screenOnboarding = document.getElementById("screen-onboarding");
const screenDashboard = document.getElementById("screen-dashboard");

// Auth
const goToAuthBtn = document.getElementById("goToAuthBtn");
const backToLandingBtn = document.getElementById("backToLandingBtn");

const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");

const authRegisterBtn = document.getElementById("authRegisterBtn");
const authLoginBtn = document.getElementById("authLoginBtn");

const authMessage = document.getElementById("authMessage");

// Onboarding
const onboardingChat = document.getElementById("onboardingChat");
const onboardingForm = document.getElementById("onboardingForm");
const onboardingInput = document.getElementById("onboardingInput");
const onboardingSend = document.getElementById("onboardingSend");
const goToDashboardBtn = document.getElementById("goToDashboardBtn");

// Dashboard
const conversationsList = document.getElementById("conversationsList");
const newChatBtn = document.getElementById("newChatBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const logoutBtn = document.getElementById("logoutBtn");

const chatContainer = document.getElementById("chatContainer");
const messageForm = document.getElementById("messageForm");
const userInput = document.getElementById("userInput");
const sendButton = document.getElementById("sendButton");

const currentChatEmojiEl = document.getElementById("currentChatEmoji");
const currentChatTitleEl = document.getElementById("currentChatTitle");
const modelSelect = document.getElementById("modelSelect");

/* -------------------------
   SCREEN HANDLING
------------------------- */

function showScreen(name) {
  [screenLanding, screenAuth, screenOnboarding, screenDashboard].forEach((el) =>
    el.classList.remove("active")
  );

  if (name === "landing") screenLanding.classList.add("active");
  if (name === "auth") screenAuth.classList.add("active");
  if (name === "onboarding") screenOnboarding.classList.add("active");
  if (name === "dashboard") screenDashboard.classList.add("active");
}

/* -------------------------
   AUTH MESSAGE
------------------------- */

function setAuthMessage(type, text) {
  if (!text) {
    authMessage.classList.add("hidden");
    return;
  }
  authMessage.classList.remove("hidden");
  authMessage.textContent = text;
  authMessage.classList.remove("error", "success");
  authMessage.classList.add(type);
}

/* -------------------------
   NAVIGATION BUTTONS
------------------------- */

goToAuthBtn.addEventListener("click", () => showScreen("auth"));
backToLandingBtn.addEventListener("click", () => showScreen("landing"));

/* -------------------------
   AUTH — REGISTRAZIONE
------------------------- */

authRegisterBtn.addEventListener("click", async () => {
  const email = authEmail.value.trim();
  const password = authPassword.value.trim();

  if (!email || !password) {
    setAuthMessage("error", "Compila email e password.");
    return;
  }

  setAuthMessage(null, "");

  const { error } = await client.auth.signUp({ email, password });

  if (error) {
    setAuthMessage("error", error.message || "Errore durante la registrazione.");
    return;
  }

  setAuthMessage(
    "success",
    "Registrazione completata. Se richiesto, conferma via email e poi effettua il login."
  );
});

/* -------------------------
   AUTH — LOGIN
------------------------- */

authLoginBtn.addEventListener("click", async () => {
  const email = authEmail.value.trim();
  const password = authPassword.value.trim();

  if (!email || !password) {
    setAuthMessage("error", "Compila email e password.");
    return;
  }

  setAuthMessage(null, "");

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    setAuthMessage("error", error.message || "Errore durante il login.");
    return;
  }

  currentUser = data.user;
  setAuthMessage("success", "Login effettuato. Carico il profilo...");

  const profileRow = await fetchUserProfile(currentUser.id);

  if (profileRow && profileRow.profile) {
    userProfile = profileRow.profile;
    showScreen("dashboard");
    await initDashboard();
  } else {
    showScreen("onboarding");
    startOnboarding();
  }
});

/* -------------------------
   SUPABASE — PROFILO UTENTE
------------------------- */

async function fetchUserProfile(userId) {
  const { data, error } = await client
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Errore fetch profilo:", error);
    return null;
  }

  return data;
}

async function saveUserProfile(userId, profile) {
  const { error } = await client.from("profiles").upsert(
    {
      id: userId,
      profile: profile,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (error) {
    console.error("Errore salvataggio profilo:", error);
  }
}

/* -------------------------
   INIT APP
------------------------- */

async function initApp() {
  const {
    data: { session },
  } = await client.auth.getSession();

  if (session && session.user) {
    currentUser = session.user;

    const profileRow = await fetchUserProfile(currentUser.id);

    if (profileRow && profileRow.profile) {
      userProfile = profileRow.profile;
      showScreen("dashboard");
      await initDashboard();
    } else {
      showScreen("onboarding");
      startOnboarding();
    }
  } else {
    showScreen("landing");
  }
}

/* -------------------------
   LOGOUT
------------------------- */

logoutBtn.addEventListener("click", async () => {
  await client.auth.signOut();
  currentUser = null;
  userProfile = null;
  conversations = [];
  currentConversationId = null;
  messagesCache.clear();
  if (realtimeChannel) {
    realtimeChannel.unsubscribe();
    realtimeChannel = null;
  }
  chatContainer.innerHTML = "";
  conversationsList.innerHTML = "";
  showScreen("landing");
});

/* ---------------------------------------------------
   ONBOARDING
--------------------------------------------------- */

let onboardingStepIndex = 0;
let onboardingData = {
  esperienza: "",
  obiettivi: "",
  setup: "",
  problemi: "",
};

const onboardingSteps = [
  {
    id: "esperienza",
    text:
      "Ciao, sono il tuo assistente MycoManager. Per iniziare: che livello di esperienza hai con la coltivazione di funghi (es: principiante, intermedio, avanzato)?",
  },
  {
    id: "obiettivi",
    text:
      "Perfetto. Quali sono i tuoi obiettivi principali? (es: ottimizzare resa, standardizzare workflow, sviluppare nuove ricette, ecc.)",
  },
  {
    id: "setup",
    text:
      "Raccontami brevemente il tuo setup attuale: che tipo di attrezzatura e ambienti di coltivazione utilizzi?",
  },
  {
    id: "problemi",
    text:
      "Ci sono problemi ricorrenti che vuoi assolutamente risolvere (contaminazioni, resa bassa, gestione tempi, ecc.)?",
  },
];

function appendOnboardingMessage(role, text) {
  const div = document.createElement("div");
  div.classList.add("onboarding-message");
  if (role === "user") div.classList.add("user");
  div.textContent = text;
  onboardingChat.appendChild(div);
  onboardingChat.scrollTop = onboardingChat.scrollHeight;
}

function showOnboardingQuestion(index) {
  const step = onboardingSteps[index];
  if (!step) return;
  appendOnboardingMessage("assistant", step.text);
}

function startOnboarding() {
  onboardingChat.innerHTML = "";
  onboardingStepIndex = 0;
  onboardingData = {
    esperienza: "",
    obiettivi: "",
    setup: "",
    problemi: "",
  };
  goToDashboardBtn.classList.add("hidden");
  showOnboardingQuestion(onboardingStepIndex);
}

onboardingForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = onboardingInput.value.trim();
  if (!text) return;

  appendOnboardingMessage("user", text);

  const currentStep = onboardingSteps[onboardingStepIndex];
  if (currentStep) {
    onboardingData[currentStep.id] = text;
  }

  onboardingInput.value = "";
  onboardingInput.style.height = "auto";

  onboardingStepIndex++;

  if (onboardingStepIndex < onboardingSteps.length) {
    setTimeout(() => {
      showOnboardingQuestion(onboardingStepIndex);
    }, 400);
  } else {
    await finalizeOnboarding();
  }
});

async function finalizeOnboarding() {
  if (currentUser) {
    await saveUserProfile(currentUser.id, onboardingData);
    userProfile = onboardingData;
  }

  appendOnboardingMessage(
    "assistant",
    "Grazie, ho salvato il tuo profilo coltivatore. Da ora adatterò le risposte al tuo contesto.\n\nPuoi iniziare una nuova consulenza dalla dashboard."
  );

  goToDashboardBtn.classList.remove("hidden");
}

goToDashboardBtn.addEventListener("click", async () => {
  showScreen("dashboard");
  await initDashboard();
});

/* ---------------------------------------------------
   DASHBOARD — CONVERSAZIONI
--------------------------------------------------- */

async function initDashboard() {
  await loadConversationsFromSupabase();
  setupRealtime();
}

async function loadConversationsFromSupabase() {
  if (!currentUser) return;

  const { data, error } = await client
    .from("conversations")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Errore caricamento conversazioni:", error);
    return;
  }

  conversations = data || [];
  renderConversationsList();

  if (conversations.length === 0) {
    currentConversationId = null;
    chatContainer.innerHTML = "";
    currentChatEmojiEl.textContent = "🌱";
    currentChatTitleEl.textContent = "Nuova consulenza micologica";
  } else if (!currentConversationId && conversations[0]) {
    // opzionale: seleziona automaticamente l'ultima conversazione
    await selectConversation(conversations[0].id);
  }
}

function renderConversationsList() {
  conversationsList.innerHTML = "";

  if (!conversations || conversations.length === 0) {
    const empty = document.createElement("div");
    empty.classList.add("conversation-item");
    empty.innerHTML =
      '<div class="conversation-title">Nessuna conversazione</div>' +
      '<div class="conversation-preview">Crea una nuova consulenza per iniziare.</div>';
    conversationsList.appendChild(empty);
    return;
  }

  conversations.forEach((conv) => {
    const item = document.createElement("div");
    item.classList.add("conversation-item");
    if (conv.id === currentConversationId) item.classList.add("active");
    item.dataset.id = conv.id;

    const emoji = conv.emoji || "🍄";
    const title = conv.title || "Consulenza micologica";

    item.innerHTML = `
      <div class="conversation-title">
        <span>${emoji}</span>
        <span>${title}</span>
      </div>
      <div class="conversation-preview">ID: ${conv.id.slice(0, 8)}...</div>
    `;

    item.addEventListener("click", () => {
      selectConversation(conv.id);
    });

    conversationsList.appendChild(item);
  });
}

async function selectConversation(conversationId) {
  if (!conversationId) return;
  currentConversationId = conversationId;

  Array.from(conversationsList.children).forEach((child) => {
    child.classList.toggle(
      "active",
      child.dataset.id === currentConversationId
    );
  });

  const conv = conversations.find((c) => c.id === conversationId);
  if (conv) {
    currentChatEmojiEl.textContent = conv.emoji || "🍄";
    currentChatTitleEl.textContent = conv.title || "Consulenza micologica";
  }

  await loadMessagesForConversation(conversationId);
}

async function createNewConversation() {
  if (!currentUser) return;

  const { data, error } = await client
    .from("conversations")
    .insert({
      user_id: currentUser.id,
      title: "Nuova consulenza",
      emoji: "🌱",
    })
    .select()
    .single();

  if (error) {
    console.error("Errore creazione conversazione:", error);
    return null;
  }

  conversations.unshift(data);
  messagesCache.delete(data.id);
  currentConversationId = data.id;
  renderConversationsList();
  chatContainer.innerHTML = "";
  currentChatEmojiEl.textContent = data.emoji || "🌱";
  currentChatTitleEl.textContent = data.title || "Nuova consulenza micologica";

  Array.from(conversationsList.children).forEach((child) => {
    child.classList.toggle(
      "active",
      child.dataset.id === currentConversationId
    );
  });

  return data.id;
}

newChatBtn.addEventListener("click", async () => {
  await createNewConversation();
});

clearHistoryBtn.addEventListener("click", async () => {
  if (!currentUser) return;
  const confirmDelete = window.confirm(
    "Vuoi davvero eliminare tutte le tue conversazioni? L'operazione è irreversibile."
  );
  if (!confirmDelete) return;

  const { error } = await client
    .from("conversations")
    .delete()
    .eq("user_id", currentUser.id);

  if (error) {
    console.error("Errore eliminazione storico:", error);
    return;
  }

  conversations = [];
  currentConversationId = null;
  messagesCache.clear();
  renderConversationsList();
  chatContainer.innerHTML = "";
  currentChatEmojiEl.textContent = "🌱";
  currentChatTitleEl.textContent = "Nuova consulenza micologica";
});

/* ---------------------------------------------------
   DASHBOARD — MESSAGGI
--------------------------------------------------- */

async function loadMessagesForConversation(conversationId) {
  if (!conversationId) return;

  let msgs = messagesCache.get(conversationId);
  if (!msgs) {
    const { data, error } = await client
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Errore caricamento messaggi:", error);
      return;
    }

    msgs = data || [];
    messagesCache.set(conversationId, msgs);
  }

  renderMessages(msgs);
}

function renderMessages(messages) {
  chatContainer.innerHTML = "";

  messages.forEach((msg) => {
    appendChatMessage(msg.role, msg.content, false);
  });

  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function appendChatMessage(role, content, scroll = true) {
  const row = document.createElement("div");
  row.classList.add("message-row", role);

  const bubble = document.createElement("div");
  bubble.classList.add("message-bubble");

  // Converti Markdown in HTML
  const html = markdownToHtml(content);
  bubble.innerHTML = html;

  row.appendChild(bubble);
  chatContainer.appendChild(row);

  if (scroll) {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}

function markdownToHtml(md) {
  let html = md;

  // Titoli
  html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
  html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
  html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");

  // Grassetto
  html = html.replace(/\*\*(.*?)\*\*/gim, "<strong>$1</strong>");

  // Corsivo
  html = html.replace(/\*(.*?)\*/gim, "<em>$1</em>");

  // Liste
  html = html.replace(/^\s*-\s+(.*)$/gim, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>)/gims, "<ul>$1</ul>");

  // Codice inline
  html = html.replace(/`([^`]+)`/gim, "<code>$1</code>");

  // Paragrafi
  html = html.replace(/\n$/gim, "<br>");

  return html.trim();
}


async function insertMessage(conversationId, role, content) {
  const { data, error } = await client
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role,
      content,
    })
    .select()
    .single();

  if (error) {
    console.error("Errore inserimento messaggio:", error);
    return null;
  }

  let arr = messagesCache.get(conversationId) || [];
  arr = [...arr, data];
  messagesCache.set(conversationId, arr);

  return data;
}

/* ---------------------------------------------------
   WORKER CLAUDE — RISPOSTE
--------------------------------------------------- */

async function callClaude(conversationId, userText) {
  const model = modelSelect.value || "claude-3-sonnet-20240229";

  const history = messagesCache.get(conversationId) || [];
  const historyMessages = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role,
      content: m.content,
    }));

  const systemPrompt =
    "Sei MycoManager, assistente AI per coltivatori di funghi gourmet e medicinali. " +
    "Rispondi sempre in italiano, con stile chiaro, pratico e tecnico. " +
    "Puoi usare formattazione (grassetto, liste, paragrafi, emoji) come faresti normalmente. " +
    "Se mancano dettagli importanti, chiedi chiarimenti mirati. " +
    "Adatta le risposte al contesto del coltivatore (setup, obiettivi, esperienza) se disponibili dai messaggi precedenti.";

  const payload = {
    model,
    system: systemPrompt,
    messages: [
      ...historyMessages,
      { role: "user", content: userText }
    ],
    max_tokens: 1024,
    temperature: 0.7,
    stream: false
  };

  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const txt = await res.text();
      console.error("Errore worker:", res.status, txt);
      return `Errore AI (status ${res.status}).`;
    }

    const data = await res.json();
    console.log("Risposta worker (chat):", data);

    if (
      data &&
      data.content &&
      Array.isArray(data.content) &&
      data.content[0] &&
      data.content[0].text
    ) {
      return data.content[0].text;
    }

    return "Risposta AI non valida.";
  } catch (err) {
    console.error("Errore chiamata worker:", err);
    return "Errore di rete nella chiamata al modello AI.";
  }
}

/* ---------------------------------------------------
   WORKER CLAUDE — TITOLI CONVERSAZIONE
--------------------------------------------------- */

async function generateTitleWithClaude(userText) {
  const model = modelSelect.value || "claude-3-sonnet-20240229";

  const systemPrompt =
    "Sei un assistente che genera titoli sintetici per conversazioni AI. " +
    "Rispondi SEMPRE solo con il titolo, senza spiegazioni aggiuntive. " +
    "Il titolo deve essere breve (massimo 6-7 parole), chiaro e descrivere il tema principale della conversazione. " +
    "Usa uno stile simile ai titoli che vedresti in una chat AI (es: 'Vendita funghi ai ristoranti', 'Ottimizzazione LC', 'Contaminazioni da Trichoderma').";

  const prompt =
    "Genera un titolo per una conversazione basata su questo messaggio iniziale dell'utente:\n\n" +
    userText;

  const payload = {
    model,
    system: systemPrompt,
    messages: [
      { role: "user", content: prompt }
    ],
    max_tokens: 50,
    temperature: 0.5,
    stream: false
  };

  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const txt = await res.text();
      console.error("Errore worker titolo:", res.status, txt);
      return null;
    }

    const data = await res.json();
    console.log("Risposta worker (titolo):", data);

    if (
      data &&
      data.content &&
      Array.isArray(data.content) &&
      data.content[0] &&
      data.content[0].text
    ) {
      return data.content[0].text.trim();
    }

    return null;
  } catch (err) {
    console.error("Errore generazione titolo:", err);
    return null;
  }
}

/* ---------------------------------------------------
   INVIO MESSAGGI CHAT
--------------------------------------------------- */

messageForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (isSendingMessage) return;

  let text = userInput.value.trim();
  if (!text) return;

  if (!currentUser) {
    appendChatMessage(
      "assistant",
      "Devi effettuare il login per inviare messaggi.",
      true
    );
    return;
  }

  isSendingMessage = true;
  sendButton.disabled = true;

  if (!currentConversationId) {
    currentConversationId = await createNewConversation();
    if (!currentConversationId) {
      isSendingMessage = false;
      sendButton.disabled = false;
      return;
    }
  }

  const userText = text;
  userInput.value = "";
  userInput.style.height = "auto";

  appendChatMessage("user", userText, true);

  const userMsg = await insertMessage(currentConversationId, "user", userText);
  if (!userMsg) {
    isSendingMessage = false;
    sendButton.disabled = false;
    return;
  }

  // Se è il primo messaggio della conversazione, chiedi a Claude di generare un titolo automatico
  const conv = conversations.find((c) => c.id === currentConversationId);
  if (conv && (!conv.title || conv.title === "Nuova consulenza")) {
    try {
      const aiTitle = await generateTitleWithClaude(userText);
      if (aiTitle) {
        const { error } = await client
          .from("conversations")
          .update({ title: aiTitle })
          .eq("id", currentConversationId);

        if (!error) {
          conv.title = aiTitle;
          currentChatTitleEl.textContent = aiTitle;
          renderConversationsList();
        }
      }
    } catch (err) {
      console.error("Errore aggiornamento titolo conversazione:", err);
    }
  }

  const assistantText = await callClaude(currentConversationId, userText);

  appendChatMessage("assistant", assistantText, true);

  await insertMessage(currentConversationId, "assistant", assistantText);

  isSendingMessage = false;
  sendButton.disabled = false;
});

/* ---------------------------------------------------
   REALTIME INTELLIGENTE
--------------------------------------------------- */

function setupRealtime() {
  if (!currentUser) return;
  if (realtimeChannel) {
    realtimeChannel.unsubscribe();
    realtimeChannel = null;
  }

  realtimeChannel = client
    .channel("mycomanager-realtime")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "conversations",
        filter: `user_id=eq.${currentUser.id}`,
      },
      (payload) => {
        const conv = payload.new;
        conversations.unshift(conv);
        renderConversationsList();
      }
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "conversations",
        filter: `user_id=eq.${currentUser.id}`,
      },
      (payload) => {
        const updated = payload.new;
        const idx = conversations.findIndex((c) => c.id === updated.id);
        if (idx !== -1) {
          conversations[idx] = updated;
          if (currentConversationId === updated.id) {
            currentChatTitleEl.textContent = updated.title || "Consulenza micologica";
            currentChatEmojiEl.textContent = updated.emoji || "🍄";
          }
          renderConversationsList();
        }
      }
    )
    .on(
      "postgres_changes",
      {
        event: "DELETE",
        schema: "public",
        table: "conversations",
        filter: `user_id=eq.${currentUser.id}`,
      },
      (payload) => {
        const convId = payload.old.id;
        conversations = conversations.filter((c) => c.id !== convId);
        messagesCache.delete(convId);
        if (currentConversationId === convId) {
          currentConversationId = null;
          chatContainer.innerHTML = "";
          currentChatEmojiEl.textContent = "🌱";
          currentChatTitleEl.textContent = "Nuova consulenza micologica";
        }
        renderConversationsList();
      }
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
      },
      (payload) => {
        const msg = payload.new;
        const convId = msg.conversation_id;

        let arr = messagesCache.get(convId) || [];
        arr = [...arr, msg];
        messagesCache.set(convId, arr);

        if (convId === currentConversationId) {
          appendChatMessage(msg.role, msg.content, true);
        }
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.log("Realtime attivo");
      }
    });
}

/* ---------------------------------------------------
   TEXTAREA AUTOSIZE
--------------------------------------------------- */

function autoResizeTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}

userInput.addEventListener("input", () => autoResizeTextarea(userInput));
onboardingInput.addEventListener("input", () =>
  autoResizeTextarea(onboardingInput)
);

/* ---------------------------------------------------
   INIT
--------------------------------------------------- */

initApp();

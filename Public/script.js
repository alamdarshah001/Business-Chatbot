const messagesEl = document.getElementById("messages");
const form = document.getElementById("chat-form");
const input = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const suggestionsEl = document.getElementById("suggestions");

// Conversation history (sent to the server each time so the bot remembers context)
const history = [];

function addMessage(text, type) {
  const div = document.createElement("div");
  div.className = `msg ${type}`;
  div.textContent = text; // textContent (not innerHTML) = safe from HTML injection
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function showTyping() {
  const div = document.createElement("div");
  div.className = "msg bot";
  div.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

async function sendMessage(text) {
  addMessage(text, "user");
  history.push({ role: "user", text });
  suggestionsEl.style.display = "none";

  input.value = "";
  input.disabled = true;
  sendBtn.disabled = true;
  const typing = showTyping();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });
    const data = await res.json();
    typing.remove();

    if (!res.ok) {
      addMessage(data.error || "Something went wrong.", "error");
    } else {
      addMessage(data.reply, "bot");
      history.push({ role: "assistant", text: data.reply });
    }
  } catch (err) {
    typing.remove();
    addMessage("Network error. Please check your connection and try again.", "error");
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (text) sendMessage(text);
});

suggestionsEl.addEventListener("click", (e) => {
  if (e.target.tagName === "BUTTON") sendMessage(e.target.textContent);
});

// Load business name + greeting
(async function init() {
  let name = "our clinic";
  try {
    const res = await fetch("/api/info");
    const data = await res.json();
    name = data.name;
    document.getElementById("business-name").textContent = name;
    document.title = `${name} - Assistant`;
  } catch (_) {}
  addMessage(`Hello! Welcome to ${name}. How can I help you today?`, "bot");
})();
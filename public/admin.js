const $ = selector => document.querySelector(selector);
const form = $('#loginForm');
const password = $('#adminPassword');
const actions = $('#adminActions');
const message = $('#adminMessage');
let socket;

function setMessage(text, isError = false) {
  message.textContent = text;
  message.className = isError ? 'error' : 'success';
}

function connect() {
  return new Promise((resolve, reject) => {
    if (socket?.readyState === WebSocket.OPEN) return resolve();
    socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error('Serverga ulanib bo‘lmadi.'));
    socket.onmessage = event => {
      const data = JSON.parse(event.data);
      if (data.t === 'adminAuth') {
        if (!data.ok) {
          setMessage(data.msg, true);
          return;
        }
        actions.hidden = false;
        form.hidden = true;
        setMessage('Admin sifatida kirdingiz.');
      } else if (data.t === 'adminCleared') {
        setMessage('Saytdagi barcha ma’lumotlar tozalandi.');
        actions.hidden = true;
        form.hidden = false;
        password.value = '';
      } else if (data.t === 'error') {
        setMessage(data.msg, true);
      }
    };
  });
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  setMessage('');
  try {
    await connect();
    socket.send(JSON.stringify({ t: 'adminLogin', password: password.value }));
    password.value = '';
  } catch (error) {
    setMessage(error.message, true);
  }
});

$('#clearAll').addEventListener('click', () => {
  if (!window.confirm('DIQQAT: foydalanuvchilar, profillar, o‘yinlar va barcha boshqa sayt ma’lumotlari butunlay o‘chiriladi. Davom etasizmi?')) return;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    setMessage('Serverga ulanish uzilgan. Qayta kiring.', true);
    actions.hidden = true;
    form.hidden = false;
    return;
  }
  socket.send(JSON.stringify({ t: 'adminClearAll', confirm: 'CLEAR ALL DATA' }));
});

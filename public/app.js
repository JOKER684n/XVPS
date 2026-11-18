'use strict';

let csrfToken = '';
let currentUser = null;
const $ = (s) => document.querySelector(s);
const authView = $('#authView');
const appView = $('#appView');
const modal = $('#requestModal');

function showToast(message, bad) {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'toast' + (bad ? ' error' : '');
  setTimeout(() => el.classList.add('hidden'), 3600);
}
function message(el, text, bad) {
  el.textContent = text;
  el.className = 'message ' + (bad ? 'error' : 'success');
}
async function api(url, options = {}) {
  const opts = { credentials: 'same-origin', ...options, headers: { ...(options.headers || {}) } };
  if (opts.body && typeof opts.body !== 'string') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  if (opts.method && opts.method !== 'GET') opts.headers['x-songhost-csrf'] = csrfToken;
  const response = await fetch(url, opts);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'حصل خطأ غير متوقع.');
  return data;
}
function setAuthTab(tab) {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  $('#loginForm').classList.toggle('hidden', tab !== 'login');
  $('#registerForm').classList.toggle('hidden', tab !== 'register');
  $('#authTitle').textContent = tab === 'login' ? 'مرحباً بعودتك' : 'ابدأ رحلتك معانا';
  $('#authSubtitle').textContent = tab === 'login' ? 'سجّل دخولك للوصول إلى لوحة التحكم' : 'أنشئ حسابك واطلب أول سيرفر';
  $('#authMessage').classList.add('hidden');
}
document.querySelectorAll('.tab').forEach(x => x.addEventListener('click', () => setAuthTab(x.dataset.tab)));

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.currentTarget);
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: Object.fromEntries(form) });
    csrfToken = data.csrfToken;
    await loadApp(data.user);
  } catch (err) { message($('#authMessage'), err.message, true); }
});
$('#registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formElement = e.currentTarget;
  const form = new FormData(formElement);
  try {
    const data = await api('/api/auth/register', { method: 'POST', body: Object.fromEntries(form) });
    message($('#authMessage'), data.message, false);
    formElement.reset();
  } catch (err) { message($('#authMessage'), err.message, true); }
});
$('#logoutBtn').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch (_) {}
  csrfToken = ''; currentUser = null; showAuth();
});
function showAuth() {
  authView.classList.remove('hidden'); appView.classList.add('hidden'); $('#logoutBtn').classList.add('hidden');
}
async function loadApp(user) {
  currentUser = user;
  authView.classList.add('hidden'); appView.classList.remove('hidden'); $('#logoutBtn').classList.remove('hidden');
  $('#profileName').textContent = user.name;
  $('#welcomeText').textContent = 'أهلاً بيك، ' + user.name + ' — كل حاجة تخص مشاريعك في مكان واحد.';
  $('#avatarLetter').textContent = (user.name || 'S').charAt(0).toUpperCase();
  $('#profileRole').textContent = user.role === 'admin' ? 'ADMINISTRATOR' : 'USER ACCOUNT';
  $('#adminBanner').classList.toggle('hidden', user.role !== 'admin');
  $('#adminPanel').classList.toggle('hidden', user.role !== 'admin');
  await refreshDashboard();
  if (user.role === 'admin') await refreshAdmin();
}
async function refreshDashboard() {
  const data = await api('/api/dashboard');
  $('#statTotal').textContent = data.stats.requests;
  $('#statPending').textContent = data.stats.pending;
  $('#statApproved').textContent = data.stats.approved;
  const list = $('#serverList');
  if (!data.servers.length) {
    list.innerHTML = '<div class="empty-state"><span>▦</span><b>لسه مفيش طلبات</b><small>ابدأ بطلب إنشاء أول سيرفر ليك.</small></div>';
    return;
  }
  list.innerHTML = data.servers.map(s => {
    const label = s.status === 'approved' ? 'تمت الموافقة' : s.status === 'rejected' ? 'مرفوض' : 'قيد المراجعة';
    const cls = s.status === 'approved' ? 'approved' : s.status === 'rejected' ? 'rejected' : 'pending';
    const template = s.template === 'node20' ? 'Node.js 20' : s.template === 'python311' ? 'Python 3.11' : 'Static Website';
    return '<article class="server-item"><div class="server-symbol">⌘</div><div class="server-info"><b>' + escapeHtml(s.name) + '</b><small>' + template + ' · ' + s.ram_mb + ' MB RAM · ' + s.cpu_units + ' CPU</small>' + (s.admin_note ? '<small class="admin-note">ملاحظة الإدارة: ' + escapeHtml(s.admin_note) + '</small>' : '') + '</div><span class="badge ' + cls + '">' + label + '</span></article>';
  }).join('');
}
async function refreshAdmin() {
  const data = await api('/api/admin/overview');
  const c = data.counts;
  $('#adminCounts').innerHTML = [['المستخدمين',c.users],['حسابات تنتظر التفعيل',c.pendingUsers],['طلبات السيرفرات',c.requests],['طلبات تنتظر المراجعة',c.pendingRequests]].map(x => '<div class="admin-count"><small>' + x[0] + '</small><b>' + x[1] + '</b></div>').join('');
  const req = $('#adminRequests');
  req.innerHTML = data.requests.length ? data.requests.map(r => {
    const pending = r.status === 'pending';
    return '<article class="review-row"><div class="review-main"><b>' + escapeHtml(r.name) + '</b><small>' + escapeHtml(r.user_name) + ' · ' + escapeHtml(r.user_email) + ' · ' + r.template + ' · ' + r.ram_mb + ' MB</small><small>' + escapeHtml(r.note || 'بدون ملاحظات') + '</small></div><span class="badge ' + (pending ? 'pending' : r.status) + '">' + (pending ? 'قيد المراجعة' : r.status === 'approved' ? 'مقبول' : 'مرفوض') + '</span>' + (pending ? '<div class="review-actions"><input class="admin-note-input" id="note-' + r.id + '" placeholder="ملاحظة (اختياري)"><button class="btn btn-small btn-primary" data-review="approved" data-id="' + r.id + '">موافقة</button><button class="btn btn-small btn-danger" data-review="rejected" data-id="' + r.id + '">رفض</button></div>' : '') + '</article>';
  }).join('') : '<div class="empty-state compact">مفيش طلبات حالياً.</div>';
  const users = data.users.filter(u => u.status === 'pending');
  $('#adminUsers').innerHTML = users.length ? users.map(u => '<article class="review-row"><div class="review-main"><b>' + escapeHtml(u.name) + '</b><small>' + escapeHtml(u.email) + '</small></div><span class="badge pending">محتاج تفعيل</span><button class="btn btn-small btn-primary" data-user-approve="' + u.id + '">تفعيل الحساب</button></article>').join('') : '<div class="empty-state compact">مفيش حسابات مستنية التفعيل.</div>';
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
$('#adminPanel').addEventListener('click', async (e) => {
  const review = e.target.closest('[data-review]');
  const approve = e.target.closest('[data-user-approve]');
  try {
    if (review) {
      const id = review.dataset.id;
      const note = $('#note-' + id)?.value || '';
      const data = await api('/api/admin/requests/' + id + '/review', { method: 'POST', body: { decision: review.dataset.review, note } });
      showToast(data.message); await refreshAdmin(); await refreshDashboard();
    }
    if (approve) {
      await api('/api/admin/users/' + approve.dataset.userApprove + '/approve', { method: 'POST', body: {} });
      showToast('تم تفعيل الحساب.'); await refreshAdmin();
    }
  } catch (err) { showToast(err.message, true); }
});
$('#openRequest').addEventListener('click', () => { modal.classList.remove('hidden'); $('#requestMessage').classList.add('hidden'); });
$('#closeModal').addEventListener('click', () => modal.classList.add('hidden'));
modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
$('#requestForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formElement = e.currentTarget;
  const form = new FormData(formElement);
  const values = Object.fromEntries(form);
  values.ram = Number(values.ram); values.cpu = Number(values.cpu);
  try {
    const data = await api('/api/servers/request', { method: 'POST', body: values });
    message($('#requestMessage'), data.message, false);
    formElement.reset(); await refreshDashboard();
    if (currentUser && currentUser.role === 'admin') await refreshAdmin();
  } catch (err) { message($('#requestMessage'), err.message, true); }
});
async function init() {
  try {
    const data = await api('/api/me');
    csrfToken = data.csrfToken || '';
    if (data.user) await loadApp(data.user);
  } catch (err) { showAuth(); }
}
init();

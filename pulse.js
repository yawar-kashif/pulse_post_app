const SUPABASE_URL = 'https://qrxikehgxhlbzbjidqll.supabase.co';           // e.g. https://xyzcompany.supabase.co
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFyeGlrZWhneGhsYnpiamlkcWxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMTM4MTIsImV4cCI6MjA5NjY4OTgxMn0._eIOIUFvrJKu2ZypeiI0OmsmwB63LV3McZTlgu61lOs'; // e.g. eyJhbGciOiJIUzI1NiIsInR5cCI6...
// ================================================================

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ================================================================
//  STATE
// ================================================================
let currentUser = null;
let currentProfile = null;
let currentView = 'feed';
let editingPostId = null;
let deletingPostId = null;
let composeImageFile = null;
let composeImageDataUrl = null;
let searchTimeout = null;
let realtimeChannel = null;

// ================================================================
//  INIT
// ================================================================
(async () => {
  // Check for password reset token in URL
  const hash = window.location.hash;
  if (hash.includes('type=recovery')) {
    showPage('auth');
    showResetForm();
    return;
  }

  const { data: { session } } = await db.auth.getSession();
  if (session) {
    await initApp(session.user);
  } else {
    showPage('auth');
  }

  db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      await initApp(session.user);
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      currentProfile = null;
      teardownRealtime();
      showPage('auth');
    } else if (event === 'PASSWORD_RECOVERY') {
      showPage('auth');
      showResetForm();
    }
  });
})();

async function initApp(user) {
  currentUser = user;
  await loadProfile(user.id);
  showPage('app');
  renderSidebarUser();
  renderComposeAvatar();
  loadFeed();
  loadSuggestions();
  setupRealtime();
}

// ================================================================
//  PAGE / VIEW ROUTING
// ================================================================
function showPage(p) {
  document.getElementById('page-auth').classList.toggle('active', p === 'auth');
  document.getElementById('page-app').classList.toggle('active', p === 'app');
}

function showView(view, param) {
  const views = ['feed', 'search', 'dashboard', 'profile', 'post-detail', 'settings'];
  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.style.display = v === view ? 'block' : 'none';
  });
  currentView = view;

  // Update nav active states
  ['feed','search','dashboard','profile','settings'].forEach(v => {
    const btn = document.getElementById(`nav-${v}`);
    if (btn) btn.classList.toggle('active', v === view);
    const mob = document.getElementById(`mob-nav-${v}`);
    if (mob) mob.classList.toggle('active', v === view);
  });

  if (view === 'feed') { loadFeed(); }
  else if (view === 'profile') { renderProfileView(param || currentUser?.id); }
  else if (view === 'dashboard') { renderDashboard(); }
  else if (view === 'settings') { renderSettings(); }
  else if (view === 'search') { document.getElementById('search-input')?.focus(); }

  // Scroll to top
  document.getElementById('main-content').scrollTop = 0;
}

// ================================================================
//  AUTH HELPERS
// ================================================================
function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t, i) => {
    t.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'register'));
  });
  document.getElementById('auth-form-login').classList.toggle('active', tab === 'login');
  document.getElementById('auth-form-register').classList.toggle('active', tab === 'register');
  document.getElementById('auth-form-forgot').classList.remove('active');
  document.getElementById('auth-form-reset').classList.remove('active');
}

function showForgotPassword() {
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  document.getElementById('auth-form-forgot').classList.add('active');
}

function showLoginForm() {
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  document.getElementById('auth-form-login').classList.add('active');
}

function showResetForm() {
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  document.getElementById('auth-form-reset').classList.add('active');
}

function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  input.type = input.type === 'password' ? 'text' : 'password';
}

// ================================================================
//  AUTH HANDLERS
// ================================================================
async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  clearErrors();

  if (!email) return showError('login-email-err', 'Email is required');
  if (!password) return showError('login-pass-err', 'Password is required');

  setLoading('btn-login', true);
  const { error } = await db.auth.signInWithPassword({ email, password });
  setLoading('btn-login', false);

  if (error) {
    showToast('error', 'Sign in failed', error.message);
    showError('login-pass-err', 'Invalid email or password');
  }
}

async function handleRegister() {
  const name = document.getElementById('reg-name').value.trim();
  const username = document.getElementById('reg-username').value.trim().toLowerCase();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  clearErrors();

//   const { error } = await supabase.from('profiles').insert({ email, username }).select('id').single();
// if (error) console.error(error)



  if (!name) return showError('reg-name-err', 'Full name is required');
  if (!username) return showError('reg-username-err', 'Username is required');
  if (username.length < 3) return showError('reg-username-err', 'Username must be at least 3 characters');
  if (!/^[a-z0-9_]+$/.test(username)) return showError('reg-username-err', 'Only letters, numbers, and underscores');
  if (!email) return showError('reg-email-err', 'Email is required');
  if (password.length < 5) return showError('reg-pass-err', 'Password must be at least 5  characters');

  setLoading('btn-register', true);

  // Check username availability
  const { data: existing } = await db.from('profiles').select('id').eq('username', username).single();
  if (existing) {
    setLoading('btn-register', false);
    return showError('reg-username-err', 'Username is taken');
  }

  const { data, error } = await db.auth.signUp({
    email, password,
    
    options: { data: { full_name: name, username,email }   }
  });
  setLoading('btn-register', false);

  if (error) {
    showToast('error', 'Registration failed', error.message);
  } else {
    // Create profile
   if (data.user && data.session) {
  await db.from('profiles').upsert({
    id: data.user.id,
    email: data.user.email,
    username,
    full_name: name,
    created_at: new Date().toISOString()
  });
}
    showToast('success', 'Welcome to Pulse!', 'Your account has been created.');
  }

  const { error: profileError } = await db
  .from('profiles')
  .upsert({
    id: data.user.id,
    email: data.user.email,
    username,
    full_name: name,
    created_at: new Date().toISOString()
  });

console.log(profileError);
console.log(data.user);
console.log(data.session);
}



async function handleForgotPassword() {
  const email = document.getElementById('forgot-email').value.trim();
  if (!email) return showError('forgot-err', 'Email is required');

  setLoading('btn-forgot', true);
  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname + '#type=recovery'
  });
  setLoading('btn-forgot', false);

  if (error) {
    showToast('error', 'Failed', error.message);
  } else {
    showToast('success', 'Reset link sent', 'Check your email inbox.');
    showLoginForm();
  }
}

async function handleResetPassword() {
  const password = document.getElementById('reset-password').value;
  const confirm = document.getElementById('reset-confirm').value;
  clearErrors();

  if (password.length < 8) return showError('reset-pass-err', 'Must be at least 8 characters');
  if (password !== confirm) return showError('reset-confirm-err', 'Passwords do not match');

  setLoading('btn-reset', true);
  const { error } = await db.auth.updateUser({ password });
  setLoading('btn-reset', false);

  if (error) {
    showToast('error', 'Failed', error.message);
  } else {
    showToast('success', 'Password updated!', 'You can now sign in with your new password.');
    window.location.hash = '';
    showLoginForm();
  }
}

async function handleLogout() {
  await db.auth.signOut();
}

// ================================================================
//  PROFILE
// ================================================================
async function loadProfile(userId) {
  const { data } = await db.from('profiles').select('*').eq('id', userId).single();
  if (data) {
    currentProfile = data;
  } else {
    // Create profile if missing
    const meta = currentUser.user_metadata || {};
    const profile = {
      id: userId,
      username: meta.username || 'user_' + userId.slice(0,8),
      full_name: meta.full_name || '',
      bio: '',
      avatar_url: '',
      created_at: new Date().toISOString()
    };
    await db.from('profiles').upsert(profile);
    currentProfile = profile;
  }
}

function renderSidebarUser() {
  if (!currentProfile) return;
  document.getElementById('sidebar-name').textContent = currentProfile.full_name || currentProfile.username;
  document.getElementById('sidebar-handle').textContent = '@' + currentProfile.username;
  setAvatarEl(document.getElementById('sidebar-avatar'), currentProfile, 'sm');
}

function renderComposeAvatar() {
  setAvatarEl(document.getElementById('compose-avatar'), currentProfile, 'md');
}

function setAvatarEl(el, profile, size) {
  if (!el || !profile) return;
  el.innerHTML = '';
  el.className = `avatar avatar-${size}`;
  if (profile.avatar_url) {
    const img = document.createElement('img');
    img.src = profile.avatar_url;
    img.alt = profile.full_name || profile.username;
    img.onerror = () => setAvatarEl(el, {...profile, avatar_url: null}, size);
    el.appendChild(img);
  } else {
    const initials = getInitials(profile.full_name || profile.username);
    el.textContent = initials;
  }
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();
}

function getAvatarHtml(profile, size = 'md') {
  if (!profile) return `<div class="avatar avatar-${size}">?</div>`;
  if (profile.avatar_url) {
    return `<div class="avatar avatar-${size}"><img src="${esc(profile.avatar_url)}" alt="${esc(profile.full_name||profile.username)}" onerror="this.parentElement.textContent='${esc(getInitials(profile.full_name||profile.username))}'" /></div>`;
  }
  return `<div class="avatar avatar-${size}" style="background:var(--surface-3);color:var(--accent-2);">${esc(getInitials(profile.full_name||profile.username))}</div>`;
}

// ================================================================
//  FEED
// ================================================================
async function loadFeed() {
  const list = document.getElementById('posts-list');
  list.innerHTML = skeletonPosts(5);

  const { data: posts, error } = await db
    .from('posts')
    .select(`*, profiles(id, username, full_name, avatar_url)`)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    list.innerHTML = errorState('Failed to load posts');
    return;
  }

  if (!posts || posts.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
      <div class="empty-title">Nothing here yet</div>
      <div class="empty-desc">Be the first to post something on Pulse</div>
    </div>`;
    return;
  }

  // Get likes for current user
  const postIds = posts.map(p => p.id);
  const { data: likes } = await db.from('likes').select('post_id').eq('user_id', currentUser.id).in('post_id', postIds);
  const likedSet = new Set((likes || []).map(l => l.post_id));

  // Get like counts
  const { data: likeCounts } = await db.from('likes').select('post_id').in('post_id', postIds);
  const likeCountMap = {};
  (likeCounts || []).forEach(l => { likeCountMap[l.post_id] = (likeCountMap[l.post_id] || 0) + 1; });

  // Get comment counts
  const { data: commentCounts } = await db.from('comments').select('post_id').in('post_id', postIds);
  const commentCountMap = {};
  (commentCounts || []).forEach(c => { commentCountMap[c.post_id] = (commentCountMap[c.post_id] || 0) + 1; });

  list.innerHTML = posts.map(p => renderPostCard(p, likedSet.has(p.id), likeCountMap[p.id] || 0, commentCountMap[p.id] || 0)).join('');
}

function renderPostCard(post, liked, likeCount, commentCount, expanded = false) {
  const profile = post.profiles || {};
  const isOwn = post.user_id === currentUser?.id;
  const timeAgo = formatTime(post.created_at);
  const content = linkify(esc(post.content || ''));

  return `
  <div class="post-card${expanded ? ' post-expand' : ''}" id="post-${post.id}" onclick="handlePostClick(event, '${post.id}')">
    <div onclick="event.stopPropagation(); showView('profile', '${post.user_id}')" style="cursor:pointer;">
      ${getAvatarHtml(profile, 'md')}
    </div>
    <div class="post-body">
      <div class="post-header">
        <div class="post-meta">
          <span class="post-author" onclick="event.stopPropagation(); showView('profile', '${post.user_id}')">${esc(profile.full_name || profile.username || 'Unknown')}</span>
          <span class="post-handle">@${esc(profile.username || 'unknown')}</span>
          <span class="post-dot">·</span>
          <span class="post-time" title="${new Date(post.created_at).toLocaleString()}">${timeAgo}</span>
        </div>
        <div class="post-menu">
          <div class="post-menu-btn" onclick="event.stopPropagation(); togglePostMenu('menu-${post.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          </div>
          <div class="dropdown" id="menu-${post.id}" style="display:none;" onclick="event.stopPropagation()">
            <div class="dropdown-item" onclick="copyPostLink('${post.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              Copy link
            </div>
            ${isOwn ? `
            <div class="dropdown-divider"></div>
            <div class="dropdown-item" onclick="openEditPost('${post.id}', ${JSON.stringify(post.content).replace(/"/g,"'")})">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit post
            </div>
            <div class="dropdown-item danger" onclick="openDeletePost('${post.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              Delete post
            </div>
            ` : ''}
          </div>
        </div>
      </div>
      <div class="post-content">${content}</div>
      ${post.image_url ? `<div class="post-image"><img src="${esc(post.image_url)}" alt="Post image" loading="lazy" onclick="event.stopPropagation()" /></div>` : ''}
      <div class="post-actions" onclick="event.stopPropagation()">
        <div class="post-action-btn comment" onclick="openPostDetail('${post.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span id="comment-count-${post.id}">${commentCount > 0 ? commentCount : ''}</span>
        </div>
        <div class="post-action-btn like ${liked ? 'active' : ''}" id="like-btn-${post.id}" onclick="toggleLike('${post.id}', ${liked})">
          <svg viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          <span id="like-count-${post.id}">${likeCount > 0 ? likeCount : ''}</span>
        </div>
        <div class="post-action-btn share" onclick="sharePost('${post.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        </div>
      </div>
    </div>
  </div>`;
}

// ================================================================
//  COMPOSE
// ================================================================
function onComposeInput(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
  const len = el.value.length;
  const counter = document.getElementById('char-count');
  counter.textContent = 280 - len;
  counter.className = 'char-counter' + (len > 260 ? ' warn' : '') + (len > 280 ? ' over' : '');
  document.getElementById('btn-post').disabled = len === 0 || len > 280;
}

function composeKeydown(e) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handlePost();
}

function onComposeImageSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    showToast('error', 'Image too large', 'Maximum size is 5MB');
    return;
  }
  composeImageFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    composeImageDataUrl = e.target.result;
    document.getElementById('compose-img-tag').src = composeImageDataUrl;
    document.getElementById('compose-img-preview').style.display = 'inline-block';
  };
  reader.readAsDataURL(file);
}

function removeComposeImage() {
  composeImageFile = null;
  composeImageDataUrl = null;
  document.getElementById('compose-img-preview').style.display = 'none';
  document.getElementById('compose-img-tag').src = '';
  document.getElementById('compose-file-input').value = '';
}

async function handlePost() {
  const text = document.getElementById('compose-text').value.trim();
  if (!text && !composeImageFile) return;
  if (text.length > 280) return;

  setLoading('btn-post', true);

  let image_url = null;
  if (composeImageFile) {
    const ext = composeImageFile.name.split('.').pop();
    const path = `posts/${currentUser.id}/${Date.now()}.${ext}`;
    const { data: upData, error: upErr } = await db.storage.from('post-images').upload(path, composeImageFile);
    if (upErr) {
      setLoading('btn-post', false);
      showToast('error', 'Upload failed', upErr.message);
      return;
    }
    const { data: urlData } = db.storage.from('post-images').getPublicUrl(path);
    image_url = urlData.publicUrl;
  }

  const { error } = await db.from('posts').insert({
    user_id: currentUser.id,
    content: text,
    image_url,
    created_at: new Date().toISOString()
  });

  setLoading('btn-post', false);

  if (error) {
    showToast('error', 'Post failed', error.message);
  } else {
    document.getElementById('compose-text').value = '';
    document.getElementById('compose-text').style.height = 'auto';
    document.getElementById('char-count').textContent = '280';
    removeComposeImage();
    showToast('success', 'Posted!', 'Your post is live.');
    loadFeed();
  }
}

// ================================================================
//  LIKES
// ================================================================
async function toggleLike(postId, isLiked) {
  const btn = document.getElementById(`like-btn-${postId}`);
  const countEl = document.getElementById(`like-count-${postId}`);
  const currentCount = parseInt(countEl.textContent) || 0;

  // Optimistic update
  btn.classList.toggle('active', !isLiked);
  const svg = btn.querySelector('svg');
  svg.setAttribute('fill', !isLiked ? 'currentColor' : 'none');
  countEl.textContent = (!isLiked ? currentCount + 1 : Math.max(0, currentCount - 1)) || '';

  if (!isLiked) {
    btn.classList.add('beat');
    setTimeout(() => btn.classList.remove('beat'), 400);
    await db.from('likes').insert({ post_id: postId, user_id: currentUser.id });
  } else {
    await db.from('likes').delete().eq('post_id', postId).eq('user_id', currentUser.id);
  }

  // Update onclick to flip state
  btn.setAttribute('onclick', `toggleLike('${postId}', ${!isLiked})`);
}

// ================================================================
//  POST DETAIL + COMMENTS
// ================================================================
async function openPostDetail(postId) {
  showView('post-detail');
  const container = document.getElementById('post-detail-content');
  container.innerHTML = `<div class="loading-center"><div class="spinner spinner-lg"></div></div>`;

  const { data: post } = await db
    .from('posts')
    .select('*, profiles(id, username, full_name, avatar_url)')
    .eq('id', postId)
    .single();

  if (!post) {
    container.innerHTML = errorState('Post not found');
    return;
  }

  const { data: likes } = await db.from('likes').select('post_id').eq('user_id', currentUser.id).eq('post_id', postId);
  const { data: likeCountData } = await db.from('likes').select('id').eq('post_id', postId);
  const { data: comments } = await db
    .from('comments')
    .select('*, profiles(id, username, full_name, avatar_url)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  const liked = !!(likes && likes.length);
  const likeCount = likeCountData?.length || 0;
  const commentCount = comments?.length || 0;

  container.innerHTML = `
    <div class="back-btn" onclick="showView('feed')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
      Back
    </div>
    ${renderPostCard(post, liked, likeCount, commentCount, true)}
    <div class="comments-section">
      <div class="comment-compose">
        ${getAvatarHtml(currentProfile, 'sm')}
        <div class="comment-input-wrap">
          <input class="comment-input" type="text" placeholder="Write a comment…" id="comment-input-${postId}" onkeydown="commentKeydown(event, '${postId}')" maxlength="500" />
          <div class="comment-send" onclick="postComment('${postId}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </div>
        </div>
      </div>
      <div class="comment-list" id="comment-list-${postId}">
        ${comments && comments.length ? comments.map(c => renderComment(c)).join('') : `
          <div class="empty-state" style="padding:32px 24px;">
            <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
            <div class="empty-title">No comments yet</div>
            <div class="empty-desc">Be the first to comment</div>
          </div>`}
      </div>
    </div>
  `;
}

function renderComment(comment) {
  const isOwn = comment.user_id === currentUser?.id;
  const profile = comment.profiles || {};
  return `
  <div class="comment-item fade-in-up" id="comment-${comment.id}">
    ${getAvatarHtml(profile, 'xs')}
    <div class="comment-body">
      <div class="comment-header">
        <span class="comment-author">${esc(profile.full_name || profile.username || 'Unknown')}</span>
        <span class="comment-time">@${esc(profile.username || '')} · ${formatTime(comment.created_at)}</span>
      </div>
      <div class="comment-text">${esc(comment.content)}</div>
    </div>
    ${isOwn ? `<div class="comment-delete" onclick="deleteComment('${comment.id}', '${comment.post_id}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
    </div>` : ''}
  </div>`;
}

function commentKeydown(e, postId) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); postComment(postId); }
}

async function postComment(postId) {
  const input = document.getElementById(`comment-input-${postId}`);
  const text = input.value.trim();
  if (!text) return;

  const { data, error } = await db.from('comments').insert({
    post_id: postId,
    user_id: currentUser.id,
    content: text,
    created_at: new Date().toISOString()
  }).select('*, profiles(id, username, full_name, avatar_url)').single();

  if (error) { showToast('error', 'Failed', error.message); return; }

  input.value = '';
  const list = document.getElementById(`comment-list-${postId}`);
  if (list.querySelector('.empty-state')) list.innerHTML = '';
  list.insertAdjacentHTML('beforeend', renderComment(data));

  // Update comment count in feed
  const countEl = document.getElementById(`comment-count-${postId}`);
  if (countEl) countEl.textContent = parseInt(countEl.textContent || '0') + 1 || 1;
}

async function deleteComment(commentId, postId) {
  await db.from('comments').delete().eq('id', commentId);
  const el = document.getElementById(`comment-${commentId}`);
  if (el) { el.style.opacity = '0'; el.style.transform = 'scale(0.95)'; setTimeout(() => el.remove(), 200); }
  const countEl = document.getElementById(`comment-count-${postId}`);
  if (countEl) { const c = Math.max(0, parseInt(countEl.textContent || '0') - 1); countEl.textContent = c || ''; }
}

// ================================================================
//  EDIT / DELETE POSTS
// ================================================================
function handlePostClick(event, postId) {
  if (event.target.closest('.post-action-btn') || event.target.closest('.post-menu') || event.target.closest('.dropdown') || event.target.closest('.post-image img') || event.target.closest('.post-author')) return;
  openPostDetail(postId);
}

function togglePostMenu(menuId) {
  // Close all other menus
  document.querySelectorAll('.dropdown').forEach(d => { if ('menu-' + d.id !== menuId) d.style.display = 'none'; });
  const menu = document.getElementById(menuId);
  if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  // Close on outside click
  if (menu && menu.style.display === 'block') {
    setTimeout(() => {
      document.addEventListener('click', function closeMenu(e) {
        if (!menu.contains(e.target)) { menu.style.display = 'none'; document.removeEventListener('click', closeMenu); }
      });
    }, 10);
  }
}

function openEditPost(postId, content) {
  editingPostId = postId;
  document.getElementById('edit-post-text').value = content;
  document.getElementById('edit-post-err').classList.remove('visible');
  openModal('modal-edit-post');
}

async function saveEditPost() {
  const text = document.getElementById('edit-post-text').value.trim();
  if (!text) { showError('edit-post-err', 'Post cannot be empty'); return; }
  if (text.length > 280) { showError('edit-post-err', 'Post is too long'); return; }

  setLoading('btn-edit-save', true);
  const { error } = await db.from('posts').update({ content: text, edited: true }).eq('id', editingPostId);
  setLoading('btn-edit-save', false);

  if (error) { showToast('error', 'Failed', error.message); return; }
  closeModal('modal-edit-post');
  showToast('success', 'Post updated');
  loadFeed();
}

function openDeletePost(postId) {
  deletingPostId = postId;
  openModal('modal-confirm-delete');
}

async function confirmDeletePost() {
  if (!deletingPostId) return;
  setLoading('btn-confirm-delete', true);

  // Delete post image if any
  const { data: post } = await db.from('posts').select('image_url').eq('id', deletingPostId).single();
  if (post?.image_url) {
    const path = post.image_url.split('/post-images/')[1];
    if (path) await db.storage.from('post-images').remove([path]);
  }

  await db.from('comments').delete().eq('post_id', deletingPostId);
  await db.from('likes').delete().eq('post_id', deletingPostId);
  const { error } = await db.from('posts').delete().eq('id', deletingPostId);

  setLoading('btn-confirm-delete', false);
  if (error) { showToast('error', 'Failed', error.message); return; }
  closeModal('modal-confirm-delete');
  showToast('success', 'Post deleted');

  const el = document.getElementById(`post-${deletingPostId}`);
  if (el) { el.style.opacity = '0'; el.style.transform = 'translateX(-10px)'; setTimeout(() => el.remove(), 300); }
  deletingPostId = null;
}

function copyPostLink(postId) {
  navigator.clipboard.writeText(window.location.href + '#post-' + postId);
  showToast('success', 'Link copied');
}

function sharePost(postId) {
  if (navigator.share) {
    navigator.share({ url: window.location.href + '#post-' + postId });
  } else {
    copyPostLink(postId);
  }
}

// ================================================================
//  PROFILE VIEW
// ================================================================
async function renderProfileView(userId) {
  const container = document.getElementById('profile-content');
  container.innerHTML = `<div class="loading-center"><div class="spinner spinner-lg"></div></div>`;

  const { data: profile } = await db.from('profiles').select('*').eq('id', userId).single();
  if (!profile) { container.innerHTML = errorState('Profile not found'); return; }

  const { data: posts } = await db
    .from('posts')
    .select('*, profiles(id, username, full_name, avatar_url)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  const { data: likeCount } = await db.from('likes').select('id', { count: 'exact' }).eq('user_id', userId);

  const isOwnProfile = userId === currentUser?.id;
  const postIds = (posts || []).map(p => p.id);
  let likedSet = new Set(), likeMap = {}, commentMap = {};

  if (postIds.length) {
    const { data: myLikes } = await db.from('likes').select('post_id').eq('user_id', currentUser.id).in('post_id', postIds);
    likedSet = new Set((myLikes || []).map(l => l.post_id));
    const { data: lc } = await db.from('likes').select('post_id').in('post_id', postIds);
    (lc || []).forEach(l => { likeMap[l.post_id] = (likeMap[l.post_id] || 0) + 1; });
    const { data: cc } = await db.from('comments').select('post_id').in('post_id', postIds);
    (cc || []).forEach(c => { commentMap[c.post_id] = (commentMap[c.post_id] || 0) + 1; });
  }

  container.innerHTML = `
    <div class="profile-banner"></div>
    <div class="profile-info-area">
      <div class="profile-avatar-wrap">
        ${isOwnProfile ? `
          <label class="avatar-upload-wrap avatar-ring" for="profile-avatar-input-inline" style="cursor:pointer;display:inline-block;border-radius:50%;">
            ${getAvatarHtml(profile, 'xl')}
            <div class="avatar-upload-overlay">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
            </div>
            <input type="file" id="profile-avatar-input-inline" accept="image/*" style="display:none;" onchange="onAvatarSelect(event)" />
          </label>` : getAvatarHtml(profile, 'xl')}
        <div style="margin-left:auto;">
          ${isOwnProfile ? `
            <button class="btn btn-ghost" onclick="openEditProfile()">
              <svg style="width:15px;height:15px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit profile
            </button>` : `<button class="follow-btn not-following" id="follow-btn-${userId}" onclick="toggleFollow('${userId}')">Follow</button>`}
        </div>
      </div>
      <div class="profile-name">${esc(profile.full_name || profile.username)}</div>
      <div class="profile-handle">@${esc(profile.username)}</div>
      ${profile.bio ? `<div class="profile-bio">${esc(profile.bio)}</div>` : ''}
      <div class="profile-stats">
        <div class="profile-stat">
          <div class="profile-stat-count">${posts?.length || 0}</div>
          <div class="profile-stat-label">Posts</div>
        </div>
        <div class="profile-stat">
          <div class="profile-stat-count">${likeCount?.length || 0}</div>
          <div class="profile-stat-label">Likes given</div>
        </div>
      </div>
    </div>
    <div class="profile-tab-bar">
      <div class="profile-tab active">Posts</div>
    </div>
    <div id="profile-posts">
      ${posts && posts.length ? posts.map(p => renderPostCard(p, likedSet.has(p.id), likeMap[p.id] || 0, commentMap[p.id] || 0)).join('') : `
        <div class="empty-state">
          <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
          <div class="empty-title">No posts yet</div>
          <div class="empty-desc">${isOwnProfile ? 'Share your first post' : 'Nothing here yet'}</div>
        </div>`}
    </div>
  `;
}

// ================================================================
//  EDIT PROFILE
// ================================================================
function openEditProfile() {
  document.getElementById('edit-full-name').value = currentProfile.full_name || '';
  document.getElementById('edit-username').value = currentProfile.username || '';
  document.getElementById('edit-bio').value = currentProfile.bio || '';
  clearErrors();
  // Set avatar preview
  const avatarEl = document.getElementById('edit-profile-avatar');
  setAvatarEl(avatarEl, currentProfile, '2xl');
  openModal('modal-edit-profile');
}

var newAvatarFile = null;

async function onAvatarSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 3 * 1024 * 1024) { showToast('error', 'Too large', 'Max 3MB'); return; }
  newAvatarFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    const editEl = document.getElementById('edit-profile-avatar');
    if (editEl) { editEl.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;" />`; }
  };
  reader.readAsDataURL(file);
  // If invoked from inline upload (profile page), open edit modal
  const modal = document.getElementById('modal-edit-profile');
  if (modal.style.display === 'none') { openEditProfile(); }
}

async function saveProfile() {
  const fullName = document.getElementById('edit-full-name').value.trim();
  const username = document.getElementById('edit-username').value.trim().toLowerCase();
  const bio = document.getElementById('edit-bio').value.trim();
  clearErrors();

  if (!fullName) return showError('edit-name-err', 'Name is required');
  if (!username) return showError('edit-username-err', 'Username is required');
  if (username.length < 3) return showError('edit-username-err', 'At least 3 characters');
  if (!/^[a-z0-9_]+$/.test(username)) return showError('edit-username-err', 'Letters, numbers, underscores only');

  // Check username uniqueness
  if (username !== currentProfile.username) {
    const { data } = await db.from('profiles').select('id').eq('username', username).neq('id', currentUser.id).single();
    if (data) return showError('edit-username-err', 'Username is taken');
  }

  setLoading('btn-save-profile', true);

  let avatar_url = currentProfile.avatar_url;

  if (newAvatarFile) {
    const ext = newAvatarFile.name.split('.').pop();
    const path = `avatars/${currentUser.id}.${ext}`;
    const { error: upErr } = await db.storage.from('avatars').upload(path, newAvatarFile, { upsert: true });
    if (upErr) {
      setLoading('btn-save-profile', false);
      showToast('error', 'Upload failed', upErr.message);
      return;
    }
    const { data: urlData } = db.storage.from('avatars').getPublicUrl(path);
    avatar_url = urlData.publicUrl + '?t=' + Date.now();
    newAvatarFile = null;
  }

  const { error } = await db.from('profiles').update({ full_name: fullName, username, bio, avatar_url }).eq('id', currentUser.id);
  setLoading('btn-save-profile', false);

  if (error) { showToast('error', 'Save failed', error.message); return; }
  currentProfile = { ...currentProfile, full_name: fullName, username, bio, avatar_url };
  closeModal('modal-edit-profile');
  showToast('success', 'Profile saved!');
  renderSidebarUser();
  renderComposeAvatar();
  renderProfileView(currentUser.id);
}

// ================================================================
//  SEARCH
// ================================================================
function handleSearch(query) {
  clearTimeout(searchTimeout);
  if (!query.trim()) {
    document.getElementById('search-results-container').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></div>
        <div class="empty-title">Search Pulse</div>
        <div class="empty-desc">Find people and posts by typing above</div>
      </div>`;
    return;
  }
  document.getElementById('search-results-container').innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
  searchTimeout = setTimeout(() => performSearch(query.trim()), 350);
}

async function performSearch(query) {
  const [{ data: users }, { data: posts }] = await Promise.all([
    db.from('profiles').select('*').or(`username.ilike.%${query}%,full_name.ilike.%${query}%`).limit(5),
    db.from('posts').select('*, profiles(id, username, full_name, avatar_url)').ilike('content', `%${query}%`).order('created_at', { ascending: false }).limit(10)
  ]);

  const container = document.getElementById('search-results-container');
  let html = '';

  if ((!users || !users.length) && (!posts || !posts.length)) {
    html = `<div class="empty-state">
      <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></div>
      <div class="empty-title">No results for "${esc(query)}"</div>
      <div class="empty-desc">Try different keywords or check spelling</div>
    </div>`;
  } else {
    if (users && users.length) {
      html += `<div class="search-result-section"><div class="search-result-section-title">People</div>`;
      html += users.map(u => `
        <div class="user-result-card" onclick="showView('profile', '${u.id}')">
          ${getAvatarHtml(u, 'md')}
          <div class="user-result-info">
            <div class="user-result-name">${esc(u.full_name || u.username)}</div>
            <div class="user-result-handle">@${esc(u.username)}</div>
            ${u.bio ? `<div class="user-result-bio">${esc(u.bio)}</div>` : ''}
          </div>
        </div>`).join('');
      html += `</div>`;
    }
    if (posts && posts.length) {
      const postIds = posts.map(p => p.id);
      const { data: lc } = await db.from('likes').select('post_id').in('post_id', postIds);
      const likeMap = {}; (lc || []).forEach(l => { likeMap[l.post_id] = (likeMap[l.post_id] || 0) + 1; });
      const { data: myLikes } = await db.from('likes').select('post_id').eq('user_id', currentUser.id).in('post_id', postIds);
      const likedSet = new Set((myLikes || []).map(l => l.post_id));

      html += `<div class="search-result-section"><div class="search-result-section-title">Posts</div>`;
      html += posts.map(p => renderPostCard(p, likedSet.has(p.id), likeMap[p.id] || 0, 0)).join('');
      html += `</div>`;
    }
  }
  container.innerHTML = html;
}

function handleRightSearch(query) {
  clearTimeout(searchTimeout);
  if (!query.trim()) { loadSuggestions(); return; }
  searchTimeout = setTimeout(() => rightPanelSearch(query.trim()), 350);
}

async function rightPanelSearch(query) {
  const { data: users } = await db.from('profiles').select('*').or(`username.ilike.%${query}%,full_name.ilike.%${query}%`).neq('id', currentUser.id).limit(5);
  const list = document.getElementById('suggestions-list');
  if (!users || !users.length) { list.innerHTML = `<div style="padding:8px 4px;font-size:0.8125rem;color:var(--text-3);">No users found</div>`; return; }
  list.innerHTML = users.map(u => `
    <div class="suggestion-item" onclick="showView('profile', '${u.id}')">
      ${getAvatarHtml(u, 'sm')}
      <div class="suggestion-info">
        <div class="suggestion-name">${esc(u.full_name || u.username)}</div>
        <div class="suggestion-handle">@${esc(u.username)}</div>
      </div>
    </div>`).join('');
}

// ================================================================
//  SUGGESTIONS
// ================================================================
async function loadSuggestions() {
  const { data: users } = await db.from('profiles').select('*').neq('id', currentUser?.id).limit(5);
  const list = document.getElementById('suggestions-list');
  if (!list) return;
  if (!users || !users.length) { list.innerHTML = '<div class="micro" style="padding:4px;">No suggestions</div>'; return; }
  list.innerHTML = users.map(u => `
    <div class="suggestion-item" onclick="showView('profile', '${u.id}')">
      ${getAvatarHtml(u, 'sm')}
      <div class="suggestion-info">
        <div class="suggestion-name">${esc(u.full_name || u.username)}</div>
        <div class="suggestion-handle">@${esc(u.username)}</div>
      </div>
      <button class="follow-btn not-following" style="font-size:0.75rem;padding:5px 12px;" onclick="event.stopPropagation(); this.textContent='Following'; this.className='follow-btn following';">Follow</button>
    </div>`).join('');
}

// ================================================================
//  DASHBOARD
// ================================================================
async function renderDashboard() {
  const container = document.getElementById('dashboard-content');
  container.innerHTML = `<div class="loading-center"><div class="spinner spinner-lg"></div></div>`;

  const [
    { count: postCount },
    { count: likeGiven },
    { count: commentCount },
    { data: receivedLikes }
  ] = await Promise.all([
    db.from('posts').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id),
    db.from('likes').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id),
    db.from('comments').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id),
    db.from('posts').select('id').eq('user_id', currentUser.id)
  ]);

  let receivedLikeCount = 0;
  if (receivedLikes && receivedLikes.length) {
    const pids = receivedLikes.map(p => p.id);
    const { count } = await db.from('likes').select('*', { count: 'exact', head: true }).in('post_id', pids);
    receivedLikeCount = count || 0;
  }

  const { data: recentPosts } = await db
    .from('posts')
    .select('*, profiles(id, username, full_name, avatar_url)')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(5);

  const postIds = (recentPosts || []).map(p => p.id);
  let likeMap = {}, commentMap = {}, likedSet = new Set();
  if (postIds.length) {
    const { data: lc } = await db.from('likes').select('post_id').in('post_id', postIds);
    (lc || []).forEach(l => { likeMap[l.post_id] = (likeMap[l.post_id] || 0) + 1; });
    const { data: cc } = await db.from('comments').select('post_id').in('post_id', postIds);
    (cc || []).forEach(c => { commentMap[c.post_id] = (commentMap[c.post_id] || 0) + 1; });
  }

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-card-value gradient-text">${postCount || 0}</div>
        <div class="stat-card-label">Posts published</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-value" style="color:var(--pink);">${receivedLikeCount}</div>
        <div class="stat-card-label">Likes received</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-value" style="color:var(--accent-2);">${commentCount || 0}</div>
        <div class="stat-card-label">Comments written</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-value" style="color:var(--green);">${likeGiven || 0}</div>
        <div class="stat-card-label">Likes given</div>
      </div>
    </div>

    <div style="padding:20px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div class="heading-3">Your recent posts</div>
        <button class="btn btn-ghost" style="padding:6px 14px;font-size:0.8125rem;" onclick="showView('profile', currentUser.id)">View all</button>
      </div>
      ${recentPosts && recentPosts.length ? recentPosts.map(p => renderPostCard(p, likedSet.has(p.id), likeMap[p.id] || 0, commentMap[p.id] || 0)).join('') : `
        <div class="card" style="padding:32px;text-align:center;">
          <p class="text-muted">You haven't posted yet.</p>
          <button class="btn btn-primary" style="margin-top:16px;" onclick="showView('feed')">Create your first post</button>
        </div>`}
    </div>
  `;
}

// ================================================================
//  SETTINGS
// ================================================================
function renderSettings() {
  const container = document.getElementById('settings-content');
  container.innerHTML = `
    <div style="max-width:560px;padding:28px;">
      <div class="settings-section">
        <div class="settings-section-title">Account</div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Email address</div>
            <div class="settings-row-desc">${esc(currentUser?.email || '')}</div>
          </div>
          <span class="badge badge-accent">Verified</span>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Profile</div>
            <div class="settings-row-desc">@${esc(currentProfile?.username || '')}</div>
          </div>
          <button class="btn btn-ghost" style="padding:6px 14px;font-size:0.8125rem;" onclick="openEditProfile()">Edit</button>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Security</div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Password</div>
            <div class="settings-row-desc">Change your account password</div>
          </div>
          <button class="btn btn-ghost" style="padding:6px 14px;font-size:0.8125rem;" onclick="showChangePassword()">Change</button>
        </div>
      </div>

      <div id="change-password-section" style="display:none;" class="settings-section">
        <div class="settings-section-title">Change password</div>
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div class="form-group">
            <label class="form-label">New password</label>
            <div class="input-wrapper">
              <svg class="input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <input type="password" class="form-input" id="change-pass-new" placeholder="New password" />
              <span class="input-action" onclick="togglePassword('change-pass-new', this)"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></span>
            </div>
            <span class="form-error" id="change-pass-err"></span>
          </div>
          <div class="form-group">
            <label class="form-label">Confirm new password</label>
            <div class="input-wrapper">
              <svg class="input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <input type="password" class="form-input" id="change-pass-confirm" placeholder="Confirm password" />
            </div>
            <span class="form-error" id="change-confirm-err"></span>
          </div>
          <div style="display:flex;gap:10px;">
            <button class="btn btn-ghost" onclick="document.getElementById('change-password-section').style.display='none'">Cancel</button>
            <button class="btn btn-primary" id="btn-change-pass" onclick="handleChangePassword()"><span class="btn-text">Update password</span></button>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Danger zone</div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Sign out</div>
            <div class="settings-row-desc">Sign out of your account on this device</div>
          </div>
          <button class="btn btn-ghost" style="padding:6px 14px;font-size:0.8125rem;" onclick="handleLogout()">Sign out</button>
        </div>
      </div>
    </div>
  `;
}

function showChangePassword() {
  const section = document.getElementById('change-password-section');
  if (section) { section.style.display = section.style.display === 'none' ? 'block' : 'none'; }
}

async function handleChangePassword() {
  const newPass = document.getElementById('change-pass-new').value;
  const confirm = document.getElementById('change-pass-confirm').value;
  clearErrors();
  if (newPass.length < 8) return showError('change-pass-err', 'Must be at least 8 characters');
  if (newPass !== confirm) return showError('change-confirm-err', 'Passwords do not match');

  setLoading('btn-change-pass', true);
  const { error } = await db.auth.updateUser({ password: newPass });
  setLoading('btn-change-pass', false);

  if (error) { showToast('error', 'Failed', error.message); return; }
  showToast('success', 'Password changed!');
  document.getElementById('change-password-section').style.display = 'none';
}

// ================================================================
//  REALTIME
// ================================================================
function setupRealtime() {
  if (realtimeChannel) return;
  realtimeChannel = db
    .channel('public:posts')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, async (payload) => {
      if (payload.new.user_id === currentUser?.id) return; // own posts already in feed
      if (currentView === 'feed') {
        // Show subtle notification
        const toast = showToast('info', 'New post', 'Someone just posted — refresh to see it');
      }
    })
    .subscribe();
}

function teardownRealtime() {
  if (realtimeChannel) {
    db.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

// ================================================================
//  MODAL
// ================================================================
function openModal(id) {
  const overlay = document.getElementById(id);
  overlay.style.display = 'flex';
  overlay.classList.remove('closing');
  const modal = overlay.querySelector('.modal');
  if (modal) modal.classList.remove('closing');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  const overlay = document.getElementById(id);
  overlay.classList.add('closing');
  const modal = overlay.querySelector('.modal');
  if (modal) modal.classList.add('closing');
  setTimeout(() => {
    overlay.style.display = 'none';
    overlay.classList.remove('closing');
    if (modal) modal.classList.remove('closing');
    document.body.style.overflow = '';
  }, 200);
}

function closeModalOnOverlay(event, id) {
  if (event.target.id === id) closeModal(id);
}

// ================================================================
//  TOAST
// ================================================================
function showToast(type, title, message = '') {
  const container = document.getElementById('toast-container');
  const id = 'toast-' + Date.now();
  const icons = {
    success: `<svg class="toast-icon success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
    error: `<svg class="toast-icon error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    info: `<svg class="toast-icon info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
  };
  const el = document.createElement('div');
  el.className = 'toast';
  el.id = id;
  el.innerHTML = `
    ${icons[type] || icons.info}
    <div class="toast-text">
      <div class="toast-title">${esc(title)}</div>
      ${message ? `<div class="toast-msg">${esc(message)}</div>` : ''}
    </div>
    <div class="toast-close" onclick="removeToast('${id}')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </div>`;
  container.appendChild(el);
  setTimeout(() => removeToast(id), 4000);
  return id;
}

function removeToast(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('leaving');
  setTimeout(() => el.remove(), 300);
}

// ================================================================
//  UTILITIES
// ================================================================
function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.classList.toggle('btn-loading', loading);
}

function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.classList.add('visible'); }
}

function clearErrors() {
  document.querySelectorAll('.form-error').forEach(e => { e.textContent = ''; e.classList.remove('visible'); });
}

function formatTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function linkify(text) {
  return text
    .replace(/@([a-zA-Z0-9_]+)/g, '<a class="mention" onclick="event.stopPropagation(); handleMentionClick(\'$1\')" style="color:var(--accent-2);cursor:pointer;">@$1</a>')
    .replace(/#([a-zA-Z0-9_]+)/g, '<a class="hashtag" style="color:var(--accent-2);">#$1</a>');
}

async function handleMentionClick(username) {
  const { data } = await db.from('profiles').select('id').eq('username', username).single();
  if (data) showView('profile', data.id);
}

function skeletonPosts(n) {
  return Array.from({length: n}, () => `
    <div class="skeleton-post">
      <div class="skeleton skeleton-avatar"></div>
      <div class="skeleton-body">
        <div class="skeleton skeleton-line w-40"></div>
        <div class="skeleton skeleton-line w-90" style="margin-top:4px;"></div>
        <div class="skeleton skeleton-line w-70" style="margin-top:4px;"></div>
      </div>
    </div>`).join('');
}

function errorState(msg) {
  return `<div class="empty-state">
    <div class="empty-icon" style="color:var(--red);">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    </div>
    <div class="empty-title">${esc(msg)}</div>
    <div class="empty-desc">Something went wrong. Try refreshing.</div>
  </div>`;
}


